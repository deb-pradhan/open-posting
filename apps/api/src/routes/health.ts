// ============================================================================
// Open Posting — Health Routes
// ============================================================================

import { Hono } from 'hono';
import type { DbClient } from '@open-posting/db';
import { sql } from '@open-posting/db';
import type { Redis } from 'ioredis';
import type { MediaService, PlatformProvider } from '@open-posting/core';
import type { Platform, HealthResponse } from '@open-posting/shared';

const VERSION = '1.0.0';
const startTime = Date.now();

interface HealthDeps {
  db: DbClient;
  redis: Redis;
  mediaService: MediaService;
  providers: Map<Platform, PlatformProvider>;
}

export function healthRoutes(deps: HealthDeps) {
  const app = new Hono();

  // Basic health
  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: VERSION, uptime: Date.now() - startTime });
  });

  // Readiness — checks all dependencies
  app.get('/health/ready', async (c) => {
    const checks: HealthResponse['checks'] = {
      database: { status: 'down', latencyMs: 0 },
      redis: { status: 'down', latencyMs: 0 },
      storage: { status: 'down', latencyMs: 0 },
      providers: {},
    };

    // Database check
    const dbStart = Date.now();
    try {
      // Simple query to test DB connection
      await deps.db.execute(sql`SELECT 1`);
      checks.database = { status: 'up', latencyMs: Date.now() - dbStart };
    } catch {
      checks.database = { status: 'down', latencyMs: Date.now() - dbStart };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      await deps.redis.ping();
      checks.redis = { status: 'up', latencyMs: Date.now() - redisStart };
    } catch {
      checks.redis = { status: 'down', latencyMs: Date.now() - redisStart };
    }

    // Storage check
    checks.storage = await deps.mediaService.healthCheck();

    const allUp = checks.database.status === 'up' &&
                  checks.redis.status === 'up' &&
                  checks.storage.status === 'up';

    const status: HealthResponse['status'] = allUp ? 'healthy' : 'degraded';

    return c.json({
      status,
      uptime: Date.now() - startTime,
      version: VERSION,
      checks,
    } satisfies HealthResponse, allUp ? 200 : 503);
  });

  // Provider status
  app.get('/health/providers', async (c) => {
    const providerStatus: Record<string, unknown> = {};
    for (const [name, provider] of deps.providers) {
      providerStatus[name] = await provider.healthCheck();
    }
    return c.json({ ok: true, data: providerStatus });
  });

  return app;
}
