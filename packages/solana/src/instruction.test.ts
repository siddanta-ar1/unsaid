import { describe, expect, it } from 'vitest';
import { AccountRole, address } from '@solana/kit';
import { AccessMode, UNSAID_PROGRAM_ID, deriveRecordAddress } from './program.js';
import {
  SYSTEM_PROGRAM_ADDRESS,
  createRecordInstruction,
  revokeRecordInstruction,
} from './instruction.js';

const OWNER = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const SEED = new Uint8Array(32).fill(3);
const COMMITMENT = new Uint8Array(32).fill(5);

describe('create_record instruction', () => {
  it('targets the program and the derived record account', async () => {
    const ix = await createRecordInstruction({
      owner: OWNER,
      thoughtSeed: SEED,
      commitment: COMMITMENT,
    });
    const [expectedRecord] = await deriveRecordAddress(OWNER, SEED);

    expect(ix.programAddress).toBe(UNSAID_PROGRAM_ID);
    expect(ix.accounts?.[0]?.address).toBe(expectedRecord);
    expect(ix.accounts?.[2]?.address).toBe(SYSTEM_PROGRAM_ADDRESS);
  });

  it('marks the owner as the only signer', async () => {
    const ix = await createRecordInstruction({
      owner: OWNER,
      thoughtSeed: SEED,
      commitment: COMMITMENT,
    });

    // The record PDA must not be a signer — the program signs for it.
    expect(ix.accounts?.[0]?.role).toBe(AccountRole.WRITABLE);
    expect(ix.accounts?.[1]?.role).toBe(AccountRole.WRITABLE_SIGNER);
    expect(ix.accounts?.[2]?.role).toBe(AccountRole.READONLY);
  });

  it('carries only the seed, commitment and access mode', async () => {
    const ix = await createRecordInstruction({
      owner: OWNER,
      thoughtSeed: SEED,
      commitment: COMMITMENT,
      accessMode: AccessMode.PublicProof,
    });

    // 8 discriminator + 32 seed + 32 commitment + 1 mode. Nothing else fits.
    expect(ix.data).toHaveLength(73);
    expect(ix.data?.slice(8, 40)).toEqual(SEED);
    expect(ix.data?.slice(40, 72)).toEqual(COMMITMENT);
    expect(ix.data?.[72]).toBe(AccessMode.PublicProof);
  });

  it('honours an overridden program address', async () => {
    const other = address('7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs');
    const ix = await createRecordInstruction({
      owner: OWNER,
      thoughtSeed: SEED,
      commitment: COMMITMENT,
      programAddress: other,
    });

    expect(ix.programAddress).toBe(other);
    // The PDA must be derived under the overridden program, not the default.
    const [expected] = await deriveRecordAddress(OWNER, SEED, other);
    expect(ix.accounts?.[0]?.address).toBe(expected);
  });
});

describe('revoke_record instruction', () => {
  it('needs no system program and does not make the owner writable', async () => {
    const ix = await revokeRecordInstruction({ owner: OWNER, thoughtSeed: SEED });

    expect(ix.accounts).toHaveLength(2);
    expect(ix.accounts?.[1]?.role).toBe(AccountRole.READONLY_SIGNER);
    expect(ix.data).toHaveLength(8);
  });
});
