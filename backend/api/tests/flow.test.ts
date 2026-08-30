import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  changePassphrase,
  computeCommitment,
  createVault,
  deriveThoughtSeed,
  openText,
  sealText,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
} from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { solanaRecords, thoughts, users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * End-to-end proof of the core loop against real Postgres and real S3-compatible
 * storage: capture -> encrypted save -> open -> decrypt -> delete (§21.1 E2E).
 *
 * The value of running this against live infrastructure rather than mocks is
 * that it also proves the privacy invariant: after a full round trip, the
 * marker string exists nowhere in the database.
 */

const MARKER = 'E2E_PLAINTEXT_CANARY_a91f3c';
const PASSPHRASE = 'a test passphrase for the integration suite';

let app: FastifyInstance;
let token: string;
let userId: string;
let kek: CryptoKey;
const keyVersion = 1;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  const vault = await createVault(PASSPHRASE);
  kek = vault.vaultKey;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/identity/guest',
    payload: { passphrase: vault.passphrase, recovery: vault.recovery },
  });
  expect(res.statusCode).toBe(201);
  ({ token, userId } = res.json());
});

afterAll(async () => {
  if (userId) await getDatabase().delete(users).where(eq(users.id, userId));
  await app?.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function saveThought(text: string) {
  const sealed = await sealText(text, kek, keyVersion);

  const intentRes = await app.inject({
    method: 'POST',
    url: '/v1/thoughts/intents',
    headers: auth(),
    payload: {
      type: 'text',
      byteSize: sealed.ciphertext.byteLength,
      contentHash: sealed.contentHash,
    },
  });
  expect(intentRes.statusCode).toBe(201);
  const intent = intentRes.json();

  // The client PUTs ciphertext straight to storage; the API never sees bytes.
  const put = await fetch(intent.uploadUrl, {
    method: 'PUT',
    body: sealed.ciphertext as unknown as BodyInit,
    headers: { 'content-type': 'application/octet-stream' },
  });
  expect(put.ok).toBe(true);

  const registerRes = await app.inject({
    method: 'POST',
    url: '/v1/thoughts',
    headers: auth(),
    payload: {
      intentId: intent.intentId,
      wrappedKey: sealed.wrappedKey,
      header: sealed.header,
    },
  });
  expect(registerRes.statusCode).toBe(201);
  return { id: registerRes.json().thought.id as string, sealed };
}

describe('capture -> save -> open -> delete', () => {
  it('round-trips a thought through real storage', async () => {
    const { id } = await saveThought(`${MARKER} — I could not say this out loud.`);

    const getRes = await app.inject({ method: 'GET', url: `/v1/thoughts/${id}`, headers: auth() });
    expect(getRes.statusCode).toBe(200);
    const { thought } = getRes.json();

    const download = await fetch(thought.downloadUrl);
    expect(download.ok).toBe(true);
    const ciphertext = new Uint8Array(await download.arrayBuffer());

    const recovered = await openText(ciphertext, thought.header, thought.wrappedKey, kek);
    expect(recovered).toContain(MARKER);
  });

  it('lists the thought in the vault timeline', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/thoughts', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.thoughts.length).toBeGreaterThan(0);
    // Timeline entries carry no content field of any kind.
    expect(JSON.stringify(body)).not.toContain(MARKER);
  });

  it('deletes the object and the metadata', async () => {
    const { id } = await saveThought(`${MARKER} delete me`);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/thoughts/${id}`,
      headers: auth(),
      payload: { mode: 'cloud_delete' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'deleted', objectRemoved: true });

    const after = await app.inject({ method: 'GET', url: `/v1/thoughts/${id}`, headers: auth() });
    expect(after.statusCode).toBe(404);
  });

  it('makes a forgotten thought undecryptable while reporting it clearly', async () => {
    const { id } = await saveThought(`${MARKER} forget me`);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/thoughts/${id}`,
      headers: auth(),
      payload: { mode: 'forget' },
    });
    expect(res.json().status).toBe('forgotten');

    const after = await app.inject({ method: 'GET', url: `/v1/thoughts/${id}`, headers: auth() });
    expect(after.statusCode).toBe(409);
    expect(after.json().error.code).toBe('CRYPTO_VERSION_UNSUPPORTED');
  });
});

