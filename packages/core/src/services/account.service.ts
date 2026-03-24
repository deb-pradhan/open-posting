// ============================================================================
// Open Posting — Social Account Service
// ============================================================================

import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { socialAccounts } from '@open-posting/db';
import { AppError, type Platform, type TokenSet } from '@open-posting/shared';
import { encrypt, decrypt } from '../auth/encryption.js';
import type { PlatformProvider, AccountContext } from '../providers/base.provider.js';
import type { Logger } from '../logger.js';

export class AccountService {
  constructor(
    private readonly db: DbClient,
    private readonly encryptionKey: string,
    private readonly logger: Logger,
  ) {}

  async list(workspaceId: string, platform?: Platform) {
    const conditions = [eq(socialAccounts.workspaceId, workspaceId)];
    if (platform) {
      conditions.push(eq(socialAccounts.platform, platform));
    }

    return this.db
      .select()
      .from(socialAccounts)
      .where(and(...conditions))
      .orderBy(socialAccounts.sortOrder);
  }

  async getById(id: string, workspaceId: string) {
    const [account] = await this.db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.workspaceId, workspaceId)))
      .limit(1);

    if (!account) {
      throw new AppError('NOT_FOUND', `Account ${id} not found`);
    }

    return account;
  }

  async getAccountContext(id: string, workspaceId: string): Promise<AccountContext> {
    const account = await this.getById(id, workspaceId);

    if (account.status !== 'active') {
      this.logger.warn({ accountId: id, status: account.status }, 'Account context requested but account not active');
      throw new AppError('AUTH_ACCOUNT_EXPIRED', `Account ${id} is ${account.status}`);
    }

    this.logger.debug({ accountId: id, platform: account.platform }, 'Account context retrieved');
    return {
      id: account.id,
      platform: account.platform as Platform,
      platformUserId: account.platformUserId,
      accessToken: decrypt(account.accessTokenEnc, this.encryptionKey),
      refreshToken: account.refreshTokenEnc ? decrypt(account.refreshTokenEnc, this.encryptionKey) : undefined,
      metadata: account.metadata as Record<string, unknown>,
    };
  }

  async createFromOAuth(
    workspaceId: string,
    platform: Platform,
    tokens: TokenSet,
    profile: {
      platformUserId: string;
      platformUsername: string;
      displayName: string;
      avatarUrl?: string;
    },
    provider: string = 'official',
  ) {
    const accessTokenEnc = encrypt(tokens.accessToken, this.encryptionKey);
    const refreshTokenEnc = tokens.refreshToken ? encrypt(tokens.refreshToken, this.encryptionKey) : null;

    const [account] = await this.db.insert(socialAccounts).values({
      workspaceId,
      platform,
      platformUserId: profile.platformUserId,
      platformUsername: profile.platformUsername,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl ?? null,
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scope ? tokens.scope.split(' ') : [],
      provider,
      status: 'active',
    }).onConflictDoUpdate({
      target: [socialAccounts.workspaceId, socialAccounts.platform, socialAccounts.platformUserId],
      set: {
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt: tokens.expiresAt ?? null,
        status: 'active',
        updatedAt: new Date(),
      },
    }).returning();

    this.logger.info({ workspaceId, platform, accountId: account!.id }, 'Account connected');
    return account!;
  }

  async updateTokens(accountId: string, tokens: TokenSet): Promise<void> {
    this.logger.info({ accountId, expiresAt: tokens.expiresAt?.toISOString() }, 'Updating account tokens');
    const accessTokenEnc = encrypt(tokens.accessToken, this.encryptionKey);
    const refreshTokenEnc = tokens.refreshToken ? encrypt(tokens.refreshToken, this.encryptionKey) : undefined;

    await this.db
      .update(socialAccounts)
      .set({
        accessTokenEnc,
        ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
        tokenExpiresAt: tokens.expiresAt ?? null,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, accountId));
    this.logger.debug({ accountId }, 'Account tokens updated');
  }

  async markExpired(accountId: string): Promise<void> {
    this.logger.warn({ accountId }, 'Marking account as expired');
    await this.db
      .update(socialAccounts)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(socialAccounts.id, accountId));
    this.logger.info({ accountId }, 'Account marked as expired');
  }

  async disconnect(id: string, workspaceId: string): Promise<void> {
    const result = await this.db
      .delete(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.workspaceId, workspaceId)))
      .returning();

    if (result.length === 0) {
      throw new AppError('NOT_FOUND', `Account ${id} not found`);
    }

    this.logger.info({ accountId: id, workspaceId }, 'Account disconnected');
  }

  async updateMetadata(accountId: string, metadata: Record<string, unknown>): Promise<void> {
    this.logger.info({ accountId }, 'Updating account metadata');
    await this.db
      .update(socialAccounts)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(socialAccounts.id, accountId));
  }

  async updateLastUsed(accountId: string): Promise<void> {
    await this.db
      .update(socialAccounts)
      .set({ lastUsedAt: new Date() })
      .where(eq(socialAccounts.id, accountId));
  }
}
