import { redact } from './logger.js';

/**
 * Error reporting.
 *
 * An error tracker is the most common way private content escapes a system
 * that is otherwise careful: SDKs capture request bodies, breadcrumbs, local
 * variables and query strings by default, and every one of those can carry a
 * thought someone chose not to say out loud.
 *
 * So the scrubber lives here, ahead of any vendor, and is unit-tested against
 * a canary. `sanitiseEvent` is exported so the test can assert on exactly what
 * would go over the wire — a scrubber nobody can inspect is a scrubber nobody
 * should trust.
 *
 * Wiring an SDK in means calling `sanitiseEvent` from its `beforeSend` hook and
 * nothing else; it must never be the SDK's own scrubbing we rely on.
 */

export interface ErrorEvent {
  message: string;
  name: string;
  stack?: string;
  requestId?: string;
  route?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

/** Anything matching these is replaced wholesale rather than trimmed. */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // Bearer tokens and JWTs.
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  // Signed URL credentials — these appear in S3 errors constantly.
  /([?&](X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s]+/gi,
];

const REDACTED = '[redacted]';

/**
 * Query strings carry object ids, cursors and signed-URL credentials. None of
 * it helps debug an exception, and all of it is a liability in a third-party
 * dashboard.
 */
function stripUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?[redacted]');
}

function scrubText(text: string): string {
  let output = stripUrls(text);
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    output = output.replace(pattern, (_match, prefix) => `${prefix ?? ''}${REDACTED}`);
  }
  return output;
}

/**
 * The only thing that may be sent to an external error tracker.
 *
 * Note what survives: a message, a stack, a route, opaque ids. Note what does
 * not: request bodies, query strings, headers, and any `extra` value that is
 * not a number or boolean. Strings in `extra` are dropped rather than scrubbed,
 * because a string is where content hides and there is no reliable way to tell
 * a safe one from a fragment of somebody's journal.
 */
export function sanitiseEvent(event: ErrorEvent): ErrorEvent {
  const safeExtra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event.extra ?? {})) {
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safeExtra[key] = value;
    } else {
      // Includes strings, objects and arrays. `redact` already blanks known
      // sensitive keys, but an unknown key holding free text would sail
      // straight through it.
      safeExtra[key] = REDACTED;
    }
  }

  return {
    name: event.name,
    message: scrubText(event.message),
    ...(event.stack ? { stack: scrubText(event.stack) } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.route ? { route: event.route.split('?')[0] as string } : {}),
    // An opaque user id is what makes an error actionable; it reveals nothing
    // on its own, since we hold no name or email to join it against.
    ...(event.userId ? { userId: event.userId } : {}),
    extra: redact(safeExtra) as Record<string, unknown>,
  };
}

export type ErrorReporter = (event: ErrorEvent) => void;

let reporter: ErrorReporter | null = null;

/**
 * Installs a reporter. Whatever it forwards to, it receives only sanitised
 * events — the scrubbing is not the vendor's responsibility and not optional.
 */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

export function reportError(event: ErrorEvent): void {
  reporter?.(sanitiseEvent(event));
}
