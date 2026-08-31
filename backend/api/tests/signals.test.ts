import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, like } from 'drizzle-orm';
import { createVault } from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { analyticsEvents, feedback, users, waitlist } from '../src/db/schema.js';

/**
 * The feedback loop, tested against real Postgres.
 *
 * The point of these tests is not that the endpoints respond — it is that
 * measuring cannot become surveillance. An event carrying content must be
 * rejected before it is stored, and the funnel must return counts rather than
 * anything resembling a per-person timeline.
 */

const MARKER = 'SIGNALS_CANARY_2c8d';
const COHORT = 'a'.repeat(32);

let app: FastifyInstance;
let token: string;
let userId: string;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  const vault = await createVault('a passphrase for the signals suite');
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
});

afterAll(async () => {
  const db = getDatabase();
  await db.delete(analyticsEvents).where(eq(analyticsEvents.cohortKey, COHORT));
  await db.delete(waitlist).where(like(waitlist.email, '%signals-suite%'));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  await app?.close();
});

const post = (url: string, payload: unknown, auth = false) =>
  app.inject({
    method: 'POST',
    url,
    ...(auth ? { headers: { authorization: `Bearer ${token}` } } : {}),
    payload,
  });

describe('analytics ingestion', () => {
  it('accepts a declared event', async () => {
    const res = await post('/v1/signals/events', {
      key: COHORT,
      event: { name: 'vault_created', platform: 'web' },
    });
    expect(res.statusCode).toBe(202);
  });

  it('rejects an event carrying an undeclared field', async () => {
    // This is the control that makes a content leak into analytics a schema
    // error rather than a judgement call.
    const res = await post('/v1/signals/events', {
      key: COHORT,
      event: { name: 'vault_created', platform: 'web', text: MARKER },
    });
    expect(res.statusCode).toBe(400);
  });

  it('never stores a rejected payload', async () => {
    await post('/v1/signals/events', {
      key: COHORT,
      event: { name: 'capture_completed', captureType: 'text', note: MARKER },
    });

    const rows = await getDatabase()
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.cohortKey, COHORT));
    expect(JSON.stringify(rows)).not.toContain(MARKER);
  });

  it('rejects an unknown event name outright', async () => {
    const res = await post('/v1/signals/events', {
      key: COHORT,
      event: { name: 'thought_text_captured', body: MARKER },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores only bucketed properties, never exact values', async () => {
    await post('/v1/signals/events', {
      key: COHORT,
      event: { name: 'private_save_completed', storageMode: 'cloud', encryptedSizeBucket: 'm' },
    });

    const rows = await getDatabase()
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.cohortKey, COHORT));
    const saved = rows.find((row) => row.name === 'private_save_completed');
    expect(saved?.properties).toContain('"encryptedSizeBucket":"m"');
    // A raw byte count would be a fingerprint; only the bucket is allowed.
    expect(saved?.properties).not.toMatch(/\d{4,}/);
  });

  it('is not joined to any user', async () => {
    const columns = Object.keys(analyticsEvents);
    expect(columns).not.toContain('userId');
    expect(columns).toContain('cohortKey');
  });
});

describe('feedback', () => {
  it('records the screen without any memory content', async () => {
    const res = await post('/v1/signals/feedback', {
      screen: 'capture',
      sentiment: 'confused',
      message: 'the phrase step surprised me',
    });
    expect(res.statusCode).toBe(202);

    const rows = await getDatabase().select().from(feedback);
    const latest = rows.at(-1);
    expect(latest?.screen).toBe('capture');
    expect(latest?.sentiment).toBe('confused');
  });

  it('works without a session, since a confused user may not have one', async () => {
    const res = await post('/v1/signals/feedback', { screen: 'unlock', sentiment: 'broken' });
    expect(res.statusCode).toBe(202);
  });

  it('rejects an unknown screen rather than storing free text', async () => {
    const res = await post('/v1/signals/feedback', { screen: MARKER, sentiment: 'other' });
    expect(res.statusCode).toBe(400);
  });

  it('caps the message so it cannot become a content channel', async () => {
    const res = await post('/v1/signals/feedback', {
      screen: 'vault',
      sentiment: 'other',
      message: 'x'.repeat(1001),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('waitlist', () => {
  it('normalises case so one person is one row', async () => {
    await post('/v1/signals/waitlist', { email: 'Signals-Suite@Example.COM' });
    const rows = await getDatabase()
      .select()
      .from(waitlist)
      .where(eq(waitlist.email, 'signals-suite@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('is idempotent and gives nothing away on a repeat', async () => {
    const first = await post('/v1/signals/waitlist', { email: 'signals-suite@example.com' });
    const second = await post('/v1/signals/waitlist', { email: 'signals-suite@example.com' });

    // Identical responses: the endpoint must not become an oracle for whether
    // an address is already on the list.
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.body).toBe(first.body);

    const rows = await getDatabase()
      .select()
      .from(waitlist)
      .where(eq(waitlist.email, 'signals-suite@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('rejects a malformed address', async () => {
    const res = await post('/v1/signals/waitlist', { email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
  });

  it('is never linked to a vault', async () => {
    // Joining this list must say nothing about whether someone uses UNSAID.
    expect(Object.keys(waitlist)).not.toContain('userId');
  });
});

describe('the funnel', () => {
  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/signals/funnel' });
    expect(res.statusCode).toBe(401);
  });

  it('returns counts, never rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/signals/funnel?days=30',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    for (const value of Object.values(body)) {
      expect(typeof value).toBe('number');
    }
    // No cohort keys, no ids, no timestamps that could rebuild a timeline.
    expect(JSON.stringify(body)).not.toContain(COHORT);
  });

  it('counts distinct cohorts rather than raw events', async () => {
    // Ten events from one browser is one activated person, not ten.
    for (let i = 0; i < 5; i += 1) {
      await post('/v1/signals/events', {
        key: COHORT,
        event: { name: 'vault_created', platform: 'web' },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/v1/signals/funnel?days=1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().vaultsCreated).toBeLessThan(5);
  });
});
