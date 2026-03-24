// ============================================================================
// Open Posting — Analytics Routes
// ============================================================================

import { Hono } from 'hono';
import type { AnalyticsService } from '@open-posting/core';
import type { AuthEnv } from '../middleware/auth.js';

interface AnalyticsDeps {
  analyticsService: AnalyticsService;
}

export function analyticsRoutes(deps: AnalyticsDeps) {
  const app = new Hono<AuthEnv>();

  // Get post analytics (aggregated across all platforms)
  app.get('/posts/:postId', async (c) => {
    const workspaceId = c.get('workspaceId');
    const postId = c.req.param('postId');
    const analytics = await deps.analyticsService.getPostAnalytics(workspaceId, postId);

    return c.json({
      ok: true,
      data: analytics,
      meta: { requestId: c.get('requestId') },
    });
  });

  return app;
}
