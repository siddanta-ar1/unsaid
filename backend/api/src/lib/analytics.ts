import { AnalyticsEvent } from '@unsaid/types';
import type { Logger } from './logger.js';

/**
 * The only way to emit an analytics event. Because `AnalyticsEvent` is a strict
 * discriminated union, an event carrying an undeclared property — say a stray
 * `text` field — fails to parse and is dropped rather than transmitted (§25.3).
 */
export function track(logger: Logger, event: AnalyticsEvent): void {
  const parsed = AnalyticsEvent.safeParse(event);
  if (!parsed.success) {
    // Log the violation, never the offending payload.
    logger.warn({ eventName: (event as { name?: string }).name }, 'analytics event rejected');
    return;
  }
  logger.info({ analytics: parsed.data }, 'analytics');
}
