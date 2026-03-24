// ============================================================================
// Open Posting — Request ID Middleware
// ============================================================================

import { createMiddleware } from 'hono/factory';
import { ulid } from 'ulid';

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? `req_${ulid()}`;
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});
