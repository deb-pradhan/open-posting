// ============================================================================
// Open Posting — Post Service
// ============================================================================

import { eq, and, desc, sql } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { posts, postTargets } from '@open-posting/db';
import {
  AppError,
  type PostStatus,
  type Platform,
  type CreatePostRequest,
  type CreatePostResponse,
} from '@open-posting/shared';
import type { AccountService } from './account.service.js';
import type { Logger } from '../logger.js';

export class PostService {
  constructor(
    private readonly db: DbClient,
    private readonly accountService: AccountService,
    private readonly logger: Logger,
  ) {}

  async create(
    workspaceId: string,
    request: CreatePostRequest,
  ): Promise<CreatePostResponse> {
    // Check idempotency
    if (request.idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(posts)
        .where(and(
          eq(posts.workspaceId, workspaceId),
          eq(posts.idempotencyKey, request.idempotencyKey),
        ))
        .limit(1);

      if (existing) {
        return this.getPostResponse(existing.id, workspaceId);
      }
    }

    // Validate all target accounts exist and are active, auto-fill platform if missing
    for (const target of request.targets) {
      const account = await this.accountService.getById(target.accountId, workspaceId);
      if (!target.platform) {
        (target as any).platform = account.platform;
      }
    }

    // Determine initial status
    const status: PostStatus = request.scheduledAt ? 'scheduled' : 'publishing';

    // Create post
    const [post] = await this.db.insert(posts).values({
      workspaceId,
      status,
      content: {
        text: request.content.text,
        platformOverrides: request.content.platformOverrides as Record<string, unknown> | undefined,
        media: request.content.media?.map(m => ({
          id: m.uploadId ?? '',
          type: 'image',
          url: m.url ?? '',
          altText: m.altText,
        })),
        thread: request.content.thread?.map(t => ({
          text: t.text,
          media: t.media?.map(m => ({
            id: m.uploadId ?? '',
            type: 'image',
            url: m.url ?? '',
            altText: m.altText,
          })),
        })),
        poll: request.content.poll,
      },
      scheduledAt: request.scheduledAt ? new Date(request.scheduledAt) : null,
      idempotencyKey: request.idempotencyKey ?? null,
    }).returning();

    // Create targets
    const targetRows = request.targets.map(t => ({
      postId: post!.id,
      socialAccountId: t.accountId,
      platform: t.platform,
      status: 'pending' as const,
    }));

    await this.db.insert(postTargets).values(targetRows);

    this.logger.info({
      postId: post!.id,
      workspaceId,
      targetCount: request.targets.length,
      status,
    }, 'Post created');

    return this.getPostResponse(post!.id, workspaceId);
  }

  async getPostResponse(postId: string, workspaceId: string): Promise<CreatePostResponse> {
    const [post] = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);

    if (!post) {
      throw new AppError('NOT_FOUND', `Post ${postId} not found`);
    }

    const targets = await this.db
      .select()
      .from(postTargets)
      .where(eq(postTargets.postId, postId));

