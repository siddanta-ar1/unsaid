import { describe, expect, it } from 'vitest';
import { address } from '@solana/kit';
import {
  AccessMode,
  UNSAID_PROGRAM_ID,
  decodeThoughtRecord,
  deriveRecordAddress,
  encodeCreateRecordData,
  instructionDiscriminator,
} from './program.js';

const OWNER = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const THOUGHT_ID = new Uint8Array(32).fill(7);
const COMMITMENT = new Uint8Array(32).fill(9);

describe('record address derivation', () => {
  it('is deterministic for the same owner and thought', async () => {
    const [a] = await deriveRecordAddress(OWNER, THOUGHT_ID);
    const [b] = await deriveRecordAddress(OWNER, THOUGHT_ID);
    // Determinism is what gives anchoring idempotency (D-03): a retry lands on
    // the same address and fails as already-initialised.
    expect(a).toBe(b);
  });

  it('differs per thought and per owner', async () => {
    const [base] = await deriveRecordAddress(OWNER, THOUGHT_ID);
    const [otherThought] = await deriveRecordAddress(OWNER, new Uint8Array(32).fill(8));
    const [otherOwner] = await deriveRecordAddress(
      address('7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs'),
      THOUGHT_ID,
    );
    expect(base).not.toBe(otherThought);
    expect(base).not.toBe(otherOwner);
  });

  it('refuses a malformed thought id rather than deriving a wrong address', async () => {
    await expect(deriveRecordAddress(OWNER, new Uint8Array(16))).rejects.toThrow('32 bytes');
  });
});

describe('instruction encoding', () => {
  it('produces stable 8-byte discriminators', async () => {
    const a = await instructionDiscriminator('create_record');
    const b = await instructionDiscriminator('create_record');
    const other = await instructionDiscriminator('revoke_record');
    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(other);
  });

  it('lays out create_record exactly as Anchor expects', async () => {
    const data = await encodeCreateRecordData({
      thoughtId: THOUGHT_ID,
      commitment: COMMITMENT,
      accessMode: AccessMode.Private,
    });
    expect(data).toHaveLength(73); // 8 discriminator + 32 + 32 + 1
    expect(data.slice(8, 40)).toEqual(THOUGHT_ID);
    expect(data.slice(40, 72)).toEqual(COMMITMENT);
    expect(data[72]).toBe(0);
  });

  it('rejects a commitment of the wrong size', async () => {
    await expect(
      encodeCreateRecordData({
        thoughtId: THOUGHT_ID,
        commitment: new Uint8Array(31),
        accessMode: AccessMode.Private,
      }),
    ).rejects.toThrow('32 bytes');
  });
});

describe('account decoding', () => {
  it('round-trips a record laid out as the program writes it', () => {
    const data = new Uint8Array(124);
    data.set(new Uint8Array(8).fill(1), 0); // account discriminator
    data.set(new Uint8Array(32).fill(2), 8); // owner
    data.set(THOUGHT_ID, 40);
    data.set(COMMITMENT, 72);
    data[104] = 1; // version
    data[105] = 0; // status: active
    data[106] = 2; // access mode: public proof
    new DataView(data.buffer).setBigInt64(107, 1_700_000_000n, true);
    new DataView(data.buffer).setBigInt64(115, 1_700_000_500n, true);
    data[123] = 254; // bump

    const record = decodeThoughtRecord(data);
    expect(record.thoughtId).toEqual(THOUGHT_ID);
    expect(record.commitment).toEqual(COMMITMENT);
    expect(record.version).toBe(1);
    expect(record.accessMode).toBe(2);
    expect(record.createdAt).toBe(1_700_000_000n);
    expect(record.bump).toBe(254);
  });

  it('refuses truncated account data instead of returning garbage', () => {
    expect(() => decodeThoughtRecord(new Uint8Array(50))).toThrow('too short');
  });
});

describe('program identity', () => {
  it('carries a valid deployed program address', () => {
    expect(UNSAID_PROGRAM_ID).toBe('8YKzd762j9R8Mn6u8sxsTtHcif3uqdvKCyKnLZP3oATA');
  });
});
