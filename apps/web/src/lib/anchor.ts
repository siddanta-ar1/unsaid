import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  address,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';
import { createRecordInstruction } from '@unsaid/solana';
import { fromBase64Url } from '@unsaid/crypto';
import { apiFetch } from './api';

/**
 * The anchoring flow. Blueprint §14 and Epic D.
 *
 * Three parties, deliberately separated:
 *   - the server computes the commitment from the ciphertext hash it already
 *     holds, so the client cannot anchor an arbitrary value;
 *   - the client assembles the transaction;
 *   - the wallet signs and submits it. No private key ever reaches our code.
 */

export interface AnchorPreparation {
  commitment: string;
  programId: string;
  network: 'devnet' | 'mainnet-beta';
  thoughtSeed: string;
}

export interface AnchorStatus {
  anchored: boolean;
  network: string | null;
  commitment: string | null;
  signature: string | null;
  programId: string | null;
}

export function prepareAnchor(
  thoughtId: string,
  ownerPubkey: string,
  token: string,
): Promise<AnchorPreparation> {
  return apiFetch<AnchorPreparation>(`/v1/thoughts/${thoughtId}/anchor`, {
    method: 'POST',
    token,
    body: { ownerPubkey },
  });
}

export function getAnchorStatus(thoughtId: string, token: string): Promise<AnchorStatus> {
  return apiFetch<AnchorStatus>(`/v1/thoughts/${thoughtId}/anchor`, { token });
}

export function confirmAnchor(
  thoughtId: string,
  signature: string,
  token: string,
): Promise<{ status: 'confirmed' | 'failed' }> {
  return apiFetch(`/v1/thoughts/${thoughtId}/anchor/confirm`, {
    method: 'POST',
    token,
    body: { signature },
  });
}

/**
 * Builds the wire bytes for the anchor transaction.
 *
 * Returned unsigned; the caller hands them to the wallet, which signs and
 * submits in one step. The blockhash is the only thing fetched from an RPC,
 * and it carries no user data.
 */
export async function buildAnchorTransaction({
  preparation,
  owner,
  rpc,
}: {
  preparation: AnchorPreparation;
  owner: Address;
  rpc: Rpc<SolanaRpcApi>;
}): Promise<Uint8Array> {
  const instruction = await createRecordInstruction({
    owner,
    thoughtSeed: fromBase64Url(preparation.thoughtSeed),
    commitment: fromBase64Url(preparation.commitment),
    programAddress: address(preparation.programId),
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );

  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Wallets return raw signature bytes; explorers and our API expect base58. */
export function signatureToBase58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += (digits[i] as number) << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

export function explorerUrl(signature: string, network: string): string {
  const cluster = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
