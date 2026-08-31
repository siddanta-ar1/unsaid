import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadConfig } from './lib/config.js';
import { loggerOptions } from './lib/logger.js';
import { AppError } from './lib/errors.js';
import { reportError } from './lib/observability.js';
import { DEFAULT_LIMIT, UNLIMITED_ROUTES } from './lib/rate-limits.js';
import { identityRoutes } from './routes/identity.js';
import { thoughtRoutes } from './routes/thoughts.js';
import { echoRoutes } from './routes/echo.js';
import { consentRoutes } from './routes/consents.js';
import { solanaRoutes } from './routes/solana.js';
import { healthRoutes } from './routes/health.js';
import { signalRoutes } from './routes/signals.js';

export async function buildApp() {
  const config = loadConfig();

  const app = Fastify({
    logger: { level: config.LOG_LEVEL, ...loggerOptions },
    // Trust the platform proxy so rate limiting keys on the real client IP.
    trustProxy: config.isProduction,
    bodyLimit: 1024 * 1024, // 1 MB: ciphertext goes to storage, not through here.
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    ...DEFAULT_LIMIT,
    // Keyed by user when authenticated, so one abusive client on a shared NAT
    // cannot lock out everyone behind it. Individual routes tighten this with
    // their own config; see lib/rate-limits.ts for why each budget is what it is.
    keyGenerator: (request) => request.userId ?? request.ip,
    // An uptime monitor polling on a schedule must never be throttled: a
    // rate-limited health check reports an outage that is not happening.
    allowList: (request) => UNLIMITED_ROUTES.includes(request.url.split('?')[0] as string),
    /*
     * Returns an AppError rather than a plain envelope. @fastify/rate-limit
     * throws whatever this returns verbatim, so a bare object reaches the error
     * handler with no status attached and falls through to the 500 catch-all —
     * telling a throttled client the server is broken rather than that they
     * should slow down. An AppError carries its own status and is rendered by
     * the branch that already exists.
     */
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 'Too many requests.'),
  });

  /**
   * A single error handler. Nothing here interpolates the request body into a
   * response or a log line — an error message must never become a channel that
   * reflects plaintext back out (§17.1).
   */
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      request.log.warn({ code: error.code, requestId }, 'handled error');
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message, requestId } });
    }

    if (error instanceof z.ZodError || (error as { validation?: unknown }).validation) {
      // Field paths only. Never the values that failed.
      const fields =
        error instanceof z.ZodError ? error.issues.map((i) => i.path.join('.')) : undefined;
      request.log.warn({ fields, requestId }, 'validation failed');
      return reply.status(400).send({
        error: { code: 'VALIDATION_FAILED', message: 'Request failed validation.', requestId },
      });
    }

    request.log.error({ err: error, requestId }, 'unhandled error');

    // Everything bound for an external tracker goes through the scrubber; the
    // vendor SDK's own filtering is never what we rely on.
    const thrown = error instanceof Error ? error : new Error(String(error));
    reportError({
      name: thrown.name,
      message: thrown.message,
      ...(thrown.stack ? { stack: thrown.stack } : {}),
      requestId,
      route: request.routeOptions?.url ?? request.url,
      ...(request.userId ? { userId: request.userId } : {}),
    });

    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: request.id } }),
  );

  await app.register(healthRoutes);
  await app.register(identityRoutes);
  await app.register(thoughtRoutes);
  await app.register(echoRoutes);
  await app.register(consentRoutes);
  await app.register(solanaRoutes);
  await app.register(signalRoutes);

  return app;
}
