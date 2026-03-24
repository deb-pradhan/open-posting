// ============================================================================
// Open Posting — Workspace Service
// ============================================================================

import { eq } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { workspaces } from '@open-posting/db';
import { AppError } from '@open-posting/shared';
import { generateApiKey, extractKeyPrefix, hashApiKey, verifyApiKey } from '../auth/api-keys.js';
import type { Logger } from '../logger.js';

export class WorkspaceService {
  constructor(
    private readonly db: DbClient,
    private readonly logger: Logger,
  ) {}

  async create(name: string): Promise<{ workspace: typeof workspaces.$inferSelect; apiKey: string }> {
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const apiKeyPrefix = extractKeyPrefix(apiKey);

    const [workspace] = await this.db.insert(workspaces).values({
      name,
      apiKeyHash,
      apiKeyPrefix,
    }).returning();

    this.logger.info({ workspaceId: workspace!.id }, 'Workspace created');

    return { workspace: workspace!, apiKey };
  }

  async authenticate(apiKey: string): Promise<typeof workspaces.$inferSelect> {
    const prefix = extractKeyPrefix(apiKey);

    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.apiKeyPrefix, prefix))
      .limit(1);

    if (!workspace) {
      throw new AppError('AUTH_INVALID_KEY', 'Invalid API key');
    }

    const valid = await verifyApiKey(apiKey, workspace.apiKeyHash);
    if (!valid) {
      throw new AppError('AUTH_INVALID_KEY', 'Invalid API key');
    }

    return workspace;
  }

  async getById(id: string): Promise<typeof workspaces.$inferSelect | undefined> {
    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);

    return workspace;
  }

  async setEmergencyStop(workspaceId: string, active: boolean): Promise<void> {
    await this.db
      .update(workspaces)
      .set({ emergencyStop: active, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    this.logger.warn({ workspaceId, active }, 'Emergency stop toggled');
  }

  async isEmergencyStopped(workspaceId: string): Promise<boolean> {
    const workspace = await this.getById(workspaceId);
    return workspace?.emergencyStop ?? false;
  }
}
