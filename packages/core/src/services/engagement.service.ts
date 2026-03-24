// ============================================================================
// Open Posting — Engagement Service
// ============================================================================

import { eq, and, desc } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { engagementActions } from '@open-posting/db';
import {
  AppError,
  type Platform,
  type EngagementType,
  type EngageRequest,
} from '@open-posting/shared';
import type { AccountService } from './account.service.js';
import type { PlatformProvider } from '../providers/base.provider.js';
import type { Logger } from '../logger.js';

export class EngagementService {
  constructor(
    private readonly db: DbClient,
    private readonly accountService: AccountService,
    private readonly providers: Map<Platform, PlatformProvider>,
    private readonly logger: Logger,
  ) {}

  async engage(workspaceId: string, request: EngageRequest) {
    const account = await this.accountService.getAccountContext(request.accountId, workspaceId);
    const provider = this.providers.get(request.platform);

    if (!provider) {
      throw new AppError('VALIDATION_FAILED', `Unsupported platform: ${request.platform}`);
    }

    // Create engagement record
    const [record] = await this.db.insert(engagementActions).values({
      workspaceId,
      socialAccountId: request.accountId,
      platform: request.platform,
      action: request.action,
      targetPostId: request.targetPostId,
      content: request.content,
      status: 'pending',
    }).returning();

    try {
      let responseId: string | undefined;

      switch (request.action) {
        case 'like':
          await provider.like(account, request.targetPostId);
          break;
        case 'unlike':
          await provider.unlike(account, request.targetPostId);
          break;
        case 'comment': {
          if (!request.content) {
            throw new AppError('VALIDATION_FAILED', 'Comment text is required');
          }
          const result = await provider.comment(account, request.targetPostId, request.content);
          responseId = result.platformPostId;
          break;
        }
        case 'repost':
          await provider.repost(account, request.targetPostId);
          break;
        case 'unrepost':
          await provider.unrepost(account, request.targetPostId);
          break;
        case 'bookmark':
          await provider.bookmark(account, request.targetPostId);
          break;
      }

      // Update status
      await this.db
        .update(engagementActions)
        .set({
          status: 'completed',
          platformResponseId: responseId ?? null,
        })
        .where(eq(engagementActions.id, record!.id));

      await this.accountService.updateLastUsed(request.accountId);

      this.logger.info({
        engagementId: record!.id,
        action: request.action,
        platform: request.platform,
      }, 'Engagement action completed');

      return { ...record!, status: 'completed', platformResponseId: responseId };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error({
        engagementId: record!.id,
        action: request.action,
        platform: request.platform,
        targetPostId: request.targetPostId,
        error: errorMessage,
      }, 'Engagement action failed');

      await this.db
        .update(engagementActions)
        .set({
          status: 'failed',
          error: errorMessage,
        })
        .where(eq(engagementActions.id, record!.id));

      throw error;
    }
  }

  async list(workspaceId: string, limit: number = 20) {
    return this.db
      .select()
      .from(engagementActions)
      .where(eq(engagementActions.workspaceId, workspaceId))
      .orderBy(desc(engagementActions.createdAt))
      .limit(limit);
  }
}
