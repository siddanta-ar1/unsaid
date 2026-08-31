import { SignJWT, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDatabase } from '../db/client.js';
import { users } from '../db/schema.js';
import { loadConfig } from './config.js';
import { AppError } from './errors.js';

/**
 * Sessions carry a user id and nothing else. There is no email, no display
 * name, and no key material in the token — the vault key never reaches the
 * server in any form (§12.3).
 */

const ISSUER = 'unsaid';
const AUDIENCE = 'unsaid-api';

let secretKey: Uint8Array | undefined;

function getSecret(): Uint8Array {
  secretKey ??= new TextEncoder().encode(loadConfig().SESSION_SECRET);
  return secretKey;
}

export async function issueSession(
  userId: string,
  epoch: number,
): Promise<{ token: string; expiresAt: Date }> {
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);
  const token = await new SignJWT({ epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());
  return { token, expiresAt };
}

/**
 * Verifies a token's signature and that it was issued under the vault's
 * current epoch.
 *
 * The epoch check costs one indexed lookup per authenticated request, and buys
 * revocation without a server-side session store: changing a passphrase, or
 * reissuing a kit, stops every token minted before it. Without this, a
 * thirty-day token issued to someone who has since been locked out keeps full
 * access — including deleting and forgetting memories — for a month, which is
 * precisely the situation a passphrase change exists to end.
 */
export async function verifySession(token: string): Promise<string> {
  let userId: string;
  let epoch: number;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub) throw new Error('missing subject');
    userId = payload.sub;
    epoch = typeof payload.epoch === 'number' ? payload.epoch : 0;
  } catch {
    throw AppError.authRequired();
  }

  const [user] = await getDatabase()
    .select({ epoch: users.sessionEpoch })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // A deleted vault also lands here, so its tokens stop working immediately
  // rather than lingering until they expire.
  if (!user || user.epoch !== epoch) throw AppError.authRequired();

  return userId;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * Authorization happens here, server-side, on every request — never by hiding a
 * button in the UI (§20.2).
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AppError.authRequired();
  request.userId = await verifySession(header.slice('Bearer '.length));
}

export function currentUserId(request: FastifyRequest): string {
  if (!request.userId) throw AppError.authRequired();
  return request.userId;
}
