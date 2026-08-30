import type { FastifyBaseLogger } from 'fastify';

/**
 * Logging policy. Blueprint P0: "never store plaintext emotional content in
 * normal backend logs" (§7).
 *
 * Rather than trusting every call site to remember, the serializers below strip
 * request and response bodies wholesale. A route that needs to log something
 * about a payload must log a derived, non-reversible fact (a size bucket, a
 * status) — never the payload.
 */

/** Keys that must never appear in a log line, whatever their nesting depth. */
const FORBIDDEN_KEYS = new Set([
  'content',
  'body',
  'text',
  'transcript',
  'plaintext',
  'passphrase',
  'password',
  'verifier',
  'wrappedKey',
  'wrapped_key',
  'wrapped',
  'authorization',
  'cookie',
  'token',
  'apiKey',
  'api_key',
  'secret',
  'prompt',
  'reflection',
]);

const REDACTED = '[redacted]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = FORBIDDEN_KEYS.has(key) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

export const loggerOptions = {
  serializers: {
    req(request: { method: string; url: string; id: string }) {
      // Deliberately omits body, query and headers.
      return { method: request.method, url: stripQuery(request.url), id: request.id };
    },
    res(reply: { statusCode: number }) {
      return { statusCode: reply.statusCode };
    },
    err(error: Error) {
      return { type: error.name, message: error.message, stack: error.stack ?? '' };
    },
  },
  // Belt and braces: pino redacts these paths even if a serializer is bypassed.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body',
      'res.body',
      '*.content',
      '*.passphrase',
      '*.wrappedKey',
    ],
    censor: REDACTED,
  },
};

/** Query strings can carry cursors and ids; keep only the path. */
function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

export type Logger = FastifyBaseLogger;
