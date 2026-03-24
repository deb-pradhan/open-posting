// ============================================================================
// Open Posting — API Server Entry Point
// ============================================================================

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import IoRedis from 'ioredis';

import { createDatabase } from '@open-posting/db';
import {
  loadConfig,
  createLogger,
  WorkspaceService,
  AccountService,
  PostService,
  MediaService,
  EngagementService,
  AnalyticsService,
  XOfficialProvider,
  XGetXApiProvider,
  XRouterProvider,
  LinkedInProvider,
  createQueues,
  createWorkers,
  PostPublisher,
  type PlatformProvider,
} from '@open-posting/core';
import type { Platform } from '@open-posting/shared';

import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';

import { healthRoutes } from './routes/health.js';
import { workspaceRoutes, emergencyRoutes } from './routes/workspace.js';
import { accountRoutes, oauthCallbackRoutes } from './routes/accounts.js';
import { postRoutes } from './routes/posts.js';
import { mediaRoutes } from './routes/media.js';
import { engageRoutes } from './routes/engage.js';
import { analyticsRoutes } from './routes/analytics.js';

// ── Bootstrap ─────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, 'api');

  logger.info({ port: config.port }, 'Starting Open Posting API');

  // ── Infrastructure ──────────────────────────────────────────────

  const db = createDatabase(config.databaseUrl);
  const redis = new IoRedis.default(config.redisUrl, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  });

  redis.on('error', (err: Error) => logger.error({ err }, 'Redis connection error'));
  redis.on('connect', () => logger.info('Redis connected'));

  // ── Providers ───────────────────────────────────────────────────

  const xOfficial = new XOfficialProvider(logger, {
    clientId: config.x.clientId,
    clientSecret: config.x.clientSecret,
    bearerToken: config.x.bearerToken,
  });

  const xGetXApi = config.x.getxapiKey
    ? new XGetXApiProvider(logger, { apiKey: config.x.getxapiKey })
    : undefined;

  if (xGetXApi) {
    logger.info('GetXAPI fallback provider enabled');
  }

  const xRouter = new XRouterProvider(logger, xOfficial, xGetXApi);

  const linkedIn = new LinkedInProvider(logger, {
    clientId: config.linkedin.clientId,
    clientSecret: config.linkedin.clientSecret,
  });

  const providers = new Map<Platform, PlatformProvider>([
    ['x', xRouter],
    ['linkedin', linkedIn],
  ]);

  // ── Services ────────────────────────────────────────────────────

  const workspaceService = new WorkspaceService(db, logger);
  const accountService = new AccountService(db, config.encryptionKey, logger);

  const baseUrl = config.mediaServeBaseUrl || config.publicUrl;
  const mediaService = new MediaService(db, config.mediaStoragePath, baseUrl, logger);

  const postService = new PostService(db, accountService, logger);
  const engagementService = new EngagementService(db, accountService, providers, logger);
  const analyticsService = new AnalyticsService(db, accountService, providers, logger);

  // ── Scheduler ───────────────────────────────────────────────────

  const queues = createQueues(redis as any);
  const publisher = new PostPublisher(db, queues, logger);

  const workers = createWorkers({
    connection: redis as any,
    postService,
    accountService,
    analyticsService,
    workspaceService,
    mediaService,
    providers,
    logger,
  });

  // ── Hono App ────────────────────────────────────────────────────

  const app = new Hono();

  // Global middleware
  app.use('*', cors());
  app.use('*', requestIdMiddleware);
  app.onError(errorHandler);

  // Public routes (no auth)
  app.route('/', healthRoutes({ db, redis, mediaService, providers }));
  app.route('/api/v1', workspaceRoutes({ workspaceService }));

  // OAuth callbacks (no auth — browser redirects from X/LinkedIn, secured by Redis state)
  app.route('/api/v1/accounts', oauthCallbackRoutes({ accountService, providers, publicUrl: config.publicUrl, redis: redis as any }));

  // Media file serving (no auth — uses ULID as capability URL)
  app.get('/api/v1/media/:id/file', async (c) => {
    const mediaId = c.req.param('id');
    try {
      // Serve without workspace scoping for simplicity
      // The media ID (ULID) serves as a capability token
      const { buffer, mimeType } = await mediaService.getFileBuffer(mediaId, '');
      c.header('Content-Type', mimeType);
      c.header('Cache-Control', 'public, max-age=86400');
      c.header('ETag', `"${mediaId}"`);
      return c.body(new Uint8Array(buffer));
    } catch {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404);
    }
  });

  // Authenticated routes
  const authed = new Hono();
  authed.use('*', authMiddleware(workspaceService));
  authed.use('*', rateLimitMiddleware(redis));

  authed.route('/accounts', accountRoutes({ accountService, providers, publicUrl: config.publicUrl, redis, xGetXApi: xGetXApi }));
  authed.route('/posts', postRoutes({ postService, publisher, workspaceService }));
  authed.route('/media', mediaRoutes({ mediaService }));
  authed.route('/engage', engageRoutes({ engagementService }));
  authed.route('/analytics', analyticsRoutes({ analyticsService }));
  authed.route('/', emergencyRoutes({ workspaceService }));

  app.route('/api/v1', authed);

  // ── Start Server ────────────────────────────────────────────────

  serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    logger.info({
      port: info.port,
      url: `http://localhost:${info.port}`,
    }, 'Open Posting API server started');
  });

  // ── Graceful Shutdown ───────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully...');

    await workers.publishWorker.close();
    await workers.tokenRefreshWorker.close();
    await workers.analyticsWorker.close();
    await queues.publishQueue.close();
    await queues.tokenRefreshQueue.close();
    await queues.analyticsQueue.close();
    await redis.quit();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
