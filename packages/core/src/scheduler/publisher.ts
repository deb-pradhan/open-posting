// ============================================================================
// Open Posting — Post Publisher (Enqueue publish jobs)
// ============================================================================

import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { posts, postTargets } from '@open-posting/db';
import type { Queues } from './queue.js';
import type { PublishJobData } from './queue.js';
import type { Logger } from '../logger.js';

export class PostPublisher {
  constructor(
    private readonly db: DbClient,
    private readonly queues: Queues,
    private readonly logger: Logger,
  ) {}

  /**
   * Enqueue publish jobs for all pending targets of a post.
   * For scheduled posts, jobs are delayed until scheduledAt.
   */
  async enqueuePost(postId: string, workspaceId: string): Promise<void> {
    const [post] = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);

    if (!post) return;

    const targets = await this.db
      .select()
      .from(postTargets)
      .where(and(eq(postTargets.postId, postId), eq(postTargets.status, 'pending')));

    for (const target of targets) {
      const jobData: PublishJobData = {
        type: 'publish_post',
        postId,
        targetId: target.id,
        workspaceId,
        accountId: target.socialAccountId,
        platform: target.platform,
      };

      // Deterministic job ID for exactly-once semantics
      const jobId = `publish:${postId}:${target.id}`;

      const delay = post.scheduledAt
        ? Math.max(0, post.scheduledAt.getTime() - Date.now())
        : 0;

      await this.queues.publishQueue.add('publish' as any, jobData, {
        jobId,
        delay,
      });

      this.logger.info({
        postId,
        targetId: target.id,
        platform: target.platform,
        delay,
        jobId,
      }, 'Publish job enqueued');
    }
  }
}
