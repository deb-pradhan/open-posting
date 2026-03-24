// ============================================================================
// Open Posting — Error Code Registry
// ============================================================================

export interface ErrorDef {
  status: number;
  code: string;
  retryable: boolean;
}

export const ERROR_CODES = {
  // Auth errors
  AUTH_MISSING_KEY:            { status: 401, code: 'AUTH_MISSING_KEY', retryable: false },
  AUTH_INVALID_KEY:            { status: 401, code: 'AUTH_INVALID_KEY', retryable: false },
  AUTH_ACCOUNT_EXPIRED:        { status: 401, code: 'AUTH_ACCOUNT_EXPIRED', retryable: false },

  // Validation errors
  VALIDATION_FAILED:           { status: 400, code: 'VALIDATION_FAILED', retryable: false },
  CONTENT_TOO_LONG:            { status: 400, code: 'CONTENT_TOO_LONG', retryable: false },
  MEDIA_TYPE_UNSUPPORTED:      { status: 400, code: 'MEDIA_TYPE_UNSUPPORTED', retryable: false },
  MEDIA_TOO_LARGE:             { status: 400, code: 'MEDIA_TOO_LARGE', retryable: false },
  INVALID_THREAD_STRUCTURE:    { status: 400, code: 'INVALID_THREAD_STRUCTURE', retryable: false },

  // Platform errors
  PLATFORM_RATE_LIMITED:       { status: 429, code: 'PLATFORM_RATE_LIMITED', retryable: true },
  PLATFORM_AUTH_FAILED:        { status: 502, code: 'PLATFORM_AUTH_FAILED', retryable: false },
  PLATFORM_UNAVAILABLE:        { status: 502, code: 'PLATFORM_UNAVAILABLE', retryable: true },
  PLATFORM_REJECTED:           { status: 422, code: 'PLATFORM_REJECTED', retryable: false },
  PLATFORM_MEDIA_UPLOAD_FAILED: { status: 502, code: 'PLATFORM_MEDIA_UPLOAD_FAILED', retryable: true },

  // Internal errors
  INTERNAL_ERROR:              { status: 500, code: 'INTERNAL_ERROR', retryable: true },
  SCHEDULER_FAILED:            { status: 500, code: 'SCHEDULER_FAILED', retryable: true },
  PROVIDER_FALLBACK_EXHAUSTED: { status: 502, code: 'PROVIDER_FALLBACK_EXHAUSTED', retryable: true },

  // Resource errors
  NOT_FOUND:                   { status: 404, code: 'NOT_FOUND', retryable: false },
  DUPLICATE_POST:              { status: 409, code: 'DUPLICATE_POST', retryable: false },
  ACCOUNT_NOT_CONNECTED:       { status: 422, code: 'ACCOUNT_NOT_CONNECTED', retryable: false },

  // Emergency stop
  EMERGENCY_STOP_ACTIVE:       { status: 503, code: 'EMERGENCY_STOP_ACTIVE', retryable: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly retryAfterMs?: number;

  constructor(
    errorCode: ErrorCode,
    message?: string,
    options?: {
      details?: Record<string, unknown>;
      retryAfterMs?: number;
      cause?: Error;
    }
  ) {
    const def = ERROR_CODES[errorCode];
    super(message ?? def.code, { cause: options?.cause });
    this.name = 'AppError';
    this.status = def.status;
    this.code = def.code;
    this.retryable = def.retryable;
    this.details = options?.details;
    this.retryAfterMs = options?.retryAfterMs;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
    };
  }
}
