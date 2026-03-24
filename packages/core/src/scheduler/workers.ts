// ============================================================================
// Open Posting — BullMQ Workers (Job Processors)
// ============================================================================

import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import type { Platform } from '@open-posting/shared';
import { SCHEDULER } from '@open-posting/shared';
import {
  QUEUE_NAMES,
  type PublishJobData,
  type TokenRefreshJobData,
  type AnalyticsJobData,
} from './queue.js';
import type { PostService } from '../services/post.service.js';
import type { AccountService } from '../services/account.service.js';
import type { AnalyticsService } from '../services/analytics.service.js';
import type { WorkspaceService } from '../services/workspace.service.js';
import type { PlatformProvider, NormalizedContent } from '../providers/base.provider.js';
import type { MediaService } from '../services/media.service.js';
import type { Logger } from '../logger.js';

interface WorkerDeps {
  connection: ConnectionOptions;
  postService: PostService;
  accountService: AccountService;
  analyticsService: AnalyticsService;
  workspaceService: WorkspaceService;
  mediaService: MediaService;
  providers: Map<Platform, PlatformProvider>;
  logger: Logger;
}

export function createWorkers(deps: WorkerDeps) {
  const {
    connection, postService, accountService, analyticsService,
    workspaceService, providers, mediaService, logger,
  } = deps;

  // ── Publish Worker ──────────────────────────────────────────────

  const publishWorker = new Worker<PublishJobData>(
    QUEUE_NAMES.PUBLISH,
    async (job: Job<PublishJobData>) => {
      const { postId, targetId, workspaceId, accountId, platform } = job.data;

      logger.info({ postId, targetId, platform, jobId: job.id }, 'Processing publish job');

      // Emergency stop check
      const stopped = await workspaceService.isEmergencyStopped(workspaceId);
      if (stopped) {
        logger.warn({ workspaceId, postId }, 'Publish blocked by emergency stop');
        throw new Error('EMERGENCY_STOP_ACTIVE');
      }

      // Get provider and account context
      const provider = providers.get(platform as Platform);
      if (!provider) {
        throw new Error(`No provider for platform: ${platform}`);
      }

      const account = await accountService.getAccountContext(accountId, workspaceId);

      // Mark target as publishing
      await postService.updateTargetStatus(targetId, 'publishing');

      // Get post content
      const post = await postService.getById(postId, workspaceId);
      const content = post.content as { text: string; platformOverrides?: Record<string, unknown>; media?: Array<{ id: string; type: string; url: string; altText?: string }> };

      // Resolve platform-specific content
      const platformOverride = content.platformOverrides?.[platform] as { text?: string } | undefined;
      const normalizedContent: NormalizedContent = {
        text: platformOverride?.text ?? content.text,
      };

      // Upload media to platform if needed
      if (content.media && content.media.length > 0) {
        const mediaPayloads = [];
        for (const m of content.media) {
          if (m.id) {
            const { buffer, mimeType } = await mediaService.getFileBuffer(m.id, workspaceId);
            mediaPayloads.push({
              buffer,
              mimeType,
              type: m.type,
              sizeBytes: buffer.length,
              altText: m.altText,
            });
          }
        }
        normalizedContent.media = mediaPayloads;
      }

      // Publish
      const result = await provider.createPost(account, normalizedContent);

      // Update target status
      await postService.updateTargetStatus(targetId, 'published', {
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
      });

      // Update overall post status
      await postService.updatePostStatus(postId);
      await accountService.updateLastUsed(accountId);

      logger.info({
        postId,
        targetId,
        platform,
        platformPostId: result.platformPostId,
      }, 'Post published successfully');
    },
    {
      connection,
      concurrency: SCHEDULER.maxConcurrency,
    },
  );

  publishWorker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({
      jobId: job.id,
      postId: job.data.postId,
      targetId: job.data.targetId,
      error: err.message,
      attemptsMade: job.attemptsMade,
    }, 'Publish job failed');

    // Update target with error
    await postService.updateTargetStatus(job.data.targetId, 'failed', {
      error: {
        code: 'PUBLISH_FAILED',
        message: err.message,
        retryable: job.attemptsMade < SCHEDULER.maxRetries,
      },
    });
    await postService.updatePostStatus(job.data.postId);
  });

  // ── Token Refresh Worker ────────────────────────────────────────

  const tokenRefreshWorker = new Worker<TokenRefreshJobData>(
    QUEUE_NAMES.TOKEN_REFRESH,
    async (job: Job<TokenRefreshJobData>) => {
      const { accountId, workspaceId } = job.data;

      logger.info({ accountId }, 'Refreshing token');

      const account = await accountService.getAccountContext(accountId, workspaceId);
      if (!account.refreshToken) {
        logger.warn({ accountId }, 'No refresh token available');
        return;
      }

      const provider = providers.get(account.platform);
      if (!provider) return;

      const tokens = await provider.refreshToken(account.refreshToken);
      await accountService.updateTokens(accountId, tokens);

      logger.info({ accountId }, 'Token refreshed successfully');
    },
    { connection, concurrency: 5 },
  );

  tokenRefreshWorker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({ accountId: job.data.accountId, error: err.message }, 'Token refresh failed');

    if (job.attemptsMade >= 3) {
      await accountService.markExpired(job.data.accountId);
      logger.warn({ accountId: job.data.accountId }, 'Account marked as expired after token refresh failures');
    }
  });

  // ── Analytics Worker ────────────────────────────────────────────

  const analyticsWorker = new Worker<AnalyticsJobData>(
    QUEUE_NAMES.ANALYTICS,
    async (job: Job<AnalyticsJobData>) => {
      const { postTargetId, workspaceId } = job.data;
      await analyticsService.getPostTargetAnalytics(workspaceId, postTargetId);
      logger.debug({ postTargetId }, 'Analytics collected');
    },
    { connection, concurrency: 5 },
  );

  analyticsWorker.on('failed', (job, err) => {
    if (!job) return;
    logger.error({
      jobId: job.id,
      postTargetId: job.data.postTargetId,
      error: err.message,
    }, 'Analytics collection job failed');
  });

  return { publishWorker, tokenRefreshWorker, analyticsWorker };
}
