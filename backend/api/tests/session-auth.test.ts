import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createVault, sealText } from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

/**
 * What it takes to get a session.
 *
 * A session is not a read-only capability. It authorises deleting a memory,
 * *forgetting* one (which destroys the key and is irreversible), and
 * overwriting the wrapped vault key. So the bar for issuing one has to be
 * possession of the vault key itself — not knowledge of the vault's id.
 *
 * The id is not a secret by design: it is printed on the recovery kit and shown
 * in settings so a second device can find the vault. Anything reachable with it
 * alone is reachable by anyone who glances at that screen.
 */

let app: FastifyInstance;
let victimId: string;
let victimToken: string;
let victimVault: Awaited<ReturnType<typeof createVault>>;
let thoughtId: string;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  victimVault = await createVault('the victim passphrase for this suite');
  const res = await app.inject({
    method: 'POST',
    url: '/v1/identity/guest',
    payload: {
        passphrase: victimVault.passphrase,
        recovery: victimVault.recovery,
        loginProof: victimVault.loginProof,
      },
  });
  ({ userId: victimId, token: victimToken } = res.json());

  // Something worth protecting.
  const sealed = await sealText('the thing I could not say', victimVault.vaultKey, 1);
  const intent = await app.inject({
    method: 'POST',
    url: '/v1/thoughts/intents',
    headers: { authorization: `Bearer ${victimToken}` },
    payload: {
      type: 'text',
      byteSize: sealed.ciphertext.byteLength,
      contentHash: sealed.contentHash,
    },
  });
  await fetch(intent.json().uploadUrl, {
    method: 'PUT',
    body: sealed.ciphertext as unknown as BodyInit,
    headers: { 'content-type': 'application/octet-stream' },
  });
  const registered = await app.inject({
    method: 'POST',
    url: '/v1/thoughts',
    headers: { authorization: `Bearer ${victimToken}` },
    payload: {
      intentId: intent.json().intentId,
      wrappedKey: sealed.wrappedKey,
      header: sealed.header,
    },
  });
  thoughtId = registered.json().thought.id;
});

afterAll(async () => {
  if (victimId) await getDatabase().delete(users).where(eq(users.id, victimId));
  await app?.close();
});

describe('issuing a session', () => {
  it('refuses someone who knows only the vault id', async () => {
    // The id travels on a printed kit and is shown in settings. If this alone
    // opened a session, every one of the destructive paths below would be open
    // to anyone who saw that screen.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/login',
      payload: { userId: victimId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a fabricated proof', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/login',
      payload: { userId: victimId, proof: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses another vault's valid proof", async () => {
    const other = await createVault('some other persons passphrase');
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/identity/guest',
      payload: {
        passphrase: other.passphrase,
        recovery: other.recovery,
        loginProof: other.loginProof,
      },
    });
    const attacker = reg.json();

    const material = await app.inject({
      method: 'GET',
      url: `/v1/identity/unlock/${attacker.userId}`,
    });

    // A proof is bound to the vault it came from; replaying it elsewhere fails.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/login',
      payload: { userId: victimId, proof: material.json().loginProof ?? 'x'.repeat(43) },
    });
    expect(res.statusCode).toBe(401);

    await getDatabase().delete(users).where(eq(users.id, attacker.userId));
  });

  it('accepts proof derived from the real vault key', async () => {
    const { deriveLoginProof } = await import('@unsaid/crypto');
    const proof = await deriveLoginProof(victimVault.vaultKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/login',
      payload: { userId: victimId, proof },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('accepts proof reached through the recovery kit', async () => {
    const { unlockWithRecoveryCode, deriveLoginProof } = await import('@unsaid/crypto');

    const material = await app.inject({ method: 'GET', url: `/v1/identity/unlock/${victimId}` });
    const key = await unlockWithRecoveryCode(victimVault.recoveryCode, material.json().recovery);

    // Recovery has to reach the same session, or a forgotten passphrase would
    // still leave someone locked out of their own vault.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/login',
      payload: { userId: victimId, proof: await deriveLoginProof(key) },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('what a session without proof cannot do', () => {
  it('cannot destroy a memory', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/thoughts/${thoughtId}`,
      payload: { mode: 'cloud_delete' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('cannot forget a memory, which is irreversible', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/thoughts/${thoughtId}`,
      payload: { mode: 'forget' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('cannot overwrite the wrapped vault key', async () => {
    // The worst of the three: replacing this with anything at all locks the
    // real owner out permanently, even holding the correct passphrase.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/rotate',
      payload: { passphrase: victimVault.passphrase },
    });
    expect(res.statusCode).toBe(401);
  });

  it('leaves the vault intact after all of that', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/thoughts/${thoughtId}`,
      headers: { authorization: `Bearer ${victimToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().thought.status).toBe('active');
  });
});