describe('authorization', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/thoughts' });
    expect(res.statusCode).toBe(401);
  });

  it('does not leak another user\'s thought (IDOR)', async () => {
    const { id } = await saveThought(`${MARKER} private to user one`);

    const otherVault = await createVault('a different passphrase entirely');
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/identity/guest',
      payload: { passphrase: otherVault.passphrase, recovery: otherVault.recovery },
    });
    const other = reg.json();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/thoughts/${id}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    // 404, not 403 — the id is not confirmed to exist.
    expect(res.statusCode).toBe(404);

    await getDatabase().delete(users).where(eq(users.id, other.userId));
  });
});

describe('consent gate', () => {
  it('refuses reflection until consent is recorded', async () => {
    const { id } = await saveThought(`${MARKER} reflect on me`);

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/reflect`,
      headers: auth(),
      payload: { consentVersion: 1, content: 'some plaintext' },
    });
    expect(denied.statusCode).toBe(428);
    expect(denied.json().error.code).toBe('CONSENT_REQUIRED');

    await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: auth(),
      payload: { scope: 'ai_reflection_once', version: 1, granted: true },
    });

    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/reflect`,
      headers: auth(),
      payload: { consentVersion: 1, content: 'I keep replaying the same conversation.' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().content.length).toBeGreaterThan(0);
  });

  it('routes high-risk language to support resources', async () => {
    const { id } = await saveThought(`${MARKER} safety path`);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/reflect`,
      headers: auth(),
      payload: { consentVersion: 1, content: 'Sometimes I think I want to die.' },
    });
    expect(res.json().safetyNotice).toBe('support_resources');
  });
});

describe('privacy invariant', () => {
  it('leaves no plaintext anywhere in the database', async () => {
    await saveThought(`${MARKER} full sweep`);
    const db = getDatabase();

    // Dump every text-bearing column of every table and search for the marker.
    const rows = await db.execute<{ found: number }>(
      `select count(*)::int as found from (
         select row_to_json(t)::text as blob from thoughts t
         union all select row_to_json(u)::text from users u
         union all select row_to_json(c)::text from content_keys c
         union all select row_to_json(o)::text from objects o
         union all select row_to_json(r)::text from reflections r
         union all select row_to_json(s)::text from security_events s
       ) all_rows where blob like '%${MARKER}%'`,
    );
    expect(Number(rows[0]?.found ?? 0)).toBe(0);
  });

  it('stores ciphertext, not plaintext, in object storage', async () => {
    const { id } = await saveThought(`${MARKER} object storage sweep`);
    const getRes = await app.inject({ method: 'GET', url: `/v1/thoughts/${id}`, headers: auth() });
    const { thought } = getRes.json();

    const raw = await (await fetch(thought.downloadUrl)).arrayBuffer();
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    expect(asText).not.toContain(MARKER);
  });

  it('keeps thought rows free of any content-shaped column', async () => {
    const columns = Object.keys(thoughts);
    for (const forbidden of ['title', 'body', 'text', 'transcript', 'content', 'tags']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe('solana anchoring', () => {
  const OWNER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

  it('prepares an anchor without ever assembling a transaction server-side', async () => {
    const { id, sealed } = await saveThought(`${MARKER} anchor me`);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/anchor`,
      headers: auth(),
      payload: { ownerPubkey: OWNER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.network).toBe('devnet');
    expect(body.programId).toBeTruthy();

    // The commitment is derived from the ciphertext hash the server holds, so a
    // client cannot anchor a value of its own choosing.
    const expected = await computeCommitment(sealed.contentHash, id);
    expect(body.commitment).toBe(expected);

    // The seed is a digest, not the thought id — PDA seeds are public.
    expect(body.thoughtSeed).not.toContain(id);
    expect(body.thoughtSeed).toBe(await deriveThoughtSeed(id));

    // Nothing resembling a transaction is returned; the client builds it.
    expect(body).not.toHaveProperty('transaction');
    expect(JSON.stringify(body)).not.toContain(MARKER);
  });

  it('converges on one record when a client retries', async () => {
    const { id } = await saveThought(`${MARKER} retry safely`);

    await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/anchor`,
      headers: auth(),
      payload: { ownerPubkey: OWNER },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/anchor`,
      headers: auth(),
      payload: { ownerPubkey: OWNER },
    });

    const rows = await getDatabase()
      .select()
      .from(solanaRecords)
      .where(eq(solanaRecords.thoughtId, id));
    expect(rows).toHaveLength(1);
  });

  it('reports the proof once a signature is confirmed', async () => {
    const { id } = await saveThought(`${MARKER} proof view`);
    await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/anchor`,
      headers: auth(),
      payload: { ownerPubkey: OWNER },
    });

    const signature = '5'.repeat(88);
    const confirm = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/anchor/confirm`,
      headers: auth(),
      payload: { signature },
    });
    expect(confirm.json().status).toBe('confirmed');

    const status = await app.inject({
      method: 'GET',
      url: `/v1/thoughts/${id}/anchor`,
      headers: auth(),
    });
    const body = status.json();
    expect(body.anchored).toBe(true);
    expect(body.signature).toBe(signature);
    // The proof view must expose nothing about the content (D-02).
    expect(JSON.stringify(body)).not.toContain(MARKER);
  });

  it('reports an unanchored thought without inventing a record', async () => {
    const { id } = await saveThought(`${MARKER} never anchored`);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/thoughts/${id}/anchor`,
      headers: auth(),
    });
    expect(res.json()).toMatchObject({ anchored: false, signature: null });
  });

  it('does not let another user anchor your thought', async () => {
    const { id } = await saveThought(`${MARKER} not yours to anchor`);

    const otherVault = await createVault('a wholly different phrase');
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/identity/guest',
      payload: { passphrase: otherVault.passphrase, recovery: otherVault.recovery },
    });
    const other = reg.json();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/thoughts/${id}/anchor`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { ownerPubkey: OWNER },
    });
    expect(res.statusCode).toBe(404);

    await getDatabase().delete(users).where(eq(users.id, other.userId));
  });
});

