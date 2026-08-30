import { type ApiErrorCode, HTTP_STATUS_BY_CODE } from '@unsaid/types';

/**
 * The only error type routes should throw. Carries a stable code and a fixed
 * message — never an echo of the request, which could reflect plaintext back
 * into a client log or an error tracker (§17.1).
 */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = HTTP_STATUS_BY_CODE[code];
  }

  static authRequired() {
    return new AppError('AUTH_REQUIRED', 'Sign in to continue.');
  }

  /**
   * Returned for both "does not exist" and "exists but is not yours". Telling
   * the two apart would let an attacker enumerate valid ids (§13.3).
   */
  static notFound() {
    return new AppError('NOT_FOUND', 'Not found.');
  }

  static forbidden() {
    return new AppError('FORBIDDEN', 'You do not have access to this.');
  }

  static consentRequired(what: string) {
    return new AppError('CONSENT_REQUIRED', `Explicit consent is required for ${what}.`);
  }

  static uploadExpired() {
    return new AppError('UPLOAD_EXPIRED', 'This upload window has expired. Please try again.');
  }

  static conflict(message: string) {
    return new AppError('CONFLICT', message);
  }

  static internal(cause?: unknown) {
    return new AppError('INTERNAL', 'Something went wrong on our side.', cause);
  }
}
