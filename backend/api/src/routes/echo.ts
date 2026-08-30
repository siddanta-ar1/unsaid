import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ReflectRequest, ReflectResponse, toDurationBucket } from '@unsaid/types';
import { getDatabase } from '../db/client.js';
import { consents, reflections, thoughts } from '../db/schema.js';
import { currentUserId, requireAuth } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { getReflectionProvider } from '../lib/ai/index.js';
import { crisisResourcesFor } from '../lib/ai/crisis.js';
import { track } from '../lib/analytics.js';
import { REFLECT_LIMIT } from '../lib/rate-limits.js';

const IdParam = z.object({ id: z.uuid() });

/** The consent version currently presented in the UI's disclosure sheet. */
export const CURRENT_AI_CONSENT_VERSION = 1;

/**
 * Echo. This is the only endpoint in the system that accepts plaintext, and it
 * does so under three conditions (§18.2):
 *
 *   1. The user owns the thought.
 *   2. They have accepted the current version of the AI disclosure — an older
 *      accepted version does not carry forward, because the disclosure text is
 *      what they actually consented to.
 *   3. The content is passed for this one operation and never persisted here in
 *      plaintext; the reply is returned for the client to encrypt and store.
 */
export const echoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post(
    '/v1/thoughts/:id/reflect',
    {
      config: { rateLimit: REFLECT_LIMIT },
      schema: { params: IdParam, body: ReflectRequest, response: { 200: ReflectResponse } },
    },
    async (request) => {
      const db = getDatabase();
      const userId = currentUserId(request);
      const { consentVersion, content } = request.body;

      if (consentVersion !== CURRENT_AI_CONSENT_VERSION) {
        throw AppError.consentRequired('AI reflection under the current disclosure');
      }

      const [thought] = await db
        .select({ id: thoughts.id, status: thoughts.status })
        .from(thoughts)
        .where(and(eq(thoughts.id, request.params.id), eq(thoughts.userId, userId)))
        .limit(1);
      if (!thought || thought.status !== 'active') throw AppError.notFound();

      const [consent] = await db
        .select()
        .from(consents)
        .where(and(eq(consents.userId, userId), eq(consents.scope, 'ai_reflection_once')))
        .limit(1);

      if (!consent?.acceptedAt || consent.revokedAt || consent.version < CURRENT_AI_CONSENT_VERSION) {
        throw AppError.consentRequired('AI reflection');
      }

      const provider = getReflectionProvider();
      const startedAt = Date.now();

      track(request.log, {
        name: 'reflection_requested',
        modelVersion: provider.name,
        durationBucket: toDurationBucket(0),
      });

      let result;
      try {
        result = await provider.reflect({ content });
      } catch (error) {
        // The error is logged without the content that caused it.
        request.log.error({ err: error, provider: provider.name }, 'reflection failed');
        track(request.log, { name: 'reflection_completed', latencyBucket: 'slow', status: 'error' });
        throw new AppError('INTERNAL', 'Echo could not respond right now. Your thought is safe.');
      }

      const latency = Date.now() - startedAt;

      // Provider and model only. There is deliberately no column here for the
      // prompt or the response text (§18.4).
      const [record] = await db
        .insert(reflections)
        .values({
          thoughtId: thought.id,
          providerRef: provider.name,
          modelVersion: result.modelVersion,
          safetyNotice: result.safetyNotice,
        })
        .returning({ id: reflections.id });
      if (!record) throw AppError.internal();

      track(request.log, {
        name: 'reflection_completed',
        latencyBucket: latency < 2000 ? 'fast' : latency < 8000 ? 'normal' : 'slow',
        status: result.safetyNotice === 'support_resources' ? 'safety' : 'ok',
      });

      // Resources are attached only when the support path fired, and are
      // resolved from a request hint rather than anything we store about the
      // person. Getting the region wrong costs nothing: the fallback is a
      // directory, not a wrong number.
      const support =
        result.safetyNotice === 'support_resources'
          ? (() => {
              const region = crisisResourcesFor(
                (request.headers['x-region'] as string | undefined) ?? null,
              );
              return { label: region.label, resources: region.resources };
            })()
          : null;

      return {
        reflectionId: record.id,
        content: result.content,
        modelVersion: result.modelVersion,
        safetyNotice: result.safetyNotice,
        support,
      };
    },
  );
};
