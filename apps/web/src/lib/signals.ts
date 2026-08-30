import type { AnalyticsEvent } from '@unsaid/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3011';

/**
 * Product signals.
 *
 * The blueprint's rule is that measuring must not become surveillance (§25.3),
 * so this file is built around one constraint: we count behaviour without ever
 * being able to reconstruct a person.
 *
 * The cohort key is random per browser and rotates weekly. That is enough to
 * answer "did this browser come back within seven days" — the only retention
 * question that matters at pilot scale — and not enough to build a record of
 * when someone felt bad enough to write, week after week.
 *
 * Nothing here ever receives a memory. `AnalyticsEvent` is a strict union, so
 * an event carrying an undeclared field fails to typecheck and is rejected
 * again server-side.
 */

const COHORT_KEY = 'unsaid.cohort';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredCohort {
  key: string;
  issuedAt: number;
  /** The first week we saw this browser, so returns can be counted. */
  firstSeenWeek: number;
}

function weekNumber(at = Date.now()): number {
  return Math.floor(at / WEEK_MS);
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns the current cohort key, rotating it once a week.
 *
 * Rotation is the privacy control: after seven days the new key cannot be
 * linked to the old one, so no long-term behavioural profile accumulates even
 * in our own database.
 */
function cohort(): StoredCohort | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COHORT_KEY);
    const stored = raw ? (JSON.parse(raw) as StoredCohort) : null;

    if (stored && weekNumber(stored.issuedAt) === weekNumber()) return stored;

    const next: StoredCohort = {
      key: randomKey(),
      issuedAt: Date.now(),
      firstSeenWeek: stored?.firstSeenWeek ?? weekNumber(),
    };
    window.localStorage.setItem(COHORT_KEY, JSON.stringify(next));
    return next;
  } catch {
    // Private browsing, or storage disabled. We simply do not measure.
    return null;
  }
}

/**
 * Records one event. Deliberately fire-and-forget: analytics must never delay
 * or break the thing a person actually came here to do.
 */
export function track(event: AnalyticsEvent): void {
  const current = cohort();
  if (!current) return;

  void fetch(`${BASE_URL}/v1/signals/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: current.key, event }),
    keepalive: true,
  }).catch(() => {
    // Swallowed on purpose. A failed measurement is not the user's problem.
  });
}

/**
 * Records a return visit once per week, which is what D7 retention is actually
 * asking. Called from the shell on mount.
 */
export function trackReturn(): void {
  const current = cohort();
  if (!current) return;
  const week = weekNumber();
  if (week === current.firstSeenWeek) return; // First week; not a return.
  track({ name: 'user_returned', cohortDay: (week - current.firstSeenWeek) * 7 });
}

export type FeedbackScreen =
  | 'home'
  | 'capture'
  | 'vault'
  | 'memory'
  | 'settings'
  | 'privacy'
  | 'unlock';

export async function sendFeedback(input: {
  screen: FeedbackScreen;
  sentiment: 'confused' | 'broken' | 'idea' | 'other';
  message?: string;
  token?: string | null;
}): Promise<void> {
  const response = await fetch(`${BASE_URL}/v1/signals/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    body: JSON.stringify({
      screen: input.screen,
      sentiment: input.sentiment,
      ...(input.message ? { message: input.message } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Feedback failed with status ${response.status}`);
}
