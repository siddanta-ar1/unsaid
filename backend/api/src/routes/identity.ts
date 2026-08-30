import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  KdfParams,
  LoginRequest,
  LoginResponse,
  RegisterGuestRequest,
  RegisterGuestResponse,
  SessionResponse,
} from '@unsaid/types';
import { deriveAccountLookup } from '@unsaid/crypto';
import { getDatabase } from '../db/client.js';
import { thoughts, users } from '../db/schema.js';
import { currentUserId, issueSession, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

/**
 * Identity is deliberately minimal: no email, no password on the server. The
 * user picks a passphrase, derives a key locally, and the server stores only
 * what is needed to recognise them again — a salt, KDF parameters and a
 * verifier (§9.2 "Guest/local identity").
 */
export const identityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/identity/guest',
    { schema: { body: RegisterGuestRequest, response: { 201: RegisterGuestResponse } } },
    async (request, reply) => {
      const db = getDatabase();
      const { kdf, verifier } = request.body;
      const accountLookup = await deriveAccountLookup(kdf);

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.accountLookup, accountLookup))
        .limit(1);
      if (existing.length > 0) {
        throw AppError.conflict('An account already exists for this vault key.');
      }

      const [created] = await db
        .insert(users)
        .values({
          accountLookup,
          kdfSalt: kdf.salt,
          kdfIterations: kdf.iterations,
          kdfAlgorithm: kdf.alg,
          verifier,
        })
        .returning({ id: users.id });
      if (!created) throw AppError.internal();

      const session = await issueSession(created.id);
      return reply.status(201).send({
        userId: created.id,
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  );

  /**
   * Public KDF parameters for one vault. A returning user needs the salt to
   * re-derive their key before they can prove anything, so this is necessarily
   * unauthenticated. The salt is not a secret — it is useless without the
   * passphrase, and the iteration count is deliberately high enough that
   * holding it does not make guessing practical (§12.3).
   */
  app.get(
    '/v1/identity/params/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: {
          200: z.object({
            keyMaterial: z.object({ kdf: KdfParams, keyVersion: z.number().int() }),
          }),
        },
      },
    },
    async (request) => {
      const db = getDatabase();
      const [user] = await db
        .select({
          salt: users.kdfSalt,
          iterations: users.kdfIterations,
          alg: users.kdfAlgorithm,
          keyVersion: users.keyVersion,
        })
        .from(users)
        .where(eq(users.id, request.params.id))
        .limit(1);
      if (!user) throw AppError.notFound();

      return {
        keyMaterial: {
          kdf: {
            v: 1 as const,
            alg: 'PBKDF2-SHA256' as const,
            salt: user.salt,
            iterations: user.iterations,
          },
          keyVersion: user.keyVersion,
        },
      };
    },
  );

  app.post(
    '/v1/identity/login',
    { schema: { body: LoginRequest, response: { 200: LoginResponse } } },
    async (request) => {
      const db = getDatabase();
      const { userId, verifier } = request.body;

      const [user] = await db
        .select({ id: users.id, verifier: users.verifier })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      // The verifier proves the client derived the same KEK. The server checks
      // equality only; it cannot derive the key itself.
      if (!user || user.verifier !== verifier) throw AppError.authRequired();

      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
      const session = await issueSession(user.id);
      return { userId: user.id, token: session.token, expiresAt: session.expiresAt.toISOString() };
    },
  );

  app.get(
    '/v1/identity/session',
    { preHandler: requireAuth, schema: { response: { 200: SessionResponse } } },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw AppError.authRequired();

      const [stats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          lastAt: sql<Date | null>`max(${thoughts.createdAt})`,
        })
        .from(thoughts)
        .where(sql`${thoughts.userId} = ${userId} and ${thoughts.status} = 'active'`);

      return {
        userId: user.id,
        keyMaterial: {
          kdf: {
            v: 1 as const,
            alg: 'PBKDF2-SHA256' as const,
            salt: user.kdfSalt,
            iterations: user.kdfIterations,
          },
          keyVersion: user.keyVersion,
        },
        thoughtCount: stats?.count ?? 0,
        lastCaptureAt: stats?.lastAt ? new Date(stats.lastAt).toISOString() : null,
      };
    },
  );
};
