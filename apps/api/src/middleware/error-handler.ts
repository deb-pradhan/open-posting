// ============================================================================
// Open Posting — Global Error Handler
// ============================================================================

import type { ErrorHandler } from 'hono';
import { AppError } from '@open-posting/shared';
import { ulid } from 'ulid';
import { createLogger } from '@open-posting/core';
import type { LogLevel } from '@open-posting/shared';

const logger = createLogger((process.env['LOG_LEVEL'] as LogLevel) ?? 'info', 'api:error-handler');

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') ?? `req_${ulid()}`;

  if (err instanceof AppError) {
    logger.warn({
      requestId,
      code: err.code,
      status: err.status,
      message: err.message,
      retryable: err.retryable,
      path: c.req.path,
      method: c.req.method,
    }, `Request failed: ${err.code}`);

    return c.json({
      ok: false,
      error: err.toJSON(),
      meta: { requestId },
    }, err.status as 400);
  }

  // Unknown errors
  logger.error({
    requestId,
    err,
    path: c.req.path,
    method: c.req.method,
  }, 'Unhandled error');

  return c.json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      retryable: true,
    },
    meta: { requestId },
  }, 500);
};
