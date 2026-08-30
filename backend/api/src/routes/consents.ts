import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ConsentRequest, ConsentResponse } from '@unsaid/types';
import { getDatabase } from '../db/client.js';
import { consents, securityEvents } from '../db/schema.js';
import { currentUserId, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

/**
 * Consent is versioned. Granting version 1 does not grant version 2 — if the
 * disclosure text changes, the user is asked again (§18.2).
 */
export const consentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post(
    '/v1/consents',
    { schema: { body: ConsentRequest, response: { 200: ConsentResponse } } },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);
      const { scope, version, granted } = request.body;
      const now = new Date();

      const values = {
        userId,
        scope,
        version,
        acceptedAt: granted ? now : null,
        revokedAt: granted ? null : now,
      };

      const [row] = await db
        .insert(consents)
        .values(values)
        .onConflictDoUpdate({
          target: [consents.userId, consents.scope],
          set: { version, acceptedAt: values.acceptedAt, revokedAt: values.revokedAt },
        })
        .returning();
      if (!row) throw AppError.internal();

      await db.insert(securityEvents).values({
        eventType: granted ? 'consent_granted' : 'consent_revoked',
        subjectId: userId,
        actorType: 'user',
        detail: `${scope}@v${version}`,
      });

      return {
        scope: row.scope as never,
        version: row.version,
        granted: Boolean(row.acceptedAt && !row.revokedAt),
        updatedAt: (row.acceptedAt ?? row.revokedAt ?? now).toISOString(),
      };
    },
  );

  app.get(
    '/v1/consents',
    { schema: { response: { 200: z.object({ consents: z.array(ConsentResponse) }) } } },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);
      const rows = await db.select().from(consents).where(eq(consents.userId, userId));

      return {
        consents: rows.map((row) => ({
          scope: row.scope as never,
          version: row.version,
          granted: Boolean(row.acceptedAt && !row.revokedAt),
          updatedAt: (row.acceptedAt ?? row.revokedAt ?? new Date()).toISOString(),
        })),
      };
    },
  );

  /** Revokes every consent at once — the "turn everything off" control. */
  app.post(
    '/v1/consents/revoke-all',
    { schema: { response: { 200: z.object({ revoked: z.number().int() }) } } },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);
      const rows = await db
        .update(consents)
        .set({ revokedAt: new Date(), acceptedAt: null })
        .where(and(eq(consents.userId, userId)))
        .returning({ id: consents.id });

      return { revoked: rows.length };
    },
  );
};
