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
  deriveReceiptAddress,
  encodeCreateRecordData,
  encodeRecordConsentData,
  encodeRevokeRecordData,
  type Purpose,
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

export interface RecordConsentInstructionArgs {
  /** The key writing the receipt — us, not the subject. It pays the rent. */
  recorder: Address;
  receiptId: Uint8Array;
  subject: Uint8Array;
  thoughtId: Uint8Array;
  purpose: Purpose;
  consentVersion: number;
  attestation: Uint8Array;
  resultHash: Uint8Array;
  programAddress?: Address;
}

/**
 * Builds `record_consent`.
 *
 * Note which key signs: the recorder, not the subject. A user who never
 * connects a wallet cannot sign anything, and an audit trail that only exists
 * for people who own crypto would protect the wrong half of the users.
 */
export async function recordConsentInstruction({
  recorder,
  receiptId,
  subject,
  thoughtId,
  purpose,
  consentVersion,
  attestation,
  resultHash,
  programAddress = UNSAID_PROGRAM_ID,
}: RecordConsentInstructionArgs): Promise<Instruction> {
  const [receipt] = await deriveReceiptAddress(subject, receiptId, programAddress);

  return {
    programAddress,
    accounts: [
      { address: receipt, role: AccountRole.WRITABLE },
      { address: recorder, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: await encodeRecordConsentData({
      receiptId,
      subject,
      thoughtId,
      purpose,
      consentVersion,
      attestation,
      resultHash,
    }),
  };
}
