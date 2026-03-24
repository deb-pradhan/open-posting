// ============================================================================
// Open Posting — BullMQ Queue Definitions
// ============================================================================

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { SCHEDULER } from '@open-posting/shared';
import type { Logger } from '../logger.js';

export const QUEUE_NAMES = {
  PUBLISH: 'open-posting-publish',
  MEDIA: 'open-posting-media',
  TOKEN_REFRESH: 'open-posting-token-refresh',
  ANALYTICS: 'open-posting-analytics',
  HEALTH: 'open-posting-health',
  CLEANUP: 'open-posting-cleanup',
} as const;

export type PublishJobData = {
  type: 'publish_post';
  postId: string;
  targetId: string;
  workspaceId: string;
  accountId: string;
  platform: string;
};

export type TokenRefreshJobData = {
  type: 'refresh_token';
  accountId: string;
  workspaceId: string;
};

export type AnalyticsJobData = {
  type: 'collect_analytics';
  postTargetId: string;
  workspaceId: string;
};

export function createQueues(connection: ConnectionOptions) {
  const publishQueue = new Queue<PublishJobData>(QUEUE_NAMES.PUBLISH, {
    connection,
    defaultJobOptions: {
      attempts: SCHEDULER.maxRetries,
      backoff: {
        type: SCHEDULER.backoffType,
        delay: 1000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  const tokenRefreshQueue = new Queue<TokenRefreshJobData>(QUEUE_NAMES.TOKEN_REFRESH, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
    },
  });

  const analyticsQueue = new Queue<AnalyticsJobData>(QUEUE_NAMES.ANALYTICS, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10000 },
      removeOnComplete: { count: 500 },
    },
  });

  return { publishQueue, tokenRefreshQueue, analyticsQueue };
}

export type Queues = ReturnType<typeof createQueues>;