    return {
      id: post.id,
      status: post.status as PostStatus,
      targets: targets.map(t => ({
        accountId: t.socialAccountId,
        platform: t.platform as Platform,
        status: t.status as 'pending' | 'publishing' | 'published' | 'failed',
        platformPostId: t.platformPostId ?? undefined,
        platformPostUrl: t.platformPostUrl ?? undefined,
        error: t.error ?? undefined,
      })),
      scheduledAt: post.scheduledAt?.toISOString(),
      publishedAt: post.publishedAt?.toISOString(),
    };
  }

  async list(workspaceId: string, options?: {
    status?: PostStatus;
    platform?: Platform;
    limit?: number;
    cursor?: string;
  }) {
    const limit = Math.min(options?.limit ?? 20, 100);

    let query = this.db
      .select()
      .from(posts)
      .where(eq(posts.workspaceId, workspaceId))
      .orderBy(desc(posts.createdAt))
      .limit(limit);

    if (options?.status) {
      query = this.db
        .select()
        .from(posts)
        .where(and(
          eq(posts.workspaceId, workspaceId),
          eq(posts.status, options.status),
        ))
        .orderBy(desc(posts.createdAt))
        .limit(limit);
    }

    const results = await query;

    // Fetch targets for each post
    const postsWithTargets = await Promise.all(
      results.map(async (post) => {
        const targets = await this.db
          .select()
          .from(postTargets)
          .where(eq(postTargets.postId, post.id));

        return { ...post, targets };
      }),
    );

    return postsWithTargets;
  }

  async getById(postId: string, workspaceId: string) {
    const [post] = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);

    if (!post) {
      throw new AppError('NOT_FOUND', `Post ${postId} not found`);
    }

    const targets = await this.db
      .select()
      .from(postTargets)
      .where(eq(postTargets.postId, postId));

    return { ...post, targets };
  }

  async update(postId: string, workspaceId: string, data: Partial<CreatePostRequest>) {
    this.logger.info({ postId, workspaceId }, 'Updating post');
    const post = await this.getById(postId, workspaceId);

    if (post.status !== 'draft' && post.status !== 'scheduled') {
      this.logger.warn({ postId, status: post.status }, 'Cannot update post in current status');
      throw new AppError('VALIDATION_FAILED', `Cannot update post in ${post.status} status`);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (data.content) {
      updates['content'] = {
        text: data.content.text ?? (post.content as { text: string }).text,
        platformOverrides: data.content.platformOverrides,
        media: data.content.media?.map(m => ({
          id: m.uploadId ?? '',
          type: 'image',
          url: m.url ?? '',
          altText: m.altText,
        })),
        poll: data.content.poll,
      };
    }

    if (data.scheduledAt !== undefined) {
      updates['scheduledAt'] = data.scheduledAt ? new Date(data.scheduledAt) : null;
      updates['status'] = data.scheduledAt ? 'scheduled' : 'draft';
    }

    await this.db
      .update(posts)
      .set(updates)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)));

    this.logger.info({ postId, updatedFields: Object.keys(updates) }, 'Post updated');
    return this.getById(postId, workspaceId);
  }

  async delete(postId: string, workspaceId: string): Promise<void> {
    const post = await this.getById(postId, workspaceId);

    // Delete post and cascade to targets
    await this.db
      .delete(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)));

    this.logger.info({ postId, workspaceId, previousStatus: post.status }, 'Post deleted');
  }

  async updateTargetStatus(
    targetId: string,
    status: string,
    data?: {
      platformPostId?: string;
      platformPostUrl?: string;
      error?: { code: string; message: string; retryable: boolean };
    },
  ): Promise<void> {
    this.logger.debug({ targetId, status, platformPostId: data?.platformPostId, hasError: !!data?.error }, 'Updating target status');
    await this.db
      .update(postTargets)
      .set({
        status,
        platformPostId: data?.platformPostId ?? undefined,
        platformPostUrl: data?.platformPostUrl ?? undefined,
        error: data?.error ?? undefined,
        publishedAt: status === 'published' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(postTargets.id, targetId));

    if (data?.error) {
      this.logger.warn({ targetId, errorCode: data.error.code, errorMessage: data.error.message, retryable: data.error.retryable }, 'Target failed');
    }
  }

  async updatePostStatus(postId: string): Promise<void> {
    const targets = await this.db
      .select()
      .from(postTargets)
      .where(eq(postTargets.postId, postId));

    const allPublished = targets.every(t => t.status === 'published');
    const allFailed = targets.every(t => t.status === 'failed');
    const anyFailed = targets.some(t => t.status === 'failed');
    const anyPublished = targets.some(t => t.status === 'published');

    let status: PostStatus;
    if (allPublished) {
      status = 'published';
    } else if (allFailed) {
      status = 'failed';
    } else if (anyFailed && anyPublished) {
      status = 'partially_failed';
    } else {
      status = 'publishing';
    }

    const targetStatuses = targets.map(t => `${t.id}:${t.status}`);
    this.logger.info({ postId, newStatus: status, targetStatuses }, 'Post status rollup');

    await this.db
      .update(posts)
      .set({
        status,
        publishedAt: status === 'published' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId));
  }
}
