/**
 * Per-route rate limits.
 *
 * A single global limit treats a health check and an AI reflection identically,
 * which gets both wrong: the cheap one is throttled too hard and the expensive
 * one not nearly hard enough. These budgets are set by what each route actually
 * costs us and what abusing it would buy an attacker.
 */

export interface RouteLimit {
  max: number;
  timeWindow: string;
}

/**
 * The default. Generous, because ordinary use of a vault is bursty — opening
 * a timeline fetches metadata and then several objects in quick succession.
 */
export const DEFAULT_LIMIT: RouteLimit = { max: 120, timeWindow: '1 minute' };

/**
 * Reflection is the only route that costs real money per call and the only one
 * that sends content to a third party. A generous limit here is a bill and a
 * privacy surface, not a convenience — and nobody reflects on twenty thoughts
 * in a minute.
 */
export const REFLECT_LIMIT: RouteLimit = { max: 10, timeWindow: '1 hour' };

/**
 * Unlock material is unauthenticated and keyed by vault id. Someone who has
 * guessed a vault id could otherwise pull wrapped keys repeatedly to build a
 * cracking corpus. The keys are PBKDF2-hardened, so this is depth rather than
 * the actual defence, but there is no legitimate reason to fetch it often.
 */
export const UNLOCK_LIMIT: RouteLimit = { max: 20, timeWindow: '15 minutes' };

/** Vault creation. Cheap for us, so the limit exists to stop bulk automation. */
export const REGISTER_LIMIT: RouteLimit = { max: 5, timeWindow: '1 hour' };

/**
 * Upload intents mint signed URLs. Each one is a write capability against our
 * bucket, so minting them in bulk is the cheapest way to run up a storage bill.
 */
export const UPLOAD_INTENT_LIMIT: RouteLimit = { max: 60, timeWindow: '1 hour' };

/** Anchoring builds a transaction and touches the chain record. */
export const ANCHOR_LIMIT: RouteLimit = { max: 20, timeWindow: '1 hour' };

/** Feedback is unauthenticated by design, so it needs its own ceiling. */
export const FEEDBACK_LIMIT: RouteLimit = { max: 10, timeWindow: '1 hour' };

/**
 * Health and readiness are polled by uptime monitors on a fixed schedule and
 * must never be throttled — a rate-limited health check reports an outage that
 * is not happening.
 */
export const UNLIMITED_ROUTES = ['/health', '/ready'];
