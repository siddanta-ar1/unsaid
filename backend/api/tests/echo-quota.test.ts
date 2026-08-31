import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { createVault, sealText } from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { reflections, thoughts, users } from '../src/db/schema.js';
import { loadConfig } from '../src/lib/config.js';

/**
 * The weekly Echo budget.
 *
 * Echo is the only unbounded cost in the system and the only path that sends
 * content to a third party. The hourly rate limit alone permits well over a
 * thousand calls a week per user, so the budget is what actually bounds both
 * the bill and the exposure.
 */

let app: FastifyInstance;
let token: string;
let userId: string;
let vaultKey: CryptoKey;
const quota = loadConfig().ECHO_WEEKLY_QUOTA;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  const vault = await createVault('a passphrase for the quota suite');
  vaultKey = vault.vaultKey;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/identity/guest',
    payload: {
        passphrase: vault.passphrase,
        recovery: vault.recovery,
        loginProof: vault.loginProof,
      },
  });
  ({ token, userId } = res.json());

  await app.inject({
    method: 'POST',
    url: '/v1/consents',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'ai_reflection_once', version: 1, granted: true },
  });
});

afterAll(async () => {
  if (userId) await getDatabase().delete(users).where(eq(users.id, userId));
  await app?.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

/** Saves one real thought so there is something to reflect on. */
async function saveThought(): Promise<string> {
  const sealed = await sealText('a thought for the quota suite', vaultKey, 1);
  const intent = await app.inject({
    method: 'POST',
    url: '/v1/thoughts/intents',
    headers: auth(),
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
    headers: auth(),
    payload: {
      intentId: intent.json().intentId,
      wrappedKey: sealed.wrappedKey,
      header: sealed.header,
    },
  });
  return registered.json().thought.id;
}

const reflect = (id: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/thoughts/${id}/reflect`,
    headers: auth(),
    payload: { consentVersion: 1, content: 'I keep replaying the same conversation.' },
  });

describe('the budget', () => {
  it('reports what is left, so the wall is never a surprise', async () => {
    const id = await saveThought();
    const res = await reflect(id);

    expect(res.statusCode).toBe(200);
    const { quota: reported } = res.json();
    expect(reported.limit).toBe(quota);
    expect(reported.remaining).toBe(quota - 1);
  });

  it('counts down as it is spent', async () => {
    const id = await saveThought();
    const first = (await reflect(id)).json().quota.remaining;
    const second = (await reflect(id)).json().quota.remaining;
    expect(second).toBe(first - 1);
  });

  it('refuses once the week is spent, before calling the provider', async () => {
    const id = await saveThought();

    // Backfill the rest of the week's usage directly rather than making the
    // real calls — the point is the ceiling, not the provider.
    const db = getDatabase();
    const rows = Array.from({ length: quota }, () => ({
      thoughtId: id,
      providerRef: 'echo-stub',
      modelVersion: 'echo-stub-v1',
    }));
    await db.insert(reflections).values(rows);

    const res = await reflect(id);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('says the memories are safe, since that is the fear', async () => {
    const id = await saveThought();
    const res = await reflect(id);
    expect(res.json().error.message).toMatch(/memories are unaffected/i);
    // And that it is temporary, not a permanent downgrade.
    expect(res.json().error.message).toMatch(/resets/i);
  });

  it('is distinguishable from being throttled for abuse', async () => {
    const id = await saveThought();
    const res = await reflect(id);
    // Both are 429, but a client that cannot tell them apart will either
    // retry a spent budget forever or treat throttling as permanent.
    expect(res.json().error.code).not.toBe('RATE_LIMITED');
  });
});

describe('what the budget counts', () => {
  it('is scoped to one user', async () => {
    // The exhausted user above must not affect anyone else.
    const other = await createVault('a different passphrase entirely');
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/identity/guest',
      payload: {
        passphrase: other.passphrase,
        recovery: other.recovery,
        loginProof: other.loginProof,
      },
    });
    const account = reg.json();

    await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: { authorization: `Bearer ${account.token}` },
      payload: { scope: 'ai_reflection_once', version: 1, granted: true },
    });

    const sealed = await sealText('a fresh thought', other.vaultKey, 1);
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/thoughts/intents',
      headers: { authorization: `Bearer ${account.token}` },
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
      headers: { authorization: `Bearer ${account.token}` },
      payload: {
        intentId: intent.json().intentId,
        wrappedKey: sealed.wrappedKey,
        header: sealed.header,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${registered.json().thought.id}/reflect`,
      headers: { authorization: `Bearer ${account.token}` },
      payload: { consentVersion: 1, content: 'something else entirely' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().quota.remaining).toBe(quota - 1);

    await getDatabase().delete(users).where(eq(users.id, account.userId));
  });

  it('ignores spending older than the window', async () => {
    const db = getDatabase();
    const owned = await db
      .select({ id: thoughts.id })
      .from(thoughts)
      .where(eq(thoughts.userId, userId));
    expect(owned.length).toBeGreaterThan(0);

    // Age *all* of this user's spending out of the rolling week, not just one
    // thought's — the budget is per user, so the test has to move the same set.
    await db
      .update(reflections)
      .set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(
        inArray(
          reflections.thoughtId,
          owned.map((row) => row.id),
        ),
      );

    const res = await reflect(owned[0]!.id);
    expect(res.statusCode).toBe(200);
  });
});
