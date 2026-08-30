import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import {
  CreateIntentRequest,
  CreateIntentResponse,
  DeleteThoughtRequest,
  DeleteThoughtResponse,
  GetThoughtResponse,
  ListThoughtsQuery,
  ListThoughtsResponse,
  RegisterThoughtRequest,
  RegisterThoughtResponse,
  toSizeBucket,
} from '@unsaid/types';
import { getDatabase } from '../db/client.js';
import { contentKeys, objects, securityEvents, thoughts, uploadIntents } from '../db/schema.js';
import { currentUserId, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { getStorage } from '../lib/storage.js';
import { track } from '../lib/analytics.js';
import { UPLOAD_INTENT_LIMIT } from '../lib/rate-limits.js';

const IdParam = z.object({ id: z.uuid() });

/**
 * The capture and vault surface. Every handler here receives ciphertext,
 * wrapped keys and sizes — never content. That is not a convention enforced by
 * review: there is no request schema in this file with a content field.
 */
export const thoughtRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireAuth);

  /** Step 1-3 of §17.3: reserve an object key and hand back a signed PUT URL. */
  app.post(
    '/v1/thoughts/intents',
    {
      config: { rateLimit: UPLOAD_INTENT_LIMIT },
      schema: { body: CreateIntentRequest, response: { 201: CreateIntentResponse } },
    },
    async (request, reply) => {
      const db = getDatabase();
      const storage = getStorage();
      const userId = currentUserId(request);
      const { type, byteSize, contentHash } = request.body;

      const ref = storage.newObjectKey();
      const upload = await storage.createUploadUrl(ref.objectKey, byteSize);

      const [object] = await db
        .insert(objects)
        .values({
          objectKey: ref.objectKey,
          bucket: ref.bucket,
          sizeBytes: byteSize,
          checksum: contentHash,
        })
        .returning({ id: objects.id });
      if (!object) throw AppError.internal();

      const [intent] = await db
        .insert(uploadIntents)
        .values({
          userId,
          objectId: object.id,
          type,
          declaredSize: byteSize,
          declaredHash: contentHash,
          expiresAt: upload.expiresAt,
        })
        .returning({ id: uploadIntents.id });
      if (!intent) throw AppError.internal();

      return reply.status(201).send({
        intentId: intent.id,
        objectId: object.id,
        uploadUrl: upload.url,
        expiresAt: upload.expiresAt.toISOString(),
      });
    },
  );

  /** Step 5-6: register metadata once the ciphertext is in object storage. */
  app.post(
    '/v1/thoughts',
    { schema: { body: RegisterThoughtRequest, response: { 201: RegisterThoughtResponse } } },
    async (request, reply) => {
      const db = getDatabase();
      const storage = getStorage();
      const userId = currentUserId(request);
      const { intentId, wrappedKey, header } = request.body;

      const [intent] = await db
        .select()
        .from(uploadIntents)
        .where(and(eq(uploadIntents.id, intentId), eq(uploadIntents.userId, userId)))
        .limit(1);
      if (!intent) throw AppError.notFound();
      if (intent.claimedAt) throw AppError.conflict('This upload was already registered.');
      if (intent.expiresAt.getTime() < Date.now()) throw AppError.uploadExpired();

      const [object] = await db
        .select()
        .from(objects)
        .where(eq(objects.id, intent.objectId))
        .limit(1);
      if (!object) throw AppError.notFound();

      // Trust the object store, not the client, about what was actually written.
      const uploaded = await storage.verifyUpload(object.objectKey, intent.declaredSize);
      if (!uploaded) {
        throw new AppError('VALIDATION_FAILED', 'No matching upload was found for this intent.');
      }

      const created = await db.transaction(async (tx) => {
        await tx.update(objects).set({ uploaded: true }).where(eq(objects.id, object.id));
        await tx
          .update(uploadIntents)
          .set({ claimedAt: new Date() })
          .where(eq(uploadIntents.id, intent.id));

        const [thought] = await tx
          .insert(thoughts)
          .values({
            userId,
            objectId: object.id,
            type: intent.type,
            contentHash: intent.declaredHash,
            encryptionVersion: header.v,
            iv: header.iv,
            algorithm: header.alg,
            byteSize: intent.declaredSize,
          })
          .returning();
        if (!thought) throw AppError.internal();

        await tx.insert(contentKeys).values({
          thoughtId: thought.id,
          wrappedKey: wrappedKey.wrapped,
          wrapAlgorithm: wrappedKey.alg,
          keyVersion: wrappedKey.keyVersion,
        });

        return thought;
      });

      track(request.log, {
        name: 'private_save_completed',
        storageMode: 'cloud',
        encryptedSizeBucket: toSizeBucket(intent.declaredSize),
      });

      return reply.status(201).send({ thought: toMetadata(created) });
    },
  );

  /** The vault timeline. Metadata only — no keys, no signed URLs. */
  app.get(
    '/v1/thoughts',
    { schema: { querystring: ListThoughtsQuery, response: { 200: ListThoughtsResponse } } },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);
      const { cursor, limit, status } = request.query;

      const cursorDate = cursor ? new Date(cursor) : undefined;
      const rows = await db
        .select()
        .from(thoughts)
        .where(
          and(
            eq(thoughts.userId, userId),
            eq(thoughts.status, status),
            cursorDate ? lt(thoughts.createdAt, cursorDate) : undefined,
          ),
        )
        .orderBy(desc(thoughts.createdAt))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const next = rows.length > limit ? page.at(-1)?.createdAt.toISOString() ?? null : null;

      return { thoughts: page.map(toMetadata), nextCursor: next };
    },
  );

  /** Everything the client needs to decrypt one thought, and nothing more. */
  app.get(
    '/v1/thoughts/:id',
    { schema: { params: IdParam, response: { 200: GetThoughtResponse } } },
    async (request) => {
      const db = getDatabase();
      const storage = getStorage();
      const userId = currentUserId(request);

      // Status is resolved before joining. A forgotten thought has no content
      // key and no object, so joining first would make it indistinguishable
      // from one that never existed — and the user is owed a clearer answer
      // than that about a memory they deliberately destroyed (§12.4).
      const [thought] = await db
        .select()
        .from(thoughts)
        // Ownership is part of the query, so an IDOR attempt returns no row at
        // all rather than relying on a later check (§13.3).
        .where(and(eq(thoughts.id, request.params.id), eq(thoughts.userId, userId)))
        .limit(1);

      if (!thought || thought.status === 'deleted') throw AppError.notFound();
      if (thought.status === 'forgotten') {
        throw new AppError(
          'CRYPTO_VERSION_UNSUPPORTED',
          'This memory was forgotten and can no longer be decrypted.',
        );
      }

      const [row] = await db
        .select({ key: contentKeys, object: objects })
        .from(thoughts)
        .innerJoin(contentKeys, eq(contentKeys.thoughtId, thoughts.id))
        .innerJoin(objects, eq(objects.id, thoughts.objectId))
        .where(eq(thoughts.id, thought.id))
        .limit(1);
      if (!row) throw AppError.notFound();

      const download = await storage.createDownloadUrl(row.object.objectKey);

      return {
        thought: {
          ...toMetadata(thought),
          wrappedKey: {
            v: 1 as const,
            alg: 'AES-KW-256' as const,
            keyVersion: row.key.keyVersion,
            wrapped: row.key.wrappedKey,
          },
          header: { v: thought.encryptionVersion, alg: thought.algorithm, iv: thought.iv },
          downloadUrl: download.url,
          downloadExpiresAt: download.expiresAt.toISOString(),
        },
      };
    },
  );

  /**
   * Deletion (§12.4). Two modes with genuinely different guarantees:
   *   cloud_delete — remove the row and the stored object.
   *   forget       — destroy the wrapped key first, so that even a surviving
   *                  backup copy of the ciphertext is undecryptable.
   */
  app.delete(
    '/v1/thoughts/:id',
    {
      schema: {
        params: IdParam,
        body: DeleteThoughtRequest,
        response: { 200: DeleteThoughtResponse },
      },
    },
    async (request) => {
      const db = getDatabase();
      const storage = getStorage();
      const userId = currentUserId(request);
      const { mode } = request.body;

      if (mode === 'local_discard') {
        throw new AppError(
          'VALIDATION_FAILED',
          'Local discard never reaches the server; nothing was uploaded.',
        );
      }

      const [row] = await db
        .select({ thought: thoughts, object: objects })
        .from(thoughts)
        .leftJoin(objects, eq(objects.id, thoughts.objectId))
        .where(and(eq(thoughts.id, request.params.id), eq(thoughts.userId, userId)))
        .limit(1);
      if (!row) throw AppError.notFound();

      // Key destruction happens before object deletion. If the process dies
      // between the two, the content is already unrecoverable — the failure
      // mode leans towards more privacy, not less.
      await db.delete(contentKeys).where(eq(contentKeys.thoughtId, row.thought.id));

      const objectRemoved = row.object ? await storage.deleteObject(row.object.objectKey) : true;

      const status = mode === 'forget' ? ('forgotten' as const) : ('deleted' as const);
      await db
        .update(thoughts)
        .set({ status, deletedAt: new Date(), objectId: null, updatedAt: new Date() })
        .where(eq(thoughts.id, row.thought.id));

      if (row.object && objectRemoved) {
        await db.delete(objects).where(eq(objects.id, row.object.id));
      }

      await db.insert(securityEvents).values({
        eventType: `thought_${status}`,
        subjectId: userId,
        actorType: 'user',
        detail: mode,
      });

      track(request.log, { name: 'thought_deleted', deletionMode: mode });

      return { id: row.thought.id, status, objectRemoved };
    },
  );
};

type ThoughtRow = typeof thoughts.$inferSelect;

function toMetadata(row: ThoughtRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    contentHash: row.contentHash,
    encryptionVersion: row.encryptionVersion,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    anchored: false,
  };
}
