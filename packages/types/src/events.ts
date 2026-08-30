import { z } from 'zod';
import { DurationBucket, SizeBucket } from './primitives.js';

/**
 * Blueprint §31.1. Every analytics event is declared here with an exact,
 * closed property shape. `.strict()` means an accidental `{ text: ... }` is a
 * type error and a runtime rejection, not a silent privacy leak.
 */
export const AnalyticsEvent = z.discriminatedUnion('name', [
  z.object({
    name: z.literal('capture_started'),
    platform: z.enum(['web', 'ios', 'android']),
    captureType: z.enum(['text', 'audio']),
  }).strict(),
  z.object({
    name: z.literal('capture_completed'),
    captureType: z.enum(['text', 'audio']),
    durationBucket: DurationBucket,
  }).strict(),
  z.object({
    name: z.literal('private_save_completed'),
    storageMode: z.enum(['cloud', 'local_only']),
    encryptedSizeBucket: SizeBucket,
  }).strict(),
  z.object({
    name: z.literal('reflection_requested'),
    modelVersion: z.string(),
    durationBucket: DurationBucket,
  }).strict(),
  z.object({
    name: z.literal('reflection_completed'),
    latencyBucket: z.enum(['fast', 'normal', 'slow']),
    status: z.enum(['ok', 'error', 'safety']),
  }).strict(),
  z.object({
    name: z.literal('anchor_completed'),
    network: z.enum(['devnet', 'mainnet-beta']),
    status: z.enum(['confirmed', 'failed']),
  }).strict(),
  z.object({
    name: z.literal('thought_deleted'),
    deletionMode: z.enum(['local_discard', 'cloud_delete', 'forget']),
  }).strict(),
  z.object({ name: z.literal('user_returned'), cohortDay: z.number().int() }).strict(),
]);
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>;
