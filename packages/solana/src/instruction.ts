import {
  AccountRole,
  address,
  type Address,
  type Instruction,
} from '@solana/kit';
import {
  AccessMode,
  UNSAID_PROGRAM_ID,
  deriveRecordAddress,
  encodeCreateRecordData,
  encodeRevokeRecordData,
} from './program.js';

/**
 * Instruction builders. Kept separate from the encoding primitives in
 * `program.ts` so the wire format can be unit-tested without constructing
 * account metas.
 */

export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

export interface CreateRecordInstructionArgs {
  owner: Address;
  thoughtSeed: Uint8Array;
  commitment: Uint8Array;
  accessMode?: AccessMode;
  programAddress?: Address;
}

/**
 * Builds `create_record`.
 *
 * The record PDA is writable but not a signer — the program signs for it with
 * the bump. The owner pays rent and signs. Nothing in `data` is reversible to
 * content: it is a 32-byte seed digest and a 32-byte commitment.
 */
export async function createRecordInstruction({
  owner,
  thoughtSeed,
  commitment,
  accessMode = AccessMode.Private,
  programAddress = UNSAID_PROGRAM_ID,
}: CreateRecordInstructionArgs): Promise<Instruction> {
  const [record] = await deriveRecordAddress(owner, thoughtSeed, programAddress);

  return {
    programAddress,
    accounts: [
      { address: record, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: await encodeCreateRecordData({ thoughtId: thoughtSeed, commitment, accessMode }),
  };
}

/** Builds `revoke_record`. No system program: nothing is allocated. */
export async function revokeRecordInstruction({
  owner,
  thoughtSeed,
  programAddress = UNSAID_PROGRAM_ID,
}: {
  owner: Address;
  thoughtSeed: Uint8Array;
  programAddress?: Address;
}): Promise<Instruction> {
  const [record] = await deriveRecordAddress(owner, thoughtSeed, programAddress);

  return {
    programAddress,
    accounts: [
      { address: record, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data: await encodeRevokeRecordData(),
  };
}
