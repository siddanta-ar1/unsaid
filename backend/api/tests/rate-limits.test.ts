import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createVault } from '@unsaid/crypto';
import { buildApp } from '../src/app.js';
import { getDatabase } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { REGISTER_LIMIT, UNLOCK_LIMIT } from '../src/lib/rate-limits.js';

/**
 * Rate limits, exercised rather than asserted.
 *
 * A budget nobody has watched trip is a comment. These drive real requests
 * until the limiter refuses, which is the only way to know the config is wired
 * to the route it names.
 */

let app: FastifyInstance;
const created: string[] = [];

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();
});

afterAll(async () => {
  const db = getDatabase();
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await app?.close();
});

describe('registration', () => {
  it(`refuses beyond ${REGISTER_LIMIT.max} vaults per ${REGISTER_LIMIT.timeWindow}`, async () => {
    let limited = false;

    // One more attempt than the budget allows. Each needs distinct key material,
    // or the conflict check would reject it before the limiter ever sees it.
    for (let i = 0; i <= REGISTER_LIMIT.max; i += 1) {
      const vault = await createVault(`bulk signup attempt number ${i}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/identity/guest',
        payload: {
        passphrase: vault.passphrase,
        recovery: vault.recovery,
        loginProof: vault.loginProof,
      },
      });

      if (res.statusCode === 429) {
        limited = true;
        expect(res.json().error.code).toBe('RATE_LIMITED');
        break;
      }
      if (res.statusCode === 201) created.push(res.json().userId);
    }

    expect(limited, 'bulk vault creation was never throttled').toBe(true);
  });
});

describe('unlock material', () => {
  it(`refuses beyond ${UNLOCK_LIMIT.max} fetches per ${UNLOCK_LIMIT.timeWindow}`, async () => {
    const target = created[0];
    if (!target) return; // Registration was throttled before creating one.

    let limited = false;
    for (let i = 0; i <= UNLOCK_LIMIT.max; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/v1/identity/unlock/${target}` });
      if (res.statusCode === 429) {
        limited = true;
        break;
      }
    }

    // Wrapped keys are PBKDF2-hardened, so this is depth rather than the actual
    // defence — but there is no legitimate reason to pull them in bulk.
    expect(limited, 'unlock material could be fetched without limit').toBe(true);
  });
});

describe('health checks', () => {
  it('is never throttled, however often a monitor polls', async () => {
    // A rate-limited health check reports an outage that is not happening.
    for (let i = 0; i < 200; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('the error envelope', () => {
  it('carries a request id when throttling', async () => {
    let throttled: ReturnType<typeof app.inject> extends Promise<infer T> ? T | null : null = null;

    for (let i = 0; i < REGISTER_LIMIT.max + 2; i += 1) {
      const vault = await createVault(`envelope check attempt ${i}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/identity/guest',
        payload: {
        passphrase: vault.passphrase,
        recovery: vault.recovery,
        loginProof: vault.loginProof,
      },
      });
      if (res.statusCode === 201) created.push(res.json().userId);
      if (res.statusCode === 429) {
        throttled = res;
        break;
      }
    }

    expect(throttled).not.toBeNull();
    const body = throttled?.json();
    // Same envelope as every other error, so a client needs no special case.
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.requestId).toBeTruthy();
  });
});
