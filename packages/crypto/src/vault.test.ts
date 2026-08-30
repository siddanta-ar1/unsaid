import { describe, expect, it } from 'vitest';
import { open, sealText, openText } from './envelope.js';
import {
  VaultKeyError,
  changePassphrase,
  createVault,
  encodeRecoveryCode,
  formatRecoveryKit,
  normaliseRecoveryCode,
  regenerateRecoveryKit,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
} from './vault.js';

// PBKDF2 at 600k iterations is deliberately slow; create one vault and reuse it
// wherever a test does not need a fresh one.
const PASSPHRASE = 'the quiet hour before sleep';
const vault = await createVault(PASSPHRASE);

describe('vault creation', () => {
  it('wraps one key two ways', async () => {
    expect(vault.passphrase.wrappedVaultKey).not.toBe(vault.recovery.wrappedVaultKey);

    // Both paths must land on the *same* key, or recovery restores nothing.
    const viaPassphrase = await unlockWithPassphrase(PASSPHRASE, vault.passphrase);
    const viaRecovery = await unlockWithRecoveryCode(vault.recoveryCode, vault.recovery);

    const sealed = await sealText('same key check', viaPassphrase, 1);
    await expect(openText(sealed.ciphertext, sealed.header, sealed.wrappedKey, viaRecovery)).resolves.toBe(
      'same key check',
    );
  });

  it('never persists the recovery code itself', () => {
    const stored = JSON.stringify({ passphrase: vault.passphrase, recovery: vault.recovery });
    const bare = normaliseRecoveryCode(vault.recoveryCode);
    expect(stored).not.toContain(vault.recoveryCode);
    expect(stored).not.toContain(bare);
  });

  it('issues a distinct vault key each time', async () => {
    const other = await createVault(PASSPHRASE);
    // Same passphrase, different vault: one must not open the other.
    await expect(unlockWithPassphrase(PASSPHRASE, other.passphrase)).resolves.toBeDefined();
    await expect(unlockWithRecoveryCode(vault.recoveryCode, other.recovery)).rejects.toThrow(
      VaultKeyError,
    );
  });
});

describe('unlocking', () => {
  it('rejects the wrong passphrase without a separate verifier', async () => {
    await expect(unlockWithPassphrase('not the phrase', vault.passphrase)).rejects.toThrow(
      VaultKeyError,
    );
  });

  it('rejects a wrong recovery code', async () => {
    const wrong = encodeRecoveryCode(new Uint8Array(20).fill(9));
    await expect(unlockWithRecoveryCode(wrong, vault.recovery)).rejects.toThrow(VaultKeyError);
  });

  it('accepts a code however a person actually types it', async () => {
    const messy = ` ${vault.recoveryCode.toLowerCase().replace(/-/g, ' ')} `;
    await expect(unlockWithRecoveryCode(messy, vault.recovery)).resolves.toBeDefined();
  });
});

describe('the scenario that would sink the pilot', () => {
  it('restores a vault after the passphrase is forgotten entirely', async () => {
    // Day one: someone writes something they could not say out loud.
    const fresh = await createVault('a phrase chosen carelessly on day one');
    const key = await unlockWithPassphrase('a phrase chosen carelessly on day one', fresh.passphrase);
    const sealed = await sealText('I have not told anyone about this.', key, 1);

    // Day nine: the phrase is gone. Only the printed kit survives.
    const recovered = await unlockWithRecoveryCode(fresh.recoveryCode, fresh.recovery);
    const reset = await changePassphrase(recovered, 'a phrase they will actually remember');

    // Everything written before the reset is still readable.
    const unlocked = await unlockWithPassphrase('a phrase they will actually remember', reset);
    await expect(openText(sealed.ciphertext, sealed.header, sealed.wrappedKey, unlocked)).resolves.toBe(
      'I have not told anyone about this.',
    );

    // And the forgotten phrase no longer works.
    await expect(
      unlockWithPassphrase('a phrase chosen carelessly on day one', reset),
    ).rejects.toThrow(VaultKeyError);
  });
});

describe('changing a passphrase', () => {
  it('leaves ciphertext and content keys untouched', async () => {
    const fresh = await createVault('original phrase for rotation');
    const key = await unlockWithPassphrase('original phrase for rotation', fresh.passphrase);
    const sealed = await sealText('written before the change', key, 1);

    const rotated = await changePassphrase(key, 'a brand new phrase entirely');
    const rotatedKey = await unlockWithPassphrase('a brand new phrase entirely', rotated);

    // The same wrapped content key still opens under the rotated vault key,
    // which is the point: nothing had to be re-uploaded or rewritten.
    const plaintext = await open(sealed.ciphertext, sealed.header, sealed.wrappedKey, rotatedKey);
    expect(new TextDecoder().decode(plaintext)).toBe('written before the change');
  });

  it('keeps the existing recovery kit working', async () => {
    const fresh = await createVault('phrase before rotation');
    const key = await unlockWithPassphrase('phrase before rotation', fresh.passphrase);
    await changePassphrase(key, 'phrase after rotation');

    // The kit wraps the vault key, not the passphrase, so it survives.
    await expect(unlockWithRecoveryCode(fresh.recoveryCode, fresh.recovery)).resolves.toBeDefined();
  });
});

describe('reissuing a recovery kit', () => {
  it('invalidates the previous code', async () => {
    const fresh = await createVault('phrase for kit reissue');
    const key = await unlockWithPassphrase('phrase for kit reissue', fresh.passphrase);

    const reissued = await regenerateRecoveryKit(key);
    expect(reissued.recoveryCode).not.toBe(fresh.recoveryCode);

    await expect(unlockWithRecoveryCode(reissued.recoveryCode, reissued.recovery)).resolves.toBeDefined();
    await expect(unlockWithRecoveryCode(fresh.recoveryCode, reissued.recovery)).rejects.toThrow(
      VaultKeyError,
    );
  });
});

describe('recovery code format', () => {
  it('avoids the characters people mistranscribe', () => {
    for (let i = 0; i < 40; i += 1) {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      // I, L, O and U are the classic transcription errors off a printed page.
      expect(encodeRecoveryCode(bytes)).not.toMatch(/[ILOU]/);
    }
  });

  it('is grouped for reading aloud and typing', () => {
    const code = encodeRecoveryCode(new Uint8Array(20).fill(0));
    expect(code).toMatch(/^([0-9A-Z]{4}-)+[0-9A-Z]{1,4}$/);
  });

  it('carries at least 128 bits of entropy', () => {
    const code = normaliseRecoveryCode(encodeRecoveryCode(new Uint8Array(20)));
    // 32 base32 characters at 5 bits each.
    expect(code.length * 5).toBeGreaterThanOrEqual(128);
  });
});

describe('the printable kit', () => {
  it('carries the vault id so a second device needs no pasted UUID', () => {
    const kit = formatRecoveryKit('11111111-2222-3333-4444-555555555555', vault.recoveryCode);
    expect(kit).toContain('11111111-2222-3333-4444-555555555555');
    expect(kit).toContain(vault.recoveryCode);
  });

  it('states plainly that it cannot be reissued to them', () => {
    const kit = formatRecoveryKit('vault-id', vault.recoveryCode);
    expect(kit).toMatch(/cannot send you another copy/i);
  });
});
