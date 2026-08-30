import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
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

export async function issueSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());
  return { token, expiresAt };
}

export async function verifySession(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub) throw new Error('missing subject');
    return payload.sub;
  } catch {
    throw AppError.authRequired();
  }
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
