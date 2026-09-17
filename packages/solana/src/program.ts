import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from '@solana/kit';

/**
 * Client-side view of the UNSAID Anchor program.
 *
 * Uses @solana/kit, Solana's current recommended TypeScript client. The scope
 * here is narrow on purpose: derive addresses, build instruction data, decode
 * accounts. Transaction assembly and signing live in the wallet layer, never in
 * a UI component (§20.2).
 */

export const UNSAID_PROGRAM_ID = address('7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ');

export const RECORD_SEED = new TextEncoder().encode('thought');
export const CONSENT_SEED = new TextEncoder().encode('consent');

export const AccessMode = {
  Private: 0,
  SharedLink: 1,
  PublicProof: 2,
} as const;
export type AccessMode = (typeof AccessMode)[keyof typeof AccessMode];

export const RecordStatus = {
  Active: 0,
  Revoked: 1,
} as const;

/**
 * What an access was for. Reflection is the only one where content leaves the
 * device, which is why it is the only one the program requires an attestation
 * for.
 */
export const Purpose = {
  Reflection: 0,
  Export: 1,
  Share: 2,
} as const;
export type Purpose = (typeof Purpose)[keyof typeof Purpose];

/**
 * Anchor instruction discriminators: the first 8 bytes of
 * SHA-256("global:<instruction_name>"). Computed at call time rather than
 * hardcoded so a renamed instruction fails loudly instead of silently
 * targeting the wrong handler.
 */
export async function instructionDiscriminator(name: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`global:${name}`) as BufferSource,
  );
  return new Uint8Array(digest).slice(0, 8);
}

/**
 * The record PDA. Derived from owner and thought id, which is what makes
 * anchoring idempotent: a retried submission resolves to the same address and
 * is rejected as already-initialised rather than creating a second record.
 */
export async function deriveRecordAddress(
  owner: Address,
  thoughtId: Uint8Array,
  programAddress: Address = UNSAID_PROGRAM_ID,
): Promise<ProgramDerivedAddress> {
  if (thoughtId.length !== 32) {
    throw new Error(`thoughtId must be 32 bytes, received ${thoughtId.length}.`);
  }
  return getProgramDerivedAddress({
    programAddress,
    seeds: [RECORD_SEED, getAddressEncoder().encode(owner), thoughtId],
  });
}

/**
 * The receipt PDA. Seeded by subject and receipt id rather than by a wallet, so
 * the address exists for users who never connect one.
 */
export async function deriveReceiptAddress(
  subject: Uint8Array,
  receiptId: Uint8Array,
  programAddress: Address = UNSAID_PROGRAM_ID,
): Promise<ProgramDerivedAddress> {
  if (subject.length !== 32) throw new Error('subject must be 32 bytes.');
  if (receiptId.length !== 32) throw new Error('receiptId must be 32 bytes.');
  return getProgramDerivedAddress({
    programAddress,
    seeds: [CONSENT_SEED, subject, receiptId],
  });
}

export interface RecordConsentArgs {
  receiptId: Uint8Array;
  subject: Uint8Array;
  thoughtId: Uint8Array;
  purpose: Purpose;
  consentVersion: number;
  /** 32 zero bytes where nothing left the device; the program rejects that for a reflection. */
  attestation: Uint8Array;
  resultHash: Uint8Array;
}

/** Serialises `record_consent` arguments in Anchor's Borsh layout. */
export async function encodeRecordConsentData({
  receiptId,
  subject,
  thoughtId,
  purpose,
  consentVersion,
  attestation,
  resultHash,
}: RecordConsentArgs): Promise<Uint8Array> {
  for (const [name, value] of Object.entries({ receiptId, subject, thoughtId, attestation, resultHash })) {
    if (value.length !== 32) throw new Error(`${name} must be 32 bytes.`);
  }
  if (!Number.isInteger(consentVersion) || consentVersion < 1 || consentVersion > 0xffff) {
    throw new Error('consentVersion must be a positive 16-bit integer.');
  }

  const discriminator = await instructionDiscriminator('record_consent');
  const data = new Uint8Array(8 + 32 * 5 + 1 + 2);
  data.set(discriminator, 0);
  data.set(receiptId, 8);
  data.set(subject, 40);
  data.set(thoughtId, 72);
  data[104] = purpose;
  // u16 little-endian, like every other Borsh integer.
  data[105] = consentVersion & 0xff;
  data[106] = (consentVersion >> 8) & 0xff;
  data.set(attestation, 107);
  data.set(resultHash, 139);
  return data;
}