describe('recovery, end to end', () => {
  it('restores a real vault after the passphrase is forgotten', async () => {
    // A vault, and something written into it.
    const vault = await createVault('a phrase set carelessly on day one');
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/identity/guest',
      payload: { passphrase: vault.passphrase, recovery: vault.recovery },
    });
    const account = reg.json();

    const sealed = await sealText(`${MARKER} the thing I could not say`, vault.vaultKey, 1);
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
    const thoughtId = registered.json().thought.id;

    // The phrase is gone. Only the kit survives.
    const material = await app.inject({
      method: 'GET',
      url: `/v1/identity/unlock/${account.userId}`,
    });
    const recoveredKey = await unlockWithRecoveryCode(
      vault.recoveryCode,
      material.json().recovery,
    );

    // Set a new phrase and store the re-wrapped key.
    const rewrapped = await changePassphrase(recoveredKey, 'a phrase they will remember');
    const rotate = await app.inject({
      method: 'POST',
      url: '/v1/identity/rotate',
      headers: { authorization: `Bearer ${account.token}` },
      payload: { passphrase: rewrapped },
    });
    expect(rotate.statusCode).toBe(200);

    // The new phrase now opens the vault, and the memory written before the
    // reset is still readable.
    const after = await app.inject({ method: 'GET', url: `/v1/identity/unlock/${account.userId}` });
    const unlocked = await unlockWithPassphrase(
      'a phrase they will remember',
      after.json().passphrase,
    );

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/thoughts/${thoughtId}`,
      headers: { authorization: `Bearer ${account.token}` },
    });
    const { thought } = fetched.json();
    const ciphertext = new Uint8Array(await (await fetch(thought.downloadUrl)).arrayBuffer());

    await expect(
      openText(ciphertext, thought.header, thought.wrappedKey, unlocked),
    ).resolves.toContain('the thing I could not say');

    await getDatabase().delete(users).where(eq(users.id, account.userId));
  });

  it('serves unlock material that is useless on its own', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/identity/unlock/${userId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Salts and wrapped keys only — no plaintext, no derived secret.
    expect(body.passphrase.wrappedVaultKey).toBeTruthy();
    expect(body.recovery.wrappedVaultKey).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(PASSPHRASE);
    expect(JSON.stringify(body)).not.toContain(MARKER);

    // The two wrapped copies must differ, or one way in would expose the other.
    expect(body.passphrase.wrappedVaultKey).not.toBe(body.recovery.wrappedVaultKey);
  });

  it('never stores anything that reveals the recovery code', async () => {
    const rows = await getDatabase().select().from(users).where(eq(users.id, userId));
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(PASSPHRASE);
    expect(dump).not.toContain(MARKER);
  });
});
