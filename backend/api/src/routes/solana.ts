import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AnchorRequest, AnchorResponse, ConfirmAnchorRequest, ConfirmAnchorResponse } from '@unsaid/types';
import { computeCommitment, deriveThoughtSeed } from '@unsaid/crypto';
import { UNSAID_PROGRAM_ID } from '@unsaid/solana';
import { getDatabase } from '../db/client.js';
import { solanaRecords, thoughts } from '../db/schema.js';
import { currentUserId, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { loadConfig } from '../lib/config.js';
import { track } from '../lib/analytics.js';
import { ANCHOR_LIMIT } from '../lib/rate-limits.js';

const IdParam = z.object({ id: z.uuid() });

/**
 * The ownership layer. Blueprint §14.
 *
 * What goes on chain: a commitment (a hash over the thought id and the
 * *ciphertext* hash) and an owner. That is the whole payload. The commitment
 * proves a particular encrypted object existed at a particular time; it reveals
 * nothing about what the object says, and it cannot be reversed.
 *
 * Anchoring is always optional. A user who never connects a wallet has a fully
 * working vault and no presence on chain at all (§14.5, D-04).
 */
export const solanaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post(
    '/v1/thoughts/:id/anchor',
    {
      config: { rateLimit: ANCHOR_LIMIT },
      schema: { params: IdParam, body: AnchorRequest, response: { 200: AnchorResponse } },
    },
    async (request) => {
      const db = getDatabase();
      const config = loadConfig();
      const userId = currentUserId(request);

      const [thought] = await db
        .select()
        .from(thoughts)
        .where(and(eq(thoughts.id, request.params.id), eq(thoughts.userId, userId)))
        .limit(1);
      if (!thought || thought.status !== 'active') throw AppError.notFound();

      const commitment = await computeCommitment(thought.contentHash, thought.id);

      /**
       * Idempotency key covers the thought and the owner, not the request. Two
       * submissions for the same anchor converge on one row, so a client that
       * retries after a timeout cannot create a duplicate record (§7 P1).
       */
      const idempotencyKey = `${thought.id}:${request.body.ownerPubkey}`;

      const [existing] = await db
        .select()
        .from(solanaRecords)
        .where(eq(solanaRecords.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing?.status === 'confirmed') {
        throw AppError.conflict('This memory is already anchored.');
      }

      if (!existing) {
        await db.insert(solanaRecords).values({
          thoughtId: thought.id,
          network: config.SOLANA_NETWORK,
          programId: config.SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID,
          commitment,
          idempotencyKey,
        });
      }

      /**
       * The transaction is assembled and signed in the client, where the wallet
       * lives. The server supplies the commitment and never holds a signing key
       * for a user (§22.2).
       *
       * The seed is a deterministic 32-byte digest of the thought id rather
       * than the id itself: PDA seeds are visible on chain, and an application
       * identifier that also appears in our database would link the two.
       */
      return {
        commitment,
        programId: config.SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID,
        network: config.SOLANA_NETWORK,
        thoughtSeed: await deriveThoughtSeed(thought.id),
      };
    },
  );

  app.post(
    '/v1/thoughts/:id/anchor/confirm',
    {
      schema: {
        params: IdParam,
        body: ConfirmAnchorRequest,
        response: { 200: ConfirmAnchorResponse },
      },
    },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);

      const [row] = await db
        .select({ record: solanaRecords })
        .from(solanaRecords)
        .innerJoin(thoughts, eq(thoughts.id, solanaRecords.thoughtId))
        .where(and(eq(solanaRecords.thoughtId, request.params.id), eq(thoughts.userId, userId)))
        .limit(1);
      if (!row) throw AppError.notFound();

      // Recording a signature the client reports is a convenience; the chain
      // remains the source of truth, and a webhook reconciles the real state.
      await db
        .update(solanaRecords)
        .set({ txSignature: request.body.signature, status: 'confirmed' })
        .where(eq(solanaRecords.id, row.record.id));

      track(request.log, {
        name: 'anchor_completed',
        network: row.record.network,
        status: 'confirmed',
      });

      return {
        thoughtId: request.params.id,
        signature: request.body.signature,
        status: 'confirmed' as const,
      };
    },
  );

  /** Read-back for the proof view: signature and record only, never content. */
  app.get(
    '/v1/thoughts/:id/anchor',
    {
      schema: {
        params: IdParam,
        response: {
          200: z.object({
            anchored: z.boolean(),
            network: z.string().nullable(),
            commitment: z.string().nullable(),
            signature: z.string().nullable(),
            programId: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);

      const [row] = await db
        .select({ record: solanaRecords })
        .from(solanaRecords)
        .innerJoin(thoughts, eq(thoughts.id, solanaRecords.thoughtId))
        .where(and(eq(solanaRecords.thoughtId, request.params.id), eq(thoughts.userId, userId)))
        .limit(1);

      if (!row) {
        return { anchored: false, network: null, commitment: null, signature: null, programId: null };
      }

      return {
        anchored: row.record.status === 'confirmed',
        network: row.record.network,
        commitment: row.record.commitment,
        signature: row.record.txSignature,
        programId: row.record.programId,
      };
    },
  );
};
