#!/usr/bin/env node
/**
 * Writes one consent receipt on a live cluster, reads it back, and checks that
 * the program refuses the cases it is supposed to refuse.
 *
 * The receipt is the half of the ledger that is not about ownership. Anchoring
 * proves a memory existed; this proves an access happened — which memory, under
 * which version of the consent text, which code ran, and a hash of what came
 * back. No content, ever.
 *
 * The negative cases matter more than the positive one. A receipt that could
 * omit the attestation would look like evidence while proving nothing about
 * what ran, so the program has to reject it, and this checks that it does.
 *
 * Usage: node scripts/record-consent-devnet.mjs
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = (p) => pathToFileURL(resolve(ROOT, p)).href;

const {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} = await import(from('apps/web/node_modules/@solana/kit/dist/index.node.mjs'));

const { deriveThoughtSeed, fromBase64Url, toBase64Url, sha256, encodeUtf8 } = await import(
  from('packages/crypto/dist/index.js')
);
const { Purpose, UNSAID_PROGRAM_ID, decodeConsentReceipt, deriveReceiptAddress, recordConsentInstruction } =
  await import(from('packages/solana/dist/index.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const RPC_URL = arg('rpc', 'https://api.devnet.solana.com');
const PROGRAM_ID = arg('program', process.env.SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID);
const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, 'ws'));

const secret = Uint8Array.from(
  JSON.parse(await readFile(arg('keypair', join(homedir(), '.config', 'solana', 'id.json')), 'utf8')),
);
const recorder = await createKeyPairSignerFromBytes(secret);

/** The subject is the vault, domain-separated — never a wallet, never the id itself. */
async function deriveSubject(vaultId) {
  return new Uint8Array(await sha256(encodeUtf8(`unsaid:subject:v1:${vaultId}`)));
}

const vaultId = arg('vault', randomUUID());
const thoughtId = arg('thought-id', randomUUID());
const subject = await deriveSubject(vaultId);
const thoughtSeed = fromBase64Url(await deriveThoughtSeed(thoughtId));
const receiptId = new Uint8Array(randomBytes(32));

// Stands in for the enclave measurement until attested inference is wired up.
const attestation = new Uint8Array(randomBytes(32));
const resultHash = new Uint8Array(await sha256(encodeUtf8('a reflection nobody but the user will read')));

const [receiptAddress] = await deriveReceiptAddress(subject, receiptId, address(PROGRAM_ID));

console.log('cluster      ', RPC_URL);
console.log('program      ', PROGRAM_ID);
console.log('recorder     ', recorder.address);
console.log('vault        ', vaultId, '(never sent — only its digest)');
console.log('subject      ', toBase64Url(subject));
console.log('memory       ', thoughtId);
console.log('receipt PDA  ', receiptAddress);

async function send(instruction) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(recorder, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, { commitment: 'confirmed' });
  return getSignatureFromTransaction(signed);
}

const before = (await rpc.getBalance(recorder.address).send()).value;
const startedAt = Date.now();

const signature = await send(
  await recordConsentInstruction({
    recorder: recorder.address,
    receiptId,
    subject,
    thoughtId: thoughtSeed,
    purpose: Purpose.Reflection,
    consentVersion: 1,
    attestation,
    resultHash,
    programAddress: address(PROGRAM_ID),
  }),
);

const confirmedMs = Date.now() - startedAt;
const after = (await rpc.getBalance(recorder.address).send()).value;

console.log('\n--- recorded ---');
console.log('signature    ', signature);
console.log('confirmed in ', `${confirmedMs} ms`);
console.log('cost         ', `${Number(before - after) / 1e9} SOL (rent + fee)`);

const { value: account } = await rpc.getAccountInfo(receiptAddress, { encoding: 'base64' }).send();
if (!account) throw new Error('The receipt was confirmed but could not be read back.');
const bytes = Buffer.from(account.data[0], 'base64');
const decoded = decodeConsentReceipt(bytes);

