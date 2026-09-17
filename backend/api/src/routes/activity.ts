import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '../db/client.js';
import { consentReceipts } from '../db/schema.js';
import { currentUserId, requireAuth } from '../lib/auth.js';
import { deriveSubject } from '../lib/consent-ledger.js';

/**
 * The access log.
 *
 * What this returns is our copy. It is convenient — it is indexed, it is fast,
 * and it knows about receipts that never made it to the chain — but it is not
 * the authority, and the client is expected to check it against the ledger
 * rather than believe it. That is why `subject` comes back with the list: it is
 * what a client needs to fetch the same receipts from a public RPC without
 * asking us anything.
 *
 * A row we failed to publish is returned as `pending` rather than hidden. A log
 * that omits the accesses it could not record would look complete while being
 * wrong, which is the failure mode this whole feature exists to prevent.
 */
const ActivityItem = z.object({
  thoughtId: z.uuid(),
  receiptId: z.string(),
  purpose: z.enum(['reflection', 'reflection_unattested', 'export', 'share']),
  consentVersion: z.number().int(),
  attestation: z.string().nullable(),
  resultHash: z.string(),
  network: z.string(),
  programId: z.string(),
  accountAddress: z.string().nullable(),
  signature: z.string().nullable(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  at: z.string(),
});

const ActivityResponse = z.object({
  /** Base64url digest of the vault. Lets the client read the same receipts from chain. */
  subject: z.string(),
  items: z.array(ActivityItem),
});

export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get(
    '/v1/activity',
    {
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: { 200: ActivityResponse },
      },
    },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);

      const rows = await db
        .select()
        .from(consentReceipts)
        .where(eq(consentReceipts.userId, userId))
        .orderBy(desc(consentReceipts.createdAt))
        .limit(request.query.limit);

      return {
        subject: Buffer.from(deriveSubject(userId)).toString('base64url'),
        items: rows.map((row) => ({
          thoughtId: row.thoughtId,
          receiptId: row.receiptId,
          purpose: row.purpose,
          consentVersion: row.consentVersion,
          attestation: row.attestation,
          resultHash: row.resultHash,
          network: row.network,
          programId: row.programId,
          accountAddress: row.accountAddress,
          signature: row.txSignature,
          status: row.status,
          at: row.createdAt.toISOString(),
        })),
      };
    },
  );
};
