import { z } from 'zod';

/** Blueprint §31.2. Codes are stable; messages are not. */
export const ApiErrorCode = z.enum([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONSENT_REQUIRED',
  'UPLOAD_EXPIRED',
  'CRYPTO_VERSION_UNSUPPORTED',
  'SOLANA_TX_FAILED',
  'RATE_LIMITED',
  'SAFETY_REVIEW',
  'VALIDATION_FAILED',
  'CONFLICT',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/**
 * The only error shape the API emits. `message` is a fixed human string —
 * it never echoes request payloads, which would risk reflecting plaintext.
 */
export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const HTTP_STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONSENT_REQUIRED: 428,
  UPLOAD_EXPIRED: 410,
  CRYPTO_VERSION_UNSUPPORTED: 409,
  SOLANA_TX_FAILED: 502,
  RATE_LIMITED: 429,
  SAFETY_REVIEW: 451,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  INTERNAL: 500,
};
