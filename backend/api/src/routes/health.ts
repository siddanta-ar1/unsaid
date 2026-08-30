import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '../db/client.js';
import { getStorage } from '../lib/storage.js';

/**
 * Health checks.
 *
 * `/health` is a liveness probe: is this process up. `/ready` actually reaches
 * its dependencies, because a check that returns "ok" unconditionally would
 * answer cheerfully with the database on fire — which is precisely when you
 * need it to tell you something.
 */

const DependencyStatus = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
});

const ReadyResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  checks: z.object({ database: DependencyStatus, storage: DependencyStatus }),
});

/** Times a probe and never lets its failure reason escape into the response. */
async function probe(check: () => Promise<unknown>): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    await check();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    // The error is deliberately swallowed: a health endpoint is unauthenticated
    // and a driver message can name hosts, users and schema.
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { response: { 200: z.object({ status: z.literal('ok'), version: z.string() }) } } },
    async () => ({ status: 'ok' as const, version: '0.1.0' }),
  );

  app.get(
    '/ready',
    { schema: { response: { 200: ReadyResponse, 503: ReadyResponse } } },
    async (request, reply) => {
      const [database, storage] = await Promise.all([
        probe(() => getDatabase().execute(sql`select 1`)),
        // HeadBucket proves the bucket exists and the credentials work,
        // without writing anything.
        probe(() => getStorage().checkReachable()),
      ]);

      const healthy = database.ok && storage.ok;
      if (!healthy) {
        request.log.error({ database: database.ok, storage: storage.ok }, 'readiness failed');
      }

      return reply.status(healthy ? 200 : 503).send({
        status: healthy ? ('ok' as const) : ('degraded' as const),
        version: '0.1.0',
        checks: { database, storage },
      });
    },
  );
};
