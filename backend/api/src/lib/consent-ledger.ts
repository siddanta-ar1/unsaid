import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../db/client.js';
import { consentReceipts } from '../db/schema.js';
import { loadConfig } from './config.js';

/**
 * The consent ledger.
 *
 * Every access to a memory gets a receipt: which memory, under which version of
 * the consent text, which code ran, and a hash of what came back. It is written
 * to a chain we do not control, which is the entire reason it is worth anything
 * — a log we could edit is a log we would be asked to take on faith.
 *
 * Three rules hold this together:
 *
 *   1. **It cannot break Echo.** The reflection has already happened by the
 *      time we get here. Failing to publish a receipt must never turn into a
 *      failed reflection, so everything past the local insert is best-effort.
 *   2. **A failure is recorded, not swallowed.** The row goes in as `pending`
 *      first. A log that silently omits what it could not publish looks
 *      complete while being wrong, which is worse than being visibly partial.
 *   3. **Nothing here can hold content.** The subject is a digest of the vault,
 *      the memory is a digest of its id, and the result hash is salted by the
 *      reflection id so that only someone holding the answer can recompute it.
 */

export type ReceiptPurpose = 'reflection' | 'reflection_unattested' | 'export' | 'share';

const PURPOSE_CODE: Record<ReceiptPurpose, number> = {
  reflection: 0,
  export: 1,
  share: 2,
  reflection_unattested: 3,
};

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(input: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(input, 'utf8').digest());
}

/** The subject is the vault, domain-separated. Never a wallet, never the raw id. */
export function deriveSubject(userId: string): Uint8Array {
  return sha256(`unsaid:subject:v1:${userId}`);
}

/** Same derivation the proof records use, so one memory has one identity on chain. */
export function deriveThoughtSeed(thoughtId: string): Uint8Array {
  return sha256(`unsaid:seed:v1:${thoughtId}`);
}

/**
 * Binds the answer to the access without publishing the answer.
 *
 * Salted by the reflection id rather than hashing the text alone: a reflection
 * can be short and ordinary, and an unsalted hash of "you sound exhausted"
 * would be guessable. Whoever holds the reflection and its id can recompute
 * this; nobody else can.
 */
export function hashReflection(reflectionId: string, content: string): string {
  return toBase64Url(sha256(`unsaid:reflection:v1:${reflectionId}:${content}`));
}

export interface RecordAccessInput {
  userId: string;
  thoughtId: string;
  purpose: ReceiptPurpose;
  consentVersion: number;
  /** Base64url measurement of the code that ran, or null when nothing could prove it. */
  attestation: string | null;
  resultHash: string;
}

/**
 * Writes the receipt locally, then publishes it if a recorder key is configured.
 * Returns as soon as the local row exists; publishing continues in the
 * background because the caller is a user waiting on a reflection.
 */
export async function recordAccess(
  log: FastifyBaseLogger,
  input: RecordAccessInput,
): Promise<{ receiptId: string }> {
  const config = loadConfig();
  const db = getDatabase();
  const receiptId = toBase64Url(new Uint8Array(randomBytes(32)));

  // An attested purpose without a measurement is a contradiction the program
  // would reject on chain. Catching it here keeps the local log honest too.
  if (input.purpose === 'reflection' && !input.attestation) {
    throw new Error('A reflection receipt requires an attestation.');
  }
  if (input.purpose === 'reflection_unattested' && input.attestation) {
    throw new Error('An unattested reflection receipt must not carry a measurement.');
  }

  await db.insert(consentReceipts).values({
    userId: input.userId,
    thoughtId: input.thoughtId,
    receiptId,
    purpose: input.purpose,
    consentVersion: input.consentVersion,
    attestation: input.attestation,
    resultHash: input.resultHash,
    network: config.SOLANA_NETWORK,
    programId: config.SOLANA_PROGRAM_ID ?? 'unset',
  });

  if (!config.SOLANA_RECORDER_KEYPAIR) {
    // Deliberately not an error. The access happened and is recorded; it is
    // simply not published, and `pending` says exactly that.
    log.debug({ receiptId }, 'consent receipt recorded locally; ledger is not configured');
    return { receiptId };
  }

  void publish(log, receiptId, input).catch((error: unknown) => {
    log.error({ err: error, receiptId }, 'consent receipt could not be published');
  });

  return { receiptId };
}

