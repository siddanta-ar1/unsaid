import { describe, expect, it } from 'vitest';
import { ENVELOPE_VERSION } from '@unsaid/types';
import {
  CryptoVersionError,
  DecryptionError,
  computeCommitment,
  deriveThoughtSeed,
  open,
  openText,
  rewrapKey,
  seal,
  sealText,
} from './envelope.js';
import { createVerifier, deriveKek, newKdfParams, verifyPassphrase } from './kek.js';
import { encodeUtf8, fromBase64Url, toBase64Url } from './encoding.js';

// PBKDF2 at 600k iterations is deliberately slow. Derive one KEK per suite and
// reuse it, rather than paying that cost in every test.
const params = newKdfParams();
const kek = await deriveKek('correct horse battery staple', params);

describe('seal / open', () => {
  it('round-trips text', async () => {
    const secret = 'I did not want to say this to anyone today.';
    const sealed = await sealText(secret, kek, 1);
    const recovered = await openText(sealed.ciphertext, sealed.header, sealed.wrappedKey, kek);
    expect(recovered).toBe(secret);
  });

  it('round-trips binary audio-shaped payloads', async () => {
    const audio = new Uint8Array(64 * 1024);
    crypto.getRandomValues(audio);
    const sealed = await seal(audio, kek, 1);
    const recovered = await open(sealed.ciphertext, sealed.header, sealed.wrappedKey, kek);
    expect(recovered).toEqual(audio);
  });

  it('never leaves plaintext recognisable in the ciphertext', async () => {
    const marker = 'CANARY_PLAINTEXT_MARKER_9f3a';
    const sealed = await sealText(`prefix ${marker} suffix`, kek, 1);
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(sealed.ciphertext);
    expect(asText).not.toContain(marker);
    expect(JSON.stringify(sealed.header)).not.toContain(marker);
    expect(JSON.stringify(sealed.wrappedKey)).not.toContain(marker);
  });

  it('uses a fresh key and IV for every thought', async () => {
    const a = await sealText('same text', kek, 1);
    const b = await sealText('same text', kek, 1);
    expect(a.header.iv).not.toBe(b.header.iv);
    expect(a.wrappedKey.wrapped).not.toBe(b.wrappedKey.wrapped);
    // Identical plaintext must not produce identical ciphertext.
    expect(toBase64Url(a.ciphertext)).not.toBe(toBase64Url(b.ciphertext));
  });

  it('rejects a ciphertext altered in transit', async () => {
    const sealed = await sealText('tamper target', kek, 1);
    const tampered = new Uint8Array(sealed.ciphertext);
    tampered[0] = (tampered[0]! ^ 0xff) & 0xff;
    await expect(open(tampered, sealed.header, sealed.wrappedKey, kek)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('rejects a swapped IV', async () => {
    const sealed = await sealText('iv target', kek, 1);
    const other = await sealText('other', kek, 1);
    await expect(
      open(sealed.ciphertext, { ...sealed.header, iv: other.header.iv }, sealed.wrappedKey, kek),
    ).rejects.toThrow(DecryptionError);
  });

  it('refuses to decrypt under a different vault key', async () => {
    const otherKek = await deriveKek('a different passphrase', newKdfParams());
    const sealed = await sealText('not yours', kek, 1);
    await expect(open(sealed.ciphertext, sealed.header, sealed.wrappedKey, otherKek)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('refuses an unknown envelope version instead of guessing', async () => {
    const sealed = await sealText('future format', kek, 1);
    await expect(
      open(sealed.ciphertext, { ...sealed.header, v: 99 as never }, sealed.wrappedKey, kek),
    ).rejects.toThrow(CryptoVersionError);
  });

  it('stamps the current envelope version', async () => {
    const sealed = await sealText('versioned', kek, 1);
    expect(sealed.header.v).toBe(ENVELOPE_VERSION);
    expect(sealed.wrappedKey.keyVersion).toBe(1);
  });

  it('hashes the ciphertext, not the plaintext', async () => {
    const sealed = await sealText('hash me', kek, 1);
    const plaintextHash = toBase64Url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', encodeUtf8('hash me') as BufferSource)),
    );
    expect(sealed.contentHash).not.toBe(plaintextHash);
    expect(fromBase64Url(sealed.contentHash)).toHaveLength(32);
  });
});

describe('forgetting', () => {
  it('makes content permanently unreadable once the wrapped key is destroyed', async () => {
    const sealed = await sealText('forget this', kek, 1);
    // "Forget" deletes the wrapped key row while ciphertext may still exist in
    // a backup. Without the wrapped key there is no path back to the CEK.
    const orphaned = { ...sealed.wrappedKey, wrapped: toBase64Url(new Uint8Array(40)) };
    await expect(open(sealed.ciphertext, sealed.header, orphaned, kek)).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('key rotation', () => {
  it('re-wraps keys under a new KEK without rewriting ciphertext', async () => {
    const sealed = await sealText('survives rotation', kek, 1);
    const newKek = await deriveKek('rotated passphrase', newKdfParams());

    const rewrapped = await rewrapKey(sealed.wrappedKey, kek, newKek, 2);
    expect(rewrapped.keyVersion).toBe(2);

    const recovered = await openText(sealed.ciphertext, sealed.header, rewrapped, newKek);
    expect(recovered).toBe('survives rotation');
    // The old KEK no longer opens the rotated key.
    await expect(open(sealed.ciphertext, sealed.header, rewrapped, kek)).rejects.toThrow(
      DecryptionError,
    );
  });
});

describe('passphrase verifier', () => {
  it('accepts the right passphrase and rejects the wrong one', async () => {
    const verifier = await createVerifier(kek);
    expect(await verifyPassphrase(kek, verifier)).toBe(true);

    const wrong = await deriveKek('wrong passphrase', params);
    expect(await verifyPassphrase(wrong, verifier)).toBe(false);
  });

  it('does not embed the passphrase in the stored verifier', async () => {
    const passphrase = 'VERIFIER_CANARY_7b21';
    const localParams = newKdfParams();
    const localKek = await deriveKek(passphrase, localParams);
    const verifier = await createVerifier(localKek);
    expect(verifier).not.toContain(passphrase);
    expect(JSON.stringify(localParams)).not.toContain(passphrase);
  });
});

describe('commitment', () => {
  it('is stable for the same input and distinct across thoughts', async () => {
    const a = await computeCommitment('hashA', 'thought-1');
    const b = await computeCommitment('hashA', 'thought-1');
    const c = await computeCommitment('hashA', 'thought-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('reveals nothing about the underlying content', async () => {
    const sealed = await sealText('COMMITMENT_CANARY_4d8e', kek, 1);
    const commitment = await computeCommitment(sealed.contentHash, 'thought-1');
    expect(commitment).not.toContain('COMMITMENT_CANARY_4d8e');
    expect(fromBase64Url(commitment)).toHaveLength(32);
  });
});

describe('PDA seed derivation', () => {
  it('is deterministic and 32 bytes', async () => {
    const a = await deriveThoughtSeed('thought-1');
    const b = await deriveThoughtSeed('thought-1');
    expect(a).toBe(b);
    expect(fromBase64Url(a)).toHaveLength(32);
  });

  it('does not carry the thought id on chain', async () => {
    const id = 'SEED_CANARY_3f9b-0000-0000-0000-000000000000';
    const seed = await deriveThoughtSeed(id);
    // The seed appears in public chain data; the application id must not.
    expect(seed).not.toContain('SEED_CANARY_3f9b');
  });

  it('is domain-separated from the commitment', async () => {
    // Same input, different derivation domain — the two must never collide.
    const seed = await deriveThoughtSeed('thought-1');
    const commitment = await computeCommitment('thought-1', 'thought-1');
    expect(seed).not.toBe(commitment);
  });
});
