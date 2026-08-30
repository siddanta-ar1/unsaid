import { z } from 'zod';

/** Opaque public identifier. Never a sequential key — see blueprint §17.1. */
export const OpaqueId = z.uuid();
export type OpaqueId = z.infer<typeof OpaqueId>;

/** Base64url with no padding: how all binary crosses the API boundary. */
export const B64Url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'must be unpadded base64url')
  .max(16384);
export type B64Url = z.infer<typeof B64Url>;

export const Iso8601 = z.iso.datetime({ offset: true });

/**
 * Coarse buckets. Analytics and metadata record buckets, never exact values,
 * so that neither can be used to fingerprint an individual thought (§25.3).
 */
export const SizeBucket = z.enum(['xs', 's', 'm', 'l', 'xl']);
export type SizeBucket = z.infer<typeof SizeBucket>;

export const DurationBucket = z.enum(['0-15s', '15-60s', '1-5m', '5-15m', '15m+']);
export type DurationBucket = z.infer<typeof DurationBucket>;

export function toSizeBucket(bytes: number): SizeBucket {
  if (bytes < 4 * 1024) return 'xs';
  if (bytes < 64 * 1024) return 's';
  if (bytes < 1024 * 1024) return 'm';
  if (bytes < 8 * 1024 * 1024) return 'l';
  return 'xl';
}

export function toDurationBucket(ms: number): DurationBucket {
  const s = ms / 1000;
  if (s < 15) return '0-15s';
  if (s < 60) return '15-60s';
  if (s < 300) return '1-5m';
  if (s < 900) return '5-15m';
  return '15m+';
}