async function publish(
  log: FastifyBaseLogger,
  receiptId: string,
  input: RecordAccessInput,
): Promise<void> {
  const config = loadConfig();
  const db = getDatabase();

  // Imported here rather than at module load: the API has no business opening
  // a Solana client on a deployment that never publishes. Two awaits rather
  // than a destructured Promise.all — the tuple form widens the types enough
  // that the transaction builders stop checking.
  const kit = await import('@solana/kit');
  const { UNSAID_PROGRAM_ID, deriveReceiptAddress, recordConsentInstruction } = await import(
    '@unsaid/solana'
  );
  const {
    address,
    appendTransactionMessageInstruction,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getSignatureFromTransaction,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
  } = kit;

  const programId = address(config.SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID);
  const rpcUrl =
    config.SOLANA_RPC_URL ??
    (config.SOLANA_NETWORK === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com');

  const secret = Uint8Array.from(
    JSON.parse(await readFile(config.SOLANA_RECORDER_KEYPAIR as string, 'utf8')) as number[],
  );
  const recorder = await createKeyPairSignerFromBytes(secret);

  const subject = deriveSubject(input.userId);
  const receiptIdBytes = new Uint8Array(Buffer.from(receiptId, 'base64url'));
  const [accountAddress] = await deriveReceiptAddress(subject, receiptIdBytes, programId);

  const instruction = await recordConsentInstruction({
    recorder: recorder.address,
    receiptId: receiptIdBytes,
    subject,
    thoughtId: deriveThoughtSeed(input.thoughtId),
    purpose: PURPOSE_CODE[input.purpose] as 0 | 1 | 2 | 3,
    consentVersion: input.consentVersion,
    attestation: input.attestation
      ? new Uint8Array(Buffer.from(input.attestation, 'base64url'))
      : new Uint8Array(32),
    resultHash: new Uint8Array(Buffer.from(input.resultHash, 'base64url')),
    programAddress: programId,
  });

  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, 'ws'));
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const empty = createTransactionMessage({ version: 0 });
  const withPayer = setTransactionMessageFeePayerSigner(recorder, empty);
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, withPayer);
  const message = appendTransactionMessageInstruction(instruction, withLifetime);

  const signed = await signTransactionMessageWithSigners(message);
  /*
   * The signer widens the lifetime back to "blockhash or durable nonce" and the
   * sender only accepts the former, so it has to be narrowed. The library's own
   * assertion does it — a genuine mismatch throws rather than being cast away —
   * but TypeScript only honours an assertion signature when the callee has an
   * explicit type annotation, which a name destructured from a dynamic import
   * does not. Hence the annotated alias.
   */
  const assertBlockhashLifetime: typeof import('@solana/kit').assertIsTransactionWithBlockhashLifetime =
    kit.assertIsTransactionWithBlockhashLifetime;
  assertBlockhashLifetime(signed);
  const signature = getSignatureFromTransaction(signed);

  try {
    await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
      commitment: 'confirmed',
    });
  } catch (error) {
    await db
      .update(consentReceipts)
      .set({ status: 'failed' })
      .where(eq(consentReceipts.receiptId, receiptId));
    throw error;
  }

  await db
    .update(consentReceipts)
    .set({ status: 'confirmed', txSignature: signature, accountAddress })
    .where(eq(consentReceipts.receiptId, receiptId));

  log.info({ receiptId, signature }, 'consent receipt published');
}
