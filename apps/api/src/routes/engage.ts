// ============================================================================
// Open Posting — Engagement Routes
// ============================================================================

import { Hono } from 'hono';
import type { EngagementService } from '@open-posting/core';
import { AppError, type EngageRequest } from '@open-posting/shared';
import type { AuthEnv } from '../middleware/auth.js';

interface EngageDeps {
  engagementService: EngagementService;
}

export function engageRoutes(deps: EngageDeps) {
  const app = new Hono<AuthEnv>();

  // Perform engagement action
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = await c.req.json<EngageRequest>();

    if (!body.accountId || !body.action || !body.targetPostId || !body.platform) {
      throw new AppError('VALIDATION_FAILED', 'accountId, action, targetPostId, and platform are required');
    }

    const result = await deps.engagementService.engage(workspaceId, body);

    return c.json({
      ok: true,
      data: result,
      meta: { requestId: c.get('requestId') },
    });
  });

  // List engagement actions
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const actions = await deps.engagementService.list(workspaceId, limit);

    return c.json({
      ok: true,
      data: actions,
      meta: { requestId: c.get('requestId') },
    });
  });

  return app;
}
