import { describe, expect, it } from 'vitest';
import { sha256, toBase64Url } from '@unsaid/crypto';
import { checkOnChain, type ActivityItem } from './activity';

/**
 * The check that makes the access log evidence rather than a claim.
 *
 * The API serves this screen and is also the party it holds to account, so the
 * only assertion worth making is that a server which reports one thing while
 * the chain says another gets caught.
 */

const SUBJECT = toBase64Url(new Uint8Array(32).fill(7));
const RECEIPT_ID = toBase64Url(new Uint8Array(32).fill(9));

const baseItem: ActivityItem = {
  thoughtId: '11111111-1111-4111-8111-111111111111',
  receiptId: RECEIPT_ID,
  purpose: 'reflection_unattested',
  consentVersion: 1,
  attestation: null,
  resultHash: toBase64Url(new Uint8Array(32).fill(3)),
  network: 'devnet',
  programId: '7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ',
  accountAddress: null,
  signature: 'a-signature',
  status: 'confirmed',
  at: new Date('2026-09-17T08:00:00Z').toISOString(),
};

/** Builds the account bytes the program would have written. */
function encodeReceipt(overrides: Partial<{
  purpose: number;
  consentVersion: number;
  attestation: Uint8Array;
  resultHash: Uint8Array;
}> = {}): Uint8Array {
  const data = new Uint8Array(8 + 32 * 6 + 2 + 1 + 8 + 1);
  const view = new DataView(data.buffer);
  data.set(new Uint8Array(32).fill(1), 8); // recorder
  data.set(new Uint8Array(32).fill(9), 40); // receipt id
  data.set(new Uint8Array(32).fill(7), 72); // subject
  data.set(new Uint8Array(32).fill(2), 104); // thought id
  data.set(overrides.attestation ?? new Uint8Array(32), 136);
  data.set(overrides.resultHash ?? new Uint8Array(32).fill(3), 168);
  view.setUint16(200, overrides.consentVersion ?? 1, true);
  data[202] = overrides.purpose ?? 3;
  view.setBigInt64(203, 1_789_600_000n, true);
  data[211] = 255;
  return data;
}

describe('checking a receipt against the chain', () => {
  it('confirms a row the chain agrees with', async () => {
    const result = await checkOnChain(SUBJECT, baseItem, async () => encodeReceipt());
    expect(result.state).toBe('matches');
  });

  it('catches a purpose we reported differently from what was recorded', async () => {
    // We claim the reflection was attested; the chain says it was not.
    const result = await checkOnChain(
      SUBJECT,
      { ...baseItem, purpose: 'reflection', attestation: toBase64Url(new Uint8Array(32).fill(5)) },
      async () => encodeReceipt({ purpose: 3, attestation: new Uint8Array(32) }),
    );
    expect(result.state).toBe('differs');
    if (result.state === 'differs') {
      expect(result.fields).toContain('purpose');
      expect(result.fields).toContain('attestation');
    }
  });

  it('catches an answer that does not match the one recorded', async () => {
    const result = await checkOnChain(
      SUBJECT,
      { ...baseItem, resultHash: toBase64Url(await sha256(new Uint8Array([1, 2, 3]))) },
      async () => encodeReceipt(),
    );
    expect(result.state).toBe('differs');
    if (result.state === 'differs') expect(result.fields).toContain('result');
  });

  it('catches a receipt we said was published but that is not there', async () => {
    const result = await checkOnChain(SUBJECT, baseItem, async () => null);
    expect(result.state).toBe('missing');
  });

  it('does not accuse the chain over a row we never published', async () => {
    // `pending` means we already admitted it is not on chain. Reporting it as
    // missing would be true, useless, and would bury the rows that matter.
    const result = await checkOnChain(SUBJECT, { ...baseItem, status: 'pending' }, async () => {
      throw new Error('the chain should not be consulted for an unpublished row');
    });
    expect(result.state).toBe('unpublished');
  });

  it('derives the address itself rather than trusting the one it was handed', async () => {
    let asked = '';
    await checkOnChain(
      SUBJECT,
      { ...baseItem, accountAddress: 'a-server-supplied-address' },
      async (recordAddress) => {
        asked = recordAddress;
        return encodeReceipt();
      },
    );
    // A server that could choose the address could point the check at a record
    // it prepared earlier, and every row would verify.
    expect(asked).not.toBe('a-server-supplied-address');
    expect(asked).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
