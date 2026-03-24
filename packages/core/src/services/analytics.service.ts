// ============================================================================
// Open Posting — Analytics Service
// ============================================================================

import { eq, and, desc } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { postTargets, analyticsSnapshots } from '@open-posting/db';
import { AppError, type Platform, type PostMetrics } from '@open-posting/shared';
import type { AccountService } from './account.service.js';
import type { PlatformProvider } from '../providers/base.provider.js';
import type { Logger } from '../logger.js';

export class AnalyticsService {
  constructor(
    private readonly db: DbClient,
    private readonly accountService: AccountService,
    private readonly providers: Map<Platform, PlatformProvider>,
    private readonly logger: Logger,
  ) {}

  /**
   * Get analytics for a specific post target (one platform).
   * Fetches fresh data from the platform and stores a snapshot.
   */
  async getPostTargetAnalytics(
    workspaceId: string,
    postTargetId: string,
  ): Promise<PostMetrics> {
    const [target] = await this.db
      .select()
      .from(postTargets)
      .where(eq(postTargets.id, postTargetId))
      .limit(1);

    if (!target || !target.platformPostId) {
      throw new AppError('NOT_FOUND', 'Post target not found or not yet published');
    }

    const account = await this.accountService.getAccountContext(
      target.socialAccountId,
      workspaceId,
    );
    const provider = this.providers.get(target.platform as Platform);

    if (!provider) {
      throw new AppError('VALIDATION_FAILED', `Unsupported platform: ${target.platform}`);
    }

    const metrics = await provider.getPostMetrics(account, target.platformPostId);

    // Store snapshot
    await this.db.insert(analyticsSnapshots).values({
      postTargetId,
      platform: target.platform,
      metrics: metrics as unknown as Record<string, number>,
      platformSpecific: metrics.platformSpecific,
    });

    this.logger.info({
      postTargetId,
      platform: target.platform,
      likes: metrics.likes,
      comments: metrics.comments,
      impressions: metrics.impressions,
    }, 'Analytics snapshot stored');

    return metrics;
  }

  /**
   * Get aggregated analytics for all targets of a post.
   */
  async getPostAnalytics(workspaceId: string, postId: string) {
    const targets = await this.db
      .select()
      .from(postTargets)
      .where(eq(postTargets.postId, postId));

    const results: Array<{
      targetId: string;
      platform: string;
      metrics: PostMetrics;
    }> = [];

    for (const target of targets) {
      if (!target.platformPostId) continue;

      try {
        const metrics = await this.getPostTargetAnalytics(workspaceId, target.id);
        results.push({
          targetId: target.id,
          platform: target.platform,
          metrics,
        });
      } catch (error) {
        this.logger.warn({
          targetId: target.id,
          platform: target.platform,
          error: error instanceof Error ? error.message : 'Unknown',
        }, 'Failed to fetch analytics for target');
      }
    }

    // Aggregate
    const aggregate: PostMetrics = {
      likes: 0,
      comments: 0,
      reposts: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      engagement_rate: 0,
      platformSpecific: {},
    };

    for (const r of results) {
      aggregate.likes += r.metrics.likes;
      aggregate.comments += r.metrics.comments;
      aggregate.reposts += r.metrics.reposts;
      aggregate.impressions += r.metrics.impressions;
      aggregate.clicks += r.metrics.clicks;
      aggregate.reach += r.metrics.reach;
      (aggregate.platformSpecific as Record<string, unknown>)[r.platform] = r.metrics.platformSpecific;
    }

    if (aggregate.impressions > 0) {
      aggregate.engagement_rate = ((aggregate.likes + aggregate.comments + aggregate.reposts) / aggregate.impressions) * 100;
    }

    return {
      aggregate,
      platforms: results,
    };
  }

  /**
   * Get analytics history (snapshots) for a post target.
   */
  async getSnapshotHistory(postTargetId: string, limit: number = 50) {
    return this.db
      .select()
      .from(analyticsSnapshots)
      .where(eq(analyticsSnapshots.postTargetId, postTargetId))
      .orderBy(desc(analyticsSnapshots.collectedAt))
      .limit(limit);
  }
}
