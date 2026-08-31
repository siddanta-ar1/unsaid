import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AnalyticsEvent } from '@unsaid/types';
import { getDatabase } from '../db/client.js';
import { analyticsEvents, feedback, waitlist } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { FEEDBACK_LIMIT } from '../lib/rate-limits.js';
import { requireAuth } from '../lib/auth.js';

/**
 * The feedback loop.
 *
 * A pilot that produces warm words and no data is a pilot you have to run
 * again. These two endpoints are what turn thirty invitations into an answer.
 *
 * Both are built so that measuring cannot become surveillance:
 *
 *   - Events are validated against the strict union in `@unsaid/types`, so an
 *     event carrying an undeclared field is rejected rather than stored. A
 *     content leak into analytics is a schema error, not a judgement call.
 *   - Nothing here is joined to a person. Events carry a rotating cohort key,
 *     not a user id, so the funnel can be counted without building a per-user
 *     behavioural record of when someone felt bad enough to write.
 */

/**
 * A day-bucketed pseudonymous key. Enough to count "did this browser come
 * back", not enough to reconstruct a person's history across weeks.
 */
const CohortKey = z.string().min(8).max(64);

const IngestRequest = z.object({ key: CohortKey, event: AnalyticsEvent });

const FeedbackRequest = z.object({
  /** Where they were, so a report is actionable. Never what they wrote. */
  screen: z.enum(['home', 'capture', 'vault', 'memory', 'settings', 'privacy', 'unlock']),
  sentiment: z.enum(['confused', 'broken', 'idea', 'other']),
  /**
   * Their own words about the product. Capped short and explicitly labelled in
   * the UI as visible to us — this is the one field a user may deliberately
   * write into knowing a human reads it.
   */
  message: z.string().max(1000).optional(),
});

export const signalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/signals/events',
    {
      schema: {
        body: IngestRequest,
        response: { 202: z.object({ accepted: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const db = getDatabase();
      const { key, event } = request.body;

      // Belt and braces: the schema already rejects undeclared fields, but a
      // second parse here means a future loosening of the route type cannot
      // quietly widen what reaches storage.
      const parsed = AnalyticsEvent.safeParse(event);
      if (!parsed.success) {
        request.log.warn({ eventName: (event as { name?: string }).name }, 'event rejected');
        throw new AppError('VALIDATION_FAILED', 'Unrecognised event.');
      }

      const { name, ...properties } = parsed.data;

      await db.insert(analyticsEvents).values({
        cohortKey: key,
        name,
        properties: JSON.stringify(properties),
      });

      return reply.status(202).send({ accepted: true });
    },
  );

  app.post(
    '/v1/signals/feedback',
    {
      config: { rateLimit: FEEDBACK_LIMIT },
      schema: { body: FeedbackRequest, response: { 202: z.object({ received: z.boolean() }) } },
    },
    async (request, reply) => {
      const db = getDatabase();
      const { screen, sentiment, message } = request.body;

      await db.insert(feedback).values({
        screen,
        sentiment,
        message: message ?? null,
        // A session token if they happen to be signed in, so we can follow up
        // through the product — never an email, which we do not have.
        userId: request.userId ?? null,
      });

      return reply.status(202).send({ received: true });
    },
  );

  /**
   * Waitlist signup.
   *
   * The only place we accept an email address, and it is never joined to a
   * vault: someone on this list is not discoverable as a user, and a user is
   * not discoverable from their address.
   */
  app.post(
    '/v1/signals/waitlist',
    {
      config: { rateLimit: FEEDBACK_LIMIT },
      schema: {
        body: z.object({
          email: z.email().max(320),
          source: z.string().max(64).optional(),
        }),
        response: { 202: z.object({ joined: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const db = getDatabase();
      const email = request.body.email.trim().toLowerCase();

      // Idempotent: signing up twice is a no-op, and the response is identical
      // either way so the endpoint cannot be used to test whether an address is
      // already on the list.
      await db
        .insert(waitlist)
        .values({ email, source: request.body.source ?? null })
        .onConflictDoNothing({ target: waitlist.email });

      return reply.status(202).send({ joined: true });
    },
  );

  /**
   * The funnel. Blueprint §25: activation and return, not signups.
   *
   * Authenticated because it is an operator view, and deliberately aggregate —
   * it returns counts, never rows, so there is no per-person timeline to read
   * even for us.
   */
  app.get(
    '/v1/signals/funnel',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
        response: {
          200: z.object({
            windowDays: z.number().int(),
            vaultsCreated: z.number().int(),
            firstCaptureCompleted: z.number().int(),
            firstPrivateSave: z.number().int(),
            returnedWithin7Days: z.number().int(),
            weeklyMeaningfulReleases: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      const db = getDatabase();
      const since = new Date(Date.now() - request.query.days * 86_400_000);

      const counts = await db
        .select({
          name: analyticsEvents.name,
          cohorts: sql<number>`count(distinct ${analyticsEvents.cohortKey})::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(analyticsEvents)
        .where(gte(analyticsEvents.createdAt, since))
        .groupBy(analyticsEvents.name);

      const distinct = (name: string) =>
        counts.find((row) => row.name === name)?.cohorts ?? 0;
      const total = (name: string) => counts.find((row) => row.name === name)?.total ?? 0;

      // The number that decides (§25.1): intentional captures that reached an
      // outcome the user chose, per week — not signups, not page views.
      const weekly = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(analyticsEvents)
        .where(
          and(
            gte(analyticsEvents.createdAt, new Date(Date.now() - 7 * 86_400_000)),
            sql`${analyticsEvents.name} in ('private_save_completed', 'reflection_completed', 'thought_deleted')`,
          ),
        );

      return {
        windowDays: request.query.days,
        vaultsCreated: distinct('vault_created'),
        firstCaptureCompleted: distinct('capture_completed'),
        firstPrivateSave: distinct('private_save_completed'),
        returnedWithin7Days: distinct('user_returned'),
        weeklyMeaningfulReleases: weekly[0]?.total ?? total('private_save_completed'),
      };
    },
  );
};
