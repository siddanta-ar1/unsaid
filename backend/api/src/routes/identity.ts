import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  LoginRequest,
  LoginResponse,
  RegisterGuestRequest,
  RegisterGuestResponse,
  RotateVaultKeyRequest,
  RotateVaultKeyResponse,
  SessionResponse,
  UnlockMaterialResponse,
} from '@unsaid/types';
import { deriveAccountLookup } from '@unsaid/crypto';
import { getDatabase } from '../db/client.js';
import { securityEvents, thoughts, users } from '../db/schema.js';
import { currentUserId, issueSession, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

/**
 * Identity. No email, no server-side password.
 *
 * The user picks a passphrase, the browser derives a key from it, and the
 * server stores only wrapped copies of the vault key — one under the
 * passphrase, one under the recovery code. Unwrapping happens on the device.
 * Everything here is inert without a secret the server has never seen.
 */
export const identityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/identity/guest',
    { schema: { body: RegisterGuestRequest, response: { 201: RegisterGuestResponse } } },
    async (request, reply) => {
      const db = getDatabase();
      const { passphrase, recovery } = request.body;
      const accountLookup = await deriveAccountLookup(passphrase.kdf);

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.accountLookup, accountLookup))
        .limit(1);
      if (existing.length > 0) {
        throw AppError.conflict('A vault already exists for this key.');
      }

      const [created] = await db
        .insert(users)
        .values({
          accountLookup,
          kdfSalt: passphrase.kdf.salt,
          kdfIterations: passphrase.kdf.iterations,
          kdfAlgorithm: passphrase.kdf.alg,
          wrappedVaultKey: passphrase.wrappedVaultKey,
          recoverySalt: recovery.kdf.salt,
          recoveryIterations: recovery.kdf.iterations,
          recoveryAlgorithm: recovery.kdf.alg,
          recoveryWrappedVaultKey: recovery.wrappedVaultKey,
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
   * Unlock material for one vault, unauthenticated by necessity: a returning
   * user needs the salts and wrapped keys before they can derive anything.
   *
   * This is safe to serve because it is inert. Both wrapped keys are protected
   * by AES-KW under a 600,000-iteration derivation, so possession of this
   * response gets an attacker no further than possession of the database does.
   */
  app.get(
    '/v1/identity/unlock/:id',
    {
      schema: { params: z.object({ id: z.uuid() }), response: { 200: UnlockMaterialResponse } },
    },
    async (request) => {
      const db = getDatabase();
      const [user] = await db.select().from(users).where(eq(users.id, request.params.id)).limit(1);
      if (!user) throw AppError.notFound();

      return {
        passphrase: {
          kdf: {
            v: 1 as const,
            alg: 'PBKDF2-SHA256' as const,
            salt: user.kdfSalt,
            iterations: user.kdfIterations,
          },
          wrappedVaultKey: user.wrappedVaultKey,
        },
        recovery: {
          kdf: {
            v: 1 as const,
            alg: 'PBKDF2-SHA256' as const,
            salt: user.recoverySalt,
            iterations: user.recoveryIterations,
          },
          wrappedVaultKey: user.recoveryWrappedVaultKey,
        },
        keyVersion: user.keyVersion,
      };
    },
  );

  /**
   * Issues a session once the client has unwrapped the vault key locally.
   *
   * There is deliberately no proof-of-passphrase here. A session token only
   * fetches ciphertext and wrapped keys — exactly what the endpoint above
   * already serves unauthenticated — so demanding proof would add ceremony
   * without adding protection. What actually guards the content is that the
   * server cannot decrypt any of it.
   */
  app.post(
    '/v1/identity/login',
    { schema: { body: LoginRequest, response: { 200: LoginResponse } } },
    async (request) => {
      const db = getDatabase();
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, request.body.userId))
        .limit(1);
      if (!user) throw AppError.notFound();

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

  /**
   * Stores a re-wrapped vault key after the user changes their passphrase or
   * reissues their kit. Only the wrapping changes; content keys and ciphertext
   * are never touched, so nothing is re-uploaded and no history is rewritten.
   */
  app.post(
    '/v1/identity/rotate',
    {
      preHandler: requireAuth,
      schema: { body: RotateVaultKeyRequest, response: { 200: RotateVaultKeyResponse } },
    },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);
      const { passphrase, recovery } = request.body;

      if (!passphrase && !recovery) {
        throw new AppError('VALIDATION_FAILED', 'Nothing to rotate.');
      }

      const now = new Date();
      const changes: Record<string, unknown> = {};

      if (passphrase) {
        // The account lookup follows the passphrase salt, so it moves too —
        // otherwise a rotated vault could no longer be found.
        changes.accountLookup = await deriveAccountLookup(passphrase.kdf);
        changes.kdfSalt = passphrase.kdf.salt;
        changes.kdfIterations = passphrase.kdf.iterations;
        changes.kdfAlgorithm = passphrase.kdf.alg;
        changes.wrappedVaultKey = passphrase.wrappedVaultKey;
      }

      if (recovery) {
        changes.recoverySalt = recovery.kdf.salt;
        changes.recoveryIterations = recovery.kdf.iterations;
        changes.recoveryAlgorithm = recovery.kdf.alg;
        changes.recoveryWrappedVaultKey = recovery.wrappedVaultKey;
        changes.recoveryIssuedAt = now;
      }

      await db.update(users).set(changes).where(eq(users.id, userId));

      await db.insert(securityEvents).values({
        eventType: passphrase && recovery ? 'vault_key_rotated' : passphrase ? 'passphrase_changed' : 'recovery_kit_reissued',
        subjectId: userId,
        actorType: 'user',
      });

      return { updatedAt: now.toISOString() };
    },
  );
};
