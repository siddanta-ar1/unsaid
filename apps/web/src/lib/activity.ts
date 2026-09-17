import { address, createSolanaRpc } from '@solana/kit';
import { UNSAID_PROGRAM_ID, decodeConsentReceipt, deriveReceiptAddress } from '@unsaid/solana';
import { fromBase64Url, toBase64Url } from '@unsaid/crypto';
import { apiFetch } from './api';

/**
 * The access log.
 *
 * Two sources, deliberately. The API knows what it recorded, including what it
 * failed to publish; the chain knows what was actually published and cannot be
 * edited afterwards. The screen shows both and says when they disagree, because
 * a log served entirely by the party it holds to account is not evidence.
 *
 * The record address is derived here from the subject and receipt id rather
 * than taken from the API's `accountAddress`. Trusting that field would let a
 * server point the check at a record it prepared earlier.
 */

export type Purpose = 'reflection' | 'reflection_unattested' | 'export' | 'share';

export interface ActivityItem {
  thoughtId: string;
  receiptId: string;
  purpose: Purpose;
  consentVersion: number;
  attestation: string | null;
  resultHash: string;
  network: string;
  programId: string;
  accountAddress: string | null;
  signature: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  at: string;
}

export interface ActivityResponse {
  subject: string;
  items: ActivityItem[];
}

export type ChainCheck =
  | { state: 'checking' }
  | { state: 'unpublished' }
  | { state: 'missing'; recordAddress: string }
  | { state: 'matches'; recordAddress: string; recordedAt: Date }
  | { state: 'differs'; recordAddress: string; fields: string[] };

const PURPOSE_CODE: Record<Purpose, number> = {
  reflection: 0,
  export: 1,
  share: 2,
  reflection_unattested: 3,
};

export function getActivity(token: string): Promise<ActivityResponse> {
  return apiFetch<ActivityResponse>('/v1/activity', { token });
}

function rpcUrl(network: string): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC ??
    (network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com')
  );
}

/**
 * Reads one receipt back from the chain and compares it to what we were told.
 *
 * A `pending` row is not checked: it was never published, and the API already
 * says so. Reporting it as missing from the chain would be true and useless.
 */
export async function checkOnChain(
  subject: string,
  item: ActivityItem,
  fetchAccount = defaultFetchAccount,
): Promise<ChainCheck> {
  if (item.status !== 'confirmed') return { state: 'unpublished' };

  const programId = address(item.programId || UNSAID_PROGRAM_ID);
  const [recordAddress] = await deriveReceiptAddress(
    fromBase64Url(subject),
    fromBase64Url(item.receiptId),
    programId,
  );

  const data = await fetchAccount(recordAddress, rpcUrl(item.network));
  if (!data) return { state: 'missing', recordAddress };

  const record = decodeConsentReceipt(data);
  const fields: string[] = [];

  if (record.purpose !== PURPOSE_CODE[item.purpose]) fields.push('purpose');
  if (record.consentVersion !== item.consentVersion) fields.push('consent version');
  if (toBase64Url(record.resultHash) !== item.resultHash) fields.push('result');

  const attested = !record.attestation.every((byte) => byte === 0);
  const claimed = item.attestation !== null;
  if (attested !== claimed) fields.push('attestation');
  else if (claimed && toBase64Url(record.attestation) !== item.attestation) {
    fields.push('attestation');
  }

  if (fields.length > 0) return { state: 'differs', recordAddress, fields };

  return {
    state: 'matches',
    recordAddress,
    recordedAt: new Date(Number(record.createdAt) * 1000),
  };
}

async function defaultFetchAccount(
  recordAddress: string,
  url: string,
): Promise<Uint8Array | null> {
  const rpc = createSolanaRpc(url);
  const { value } = await rpc
    .getAccountInfo(address(recordAddress), { encoding: 'base64' })
    .send();
  if (!value) return null;
  const [base64] = value.data;
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export function explorerAccountUrl(recordAddress: string, network: string): string {
  const cluster = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `https://explorer.solana.com/address/${recordAddress}${cluster}`;
}