const ok =
  decoded.recorder === recorder.address &&
  toBase64Url(decoded.subject) === toBase64Url(subject) &&
  toBase64Url(decoded.thoughtId) === toBase64Url(thoughtSeed) &&
  toBase64Url(decoded.attestation) === toBase64Url(attestation) &&
  toBase64Url(decoded.resultHash) === toBase64Url(resultHash) &&
  decoded.consentVersion === 1 &&
  decoded.purpose === Purpose.Reflection;

console.log('\n--- read back from chain ---');
console.log('recorder     ', decoded.recorder);
console.log('purpose      ', decoded.purpose === 0 ? 'reflection' : decoded.purpose);
console.log('consent ver  ', decoded.consentVersion);
console.log('attestation  ', toBase64Url(decoded.attestation));
console.log('result hash  ', toBase64Url(decoded.resultHash));
console.log('recorded at  ', new Date(Number(decoded.createdAt) * 1000).toISOString());
console.log('account size ', bytes.length, 'bytes');
console.log('every field  ', ok ? 'round-tripped' : 'MISMATCH — the encoding is wrong');

// --- the refusals ---
console.log('\n--- what the program refuses ---');

/**
 * Anchor numbers custom errors from 6000 in declaration order. Asserting the
 * code rather than "something threw" is the difference between checking the
 * program refuses this case and checking that the network was down.
 */
const ERROR_CODE = {
  InvalidPurpose: 6004,
  MissingConsentVersion: 6005,
  MissingAttestation: 6006,
};

function describe(error) {
  return JSON.stringify(
    error?.context ?? error?.cause?.context ?? error?.message ?? String(error),
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
}

async function expectFailure(label, expectedCode, instruction) {
  try {
    await send(await instruction);
    console.log(`${label}: ACCEPTED — that is a bug`);
    return false;
  } catch (error) {
    const text = describe(error);
    if (expectedCode === 'already-initialised') {
      // The system program owns this one: allocating an account that exists.
      const hit = /already in use|0x0\b/i.test(text);
      console.log(`${label}: ${hit ? 'rejected, address already initialised' : `rejected, but: ${text.slice(0, 160)}`}`);
      return hit;
    }
    const hit = text.includes(String(expectedCode));
    console.log(`${label}: ${hit ? `rejected with ${expectedCode}` : `rejected, but not with ${expectedCode}: ${text.slice(0, 160)}`}`);
    return hit;
  }
}

const base = {
  recorder: recorder.address,
  subject,
  thoughtId: thoughtSeed,
  consentVersion: 1,
  attestation,
  resultHash,
  programAddress: address(PROGRAM_ID),
};

const refusals = [
  await expectFailure(
    'a reflection with no attestation',
    ERROR_CODE.MissingAttestation,
    recordConsentInstruction({
      ...base,
      receiptId: new Uint8Array(randomBytes(32)),
      purpose: Purpose.Reflection,
      attestation: new Uint8Array(32),
    }),
  ),
  await expectFailure(
    'a receipt with consent version 0',
    ERROR_CODE.MissingConsentVersion,
    // The SDK refuses to encode version 0, so asking it politely would only
    // test the SDK. A client that wanted to write a consent-free receipt would
    // not use our encoder, so neither does this: build a valid instruction and
    // zero the version bytes on the wire, which is what the program must catch.
    (async () => {
      const valid = await recordConsentInstruction({
        ...base,
        receiptId: new Uint8Array(randomBytes(32)),
        purpose: Purpose.Export,
        consentVersion: 1,
      });
      const tampered = new Uint8Array(valid.data);
      tampered[105] = 0;
      tampered[106] = 0;
      return { ...valid, data: tampered };
    })(),
  ),
  await expectFailure(
    'an unknown purpose',
    ERROR_CODE.InvalidPurpose,
    recordConsentInstruction({ ...base, receiptId: new Uint8Array(randomBytes(32)), purpose: 9 }),
  ),
  await expectFailure(
    'the same receipt twice',
    'already-initialised',
    recordConsentInstruction({ ...base, receiptId, purpose: Purpose.Reflection }),
  ),
];

const cluster = RPC_URL.includes('devnet') ? '?cluster=devnet' : '';
console.log('\nexplorer     ', `https://explorer.solana.com/address/${receiptAddress}${cluster}`);

if (!ok || refusals.some((r) => !r)) process.exit(1);
