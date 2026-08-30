import { describe, expect, it } from 'vitest';
import { sanitiseEvent, type ErrorEvent } from './observability.js';

/**
 * An error tracker is the most likely place for private content to escape a
 * system that is otherwise careful. These tests assert on exactly what would
 * go over the wire.
 */

const CANARY = 'SENTRY_CANARY_4b7f I never told anyone about this';

const base: ErrorEvent = { name: 'Error', message: 'something failed' };

describe('sanitiseEvent', () => {
  it('drops free-text extras rather than trying to clean them', () => {
    const sent = sanitiseEvent({
      ...base,
      extra: { content: CANARY, note: CANARY, anythingAtAll: CANARY },
    });
    expect(JSON.stringify(sent)).not.toContain('SENTRY_CANARY_4b7f');
  });

  it('keeps numbers and booleans, which is what actually helps debugging', () => {
    const sent = sanitiseEvent({
      ...base,
      extra: { byteSize: 4096, retried: true, missing: null },
    });
    expect(sent.extra).toMatchObject({ byteSize: 4096, retried: true, missing: null });
  });

  it('strips query strings from URLs in messages', () => {
    const sent = sanitiseEvent({
      ...base,
      message:
        'PUT https://storage.example.com/private/objects/abc/payload.bin?X-Amz-Signature=deadbeef&X-Amz-Credential=key failed',
    });
    expect(sent.message).not.toContain('deadbeef');
    expect(sent.message).not.toContain('X-Amz-Credential=key');
    // The useful part survives.
    expect(sent.message).toContain('storage.example.com');
  });

  it('redacts signed-URL credentials wherever they appear in a stack', () => {
    const sent = sanitiseEvent({
      ...base,
      stack: 'at upload (?X-Amz-Signature=abcdef123456&other=1)\n at handler',
    });
    expect(sent.stack).not.toContain('abcdef123456');
    expect(sent.stack).toContain('at handler');
  });

  it('redacts bearer tokens and JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9aaaaaaaa.eyJzdWIiOiIxMjM0NTY3ODkwIn0bbbbbbbb.SflKxwRJSMeKKF2QT4fwpMcccccc';
    const sent = sanitiseEvent({ ...base, message: `auth failed for ${jwt}` });
    expect(sent.message).not.toContain(jwt);
  });

  it('reduces a route to its path', () => {
    const sent = sanitiseEvent({ ...base, route: '/v1/thoughts/abc?cursor=secret' });
    expect(sent.route).toBe('/v1/thoughts/abc');
  });

  it('keeps the opaque user id, which reveals nothing on its own', () => {
    const sent = sanitiseEvent({ ...base, userId: '11111111-2222-3333-4444-555555555555' });
    // We hold no name or email to join this against — it is what makes an
    // error actionable without identifying anyone.
    expect(sent.userId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('never forwards a field it was not told about', () => {
    const sent = sanitiseEvent({
      ...base,
      // A future caller adding an unexpected property must not widen the event.
      ...({ requestBody: CANARY, headers: { authorization: 'Bearer x' } } as object),
    });
    expect(JSON.stringify(sent)).not.toContain('SENTRY_CANARY_4b7f');
    expect(JSON.stringify(sent)).not.toContain('authorization');
  });

  it('produces an event with a closed, known shape', () => {
    const sent = sanitiseEvent({
      ...base,
      stack: 'at x',
      requestId: 'r-1',
      route: '/v1/thoughts',
      userId: 'u-1',
      extra: { n: 1 },
    });
    expect(Object.keys(sent).sort()).toEqual(
      ['extra', 'message', 'name', 'requestId', 'route', 'stack', 'userId'].sort(),
    );
  });
});
