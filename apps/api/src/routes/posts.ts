// ============================================================================
// Open Posting — Post Routes
// ============================================================================

import { Hono } from 'hono';
import type { PostService, PostPublisher, WorkspaceService } from '@open-posting/core';
import { AppError, type CreatePostRequest, type PostStatus, type Platform } from '@open-posting/shared';
import type { AuthEnv } from '../middleware/auth.js';

interface PostDeps {
  postService: PostService;
  publisher: PostPublisher;
  workspaceService: WorkspaceService;
}

export function postRoutes(deps: PostDeps) {
  const app = new Hono<AuthEnv>();

  // Create post
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId');

    // Emergency stop check
    const stopped = await deps.workspaceService.isEmergencyStopped(workspaceId);
    if (stopped) {
      throw new AppError('EMERGENCY_STOP_ACTIVE', 'Emergency stop is active. All publishing is halted.');
    }

    const body = await c.req.json<CreatePostRequest>();

    // Validate required fields
    if (!body.content?.text) {
      throw new AppError('VALIDATION_FAILED', 'content.text is required');
    }
    if (!body.targets || body.targets.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'At least one target is required');
    }

    const post = await deps.postService.create(workspaceId, body);

    // Enqueue for publishing (immediately or scheduled)
    if (post.status === 'publishing' || post.status === 'scheduled') {
      await deps.publisher.enqueuePost(post.id, workspaceId);
    }

    return c.json({
      ok: true,
      data: post,
      meta: { requestId: c.get('requestId') },
    }, 201);
  });

  // List posts
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const status = c.req.query('status') as PostStatus | undefined;
    const platform = c.req.query('platform') as Platform | undefined;
    const limit = parseInt(c.req.query('limit') ?? '20', 10);

    const posts = await deps.postService.list(workspaceId, { status, platform, limit });

    return c.json({
      ok: true,
      data: posts,
      meta: { requestId: c.get('requestId') },
    });
  });

  // Get post by ID
  app.get('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const post = await deps.postService.getById(c.req.param('id'), workspaceId);

    return c.json({
      ok: true,
      data: post,
      meta: { requestId: c.get('requestId') },
    });
  });

  // Update post
  app.put('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = await c.req.json<Partial<CreatePostRequest>>();
    const post = await deps.postService.update(c.req.param('id'), workspaceId, body);

    return c.json({
      ok: true,
      data: post,
      meta: { requestId: c.get('requestId') },
    });
  });

  // Delete post
  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    await deps.postService.delete(c.req.param('id'), workspaceId);

    return c.json({
      ok: true,
      data: { deleted: true },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Retry failed post
  app.post('/:id/retry', async (c) => {
    const workspaceId = c.get('workspaceId');
    const postId = c.req.param('id');

    // Re-enqueue failed targets
    await deps.publisher.enqueuePost(postId, workspaceId);

    return c.json({
      ok: true,
      data: { retrying: true },
      meta: { requestId: c.get('requestId') },
    });
  });

  return app;
}
