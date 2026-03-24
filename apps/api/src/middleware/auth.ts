// ============================================================================
// Open Posting — Auth Middleware (Hono)
// ============================================================================

import { createMiddleware } from 'hono/factory';
import type { WorkspaceService } from '@open-posting/core';
import { createLogger } from '@open-posting/core';
import { AppError, type LogLevel } from '@open-posting/shared';

const logger = createLogger((process.env['LOG_LEVEL'] as LogLevel) ?? 'info', 'api:auth');

export interface AuthEnv {
  Variables: {
    workspaceId: string;
    workspace: Awaited<ReturnType<WorkspaceService['authenticate']>>;
    requestId: string;
  };
}

export function authMiddleware(workspaceService: WorkspaceService) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      logger.debug({ path: c.req.path }, 'Auth: Missing authorization header');
      throw new AppError('AUTH_MISSING_KEY', 'Authorization header required');
    }

    const apiKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!apiKey || !apiKey.startsWith('op_')) {
      logger.warn({ path: c.req.path, keyPrefix: apiKey?.substring(0, 6) }, 'Auth: Invalid API key format');
      throw new AppError('AUTH_INVALID_KEY', 'Invalid API key format. Expected: Bearer op_<key>');
    }

    try {
      const workspace = await workspaceService.authenticate(apiKey);
      c.set('workspaceId', workspace.id);
      c.set('workspace', workspace);
      logger.debug({ workspaceId: workspace.id, path: c.req.path, method: c.req.method }, 'Auth: Authenticated');
    } catch (err) {
      logger.warn({ path: c.req.path, error: err instanceof Error ? err.message : 'Unknown' }, 'Auth: Authentication failed');
      throw err;
    }

    await next();
  });
}