export interface ConsentReceipt {
  recorder: Address;
  receiptId: Uint8Array;
  subject: Uint8Array;
  thoughtId: Uint8Array;
  attestation: Uint8Array;
  resultHash: Uint8Array;
  consentVersion: number;
  purpose: number;
  createdAt: bigint;
  bump: number;
}

/** Decodes a fetched receipt account. */
export function decodeConsentReceipt(data: Uint8Array): ConsentReceipt {
  const EXPECTED_SIZE = 8 + 32 * 6 + 2 + 1 + 8 + 1;
  if (data.length < EXPECTED_SIZE) {
    throw new Error(`Receipt data is too short: ${data.length} < ${EXPECTED_SIZE}.`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    recorder: toBase58(data.slice(8, 40)) as Address,
    receiptId: data.slice(40, 72),
    subject: data.slice(72, 104),
    thoughtId: data.slice(104, 136),
    attestation: data.slice(136, 168),
    resultHash: data.slice(168, 200),
    consentVersion: view.getUint16(200, true),
    purpose: data[202] as number,
    createdAt: view.getBigInt64(203, true),
    bump: data[211] as number,
  };
}

export interface CreateRecordArgs {
  thoughtId: Uint8Array;
  commitment: Uint8Array;
  accessMode: AccessMode;
}

/** Serialises `create_record` arguments in Anchor's Borsh layout. */
export async function encodeCreateRecordData({
  thoughtId,
  commitment,
  accessMode,
}: CreateRecordArgs): Promise<Uint8Array> {
  if (thoughtId.length !== 32) throw new Error('thoughtId must be 32 bytes.');
  if (commitment.length !== 32) throw new Error('commitment must be 32 bytes.');

  const discriminator = await instructionDiscriminator('create_record');
  const data = new Uint8Array(8 + 32 + 32 + 1);
  data.set(discriminator, 0);
  data.set(thoughtId, 8);
  data.set(commitment, 40);
  data[72] = accessMode;
  return data;
}

export async function encodeRevokeRecordData(): Promise<Uint8Array> {
  return instructionDiscriminator('revoke_record');
}

export interface ThoughtRecord {
  owner: Address;
  thoughtId: Uint8Array;
  commitment: Uint8Array;
  version: number;
  status: number;
  accessMode: number;
  createdAt: bigint;
  updatedAt: bigint;
  bump: number;
}

/** Decodes a fetched account. Anchor prefixes every account with 8 discriminator bytes. */
export function decodeThoughtRecord(data: Uint8Array): ThoughtRecord {
  const EXPECTED_SIZE = 8 + 32 + 32 + 32 + 1 + 1 + 1 + 8 + 8 + 1;
  if (data.length < EXPECTED_SIZE) {
    throw new Error(`Account data is too short: ${data.length} < ${EXPECTED_SIZE}.`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const owner = data.slice(8, 40);

  return {
    // Kit addresses are base58 strings; decode via the encoder's inverse.
    owner: toBase58(owner) as Address,
    thoughtId: data.slice(40, 72),
    commitment: data.slice(72, 104),
    version: data[104] as number,
    status: data[105] as number,
    accessMode: data[106] as number,
    createdAt: view.getBigInt64(107, true),
    updatedAt: view.getBigInt64(115, true),
    bump: data[123] as number,
  };
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Uint8Array): string {
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
  // Leading zero bytes become leading '1' characters.
  for (const byte of bytes) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}
