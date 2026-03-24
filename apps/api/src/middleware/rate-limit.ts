// ============================================================================
// Open Posting — Rate Limiting Middleware (Redis sliding window)
// ============================================================================

import { createMiddleware } from 'hono/factory';
import type { Redis } from 'ioredis';
import { AppError, RATE_LIMITS, type LogLevel } from '@open-posting/shared';
import { createLogger } from '@open-posting/core';

const logger = createLogger((process.env['LOG_LEVEL'] as LogLevel) ?? 'info', 'api:rate-limit');

export function rateLimitMiddleware(redis: Redis) {
  return createMiddleware(async (c, next) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const key = workspaceId
      ? `ratelimit:key:${workspaceId}`
      : `ratelimit:ip:${c.req.header('x-forwarded-for') ?? 'unknown'}`;

    const limit = workspaceId ? RATE_LIMITS.api.perKey : RATE_LIMITS.api.perIp;
    const windowMs = RATE_LIMITS.api.windowMs;

    const now = Date.now();
    const windowStart = now - windowMs;

    // Sliding window using Redis sorted set
    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zadd(key, now, `${now}:${Math.random()}`);
    multi.zcard(key);
    multi.expire(key, Math.ceil(windowMs / 1000));

    const results = await multi.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;

    const remaining = Math.max(0, limit - count);
    const resetAt = new Date(now + windowMs).toISOString();

    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetAt);

    if (count > limit) {
      logger.warn({
        key,
        workspaceId,
        count,
        limit,
        path: c.req.path,
        method: c.req.method,
      }, 'Rate limit exceeded');
      throw new AppError('PLATFORM_RATE_LIMITED', 'API rate limit exceeded', {
        retryAfterMs: windowMs,
        details: { limit, remaining: 0, resetAt },
      });
    }

    await next();
  });
}
