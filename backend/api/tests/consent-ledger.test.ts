import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createVault, sealText } from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { consentReceipts, users } from '../src/db/schema.js';
import { hashReflection } from '../src/lib/consent-ledger.js';

/**
 * The consent ledger.
 *
 * Echo is the one place the invariant bends: a memory is read by something that
 * is not the user. The receipt is what makes that bend visible afterwards, so
 * the property under test is not "a row appears" but "the row cannot lie" —
 * about what ran, about which wording was agreed to, or about content.
 */

let app: FastifyInstance;
let token: string;
let userId: string;
let vaultKey: CryptoKey;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  const vault = await createVault('a passphrase for the ledger suite');
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

async function saveThought(): Promise<string> {
  const sealed = await sealText('a thought for the ledger suite', vaultKey, 1);
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

const activity = () => app.inject({ method: 'GET', url: '/v1/activity', headers: auth() });

describe('a reflection leaves a receipt', () => {
  it('records the access, the wording agreed to, and nothing else', async () => {
    const id = await saveThought();
    const reflected = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/reflect`,
      headers: auth(),
      payload: { consentVersion: 1, content: 'I keep replaying the same conversation.' },
    });
    expect(reflected.statusCode).toBe(200);

    const { items, subject } = (await activity()).json();

    expect(subject).toMatch(/^[\w-]{43}$/);
    const receipt = items.find((item: { thoughtId: string }) => item.thoughtId === id);
    expect(receipt).toBeDefined();
    expect(receipt.consentVersion).toBe(1);
    expect(receipt.resultHash).toBe(
      hashReflection(reflected.json().reflectionId, reflected.json().content),
    );
  });

  it('says so when it could not prove what ran, rather than leaving a gap', async () => {
    const id = await saveThought();
    await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/reflect`,
      headers: auth(),
      payload: { consentVersion: 1, content: 'Another thing I have not said.' },
    });

    const { items } = (await activity()).json();
    const receipt = items.find((item: { thoughtId: string }) => item.thoughtId === id);

    // The stub provider cannot attest anything, so the honest record is the
    // unattested purpose with no measurement — not an ordinary reflection with
    // a missing field, which would read as an oversight rather than a fact.
    expect(receipt.purpose).toBe('reflection_unattested');
    expect(receipt.attestation).toBeNull();
  });

  it('keeps a receipt it could not publish, instead of hiding it', async () => {
    const id = await saveThought();
    await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/reflect`,
      headers: auth(),
      payload: { consentVersion: 1, content: 'Something else entirely.' },
    });

    const { items } = (await activity()).json();
    const receipt = items.find((item: { thoughtId: string }) => item.thoughtId === id);

    // No recorder key is configured in the test environment, so nothing reaches
    // a chain. A log that quietly dropped those rows would look complete while
    // being wrong about the only thing it exists to report.
    expect(receipt.status).toBe('pending');
    expect(receipt.signature).toBeNull();
  });

  it('holds nothing that could reconstruct the memory or the answer', async () => {
    const rows = await getDatabase()
      .select()
      .from(consentReceipts)
      .where(eq(consentReceipts.userId, userId));

    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows);
    // Every word that went through Echo in this suite, and the words that came
    // back from the stub. None of them may appear in the ledger's own storage.
    for (const fragment of [
      'replaying',
      'conversation',
      'Another thing',
      'Something else',
      'ledger suite',
    ]) {
      expect(serialised).not.toContain(fragment);
    }
  });
});
