/**
 * Binary <-> text conversions. Unpadded base64url everywhere so values are safe
 * in URLs, JSON and object keys without a second escaping layer.
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encodeUtf8 = (text: string): Uint8Array => encoder.encode(text);
export const decodeUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

/**
 * Constant-time comparison. Used for the passphrase verifier, where a timing
 * side channel would otherwise leak how many leading bytes a guess got right.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}
