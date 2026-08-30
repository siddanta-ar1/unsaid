import { describe, expect, it } from 'vitest';
import { decodeUtf8, encodeUtf8, fromBase64Url, timingSafeEqual, toBase64Url } from './encoding.js';

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [0, 1, 2, 3, 31, 32, 255, 1024]) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('emits url-safe unpadded output', () => {
    const bytes = new Uint8Array([251, 255, 190, 239, 0, 1]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('utf8', () => {
  it('round-trips multi-byte text', () => {
    const text = 'मलाई भन्न मन थियो 🌙 — but I did not.';
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
  });
});

describe('timingSafeEqual', () => {
  it('compares content, not identity', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
