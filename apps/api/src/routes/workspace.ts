// ============================================================================
// Open Posting — Workspace Routes (setup, emergency stop)
// ============================================================================

import { Hono } from 'hono';
import type { WorkspaceService } from '@open-posting/core';
import type { AuthEnv } from '../middleware/auth.js';

interface WorkspaceDeps {
  workspaceService: WorkspaceService;
}

export function workspaceRoutes(deps: WorkspaceDeps) {
  const app = new Hono();

  // Create workspace (no auth required — this is the bootstrap endpoint)
  app.post('/setup', async (c) => {
    const body = await c.req.json<{ name: string }>();
    const { workspace, apiKey } = await deps.workspaceService.create(body.name || 'Default Workspace');

    return c.json({
      ok: true,
      data: {
        workspaceId: workspace.id,
        apiKey,
        message: 'Save this API key — it cannot be retrieved again.',
      },
    }, 201);
  });

  return app;
}

export function emergencyRoutes(deps: WorkspaceDeps) {
  const app = new Hono<AuthEnv>();

  // Activate emergency stop
  app.post('/emergency-stop', async (c) => {
    const workspaceId = c.get('workspaceId');
    await deps.workspaceService.setEmergencyStop(workspaceId, true);

    return c.json({
      ok: true,
      data: { emergencyStop: true, message: 'All publishing has been halted.' },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Deactivate emergency stop
  app.delete('/emergency-stop', async (c) => {
    const workspaceId = c.get('workspaceId');
    await deps.workspaceService.setEmergencyStop(workspaceId, false);

    return c.json({
      ok: true,
      data: { emergencyStop: false, message: 'Publishing resumed.' },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Get emergency stop status
  app.get('/emergency-stop', async (c) => {
    const workspaceId = c.get('workspaceId');
    const active = await deps.workspaceService.isEmergencyStopped(workspaceId);

    return c.json({
      ok: true,
      data: { emergencyStop: active },
      meta: { requestId: c.get('requestId') },
    });
  });

  return app;
}
