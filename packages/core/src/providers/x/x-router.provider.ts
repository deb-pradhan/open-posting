// ============================================================================
// Open Posting — X Provider Router (Official ↔ GetXAPI Fallback)
// ============================================================================

import {
  X_OFFICIAL_CAPABILITIES,
  AppError,
  type Platform,
  type ProviderCapabilities,
  type ProviderHealth,
  type TokenSet,
  type PlatformPostResult,
  type PlatformThreadResult,
  type PlatformMediaResult,
  type PostMetrics,
} from '@open-posting/shared';
import { PlatformProvider, type AccountContext, type NormalizedContent, type MediaPayload } from '../base.provider.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import { XOfficialProvider } from './x-official.provider.js';
import { XGetXApiProvider } from './x-getxapi.provider.js';
import type { Logger } from '../../logger.js';

/**
 * Routes X API calls between Official and GetXAPI providers.
 *
 * Strategy:
 * - Official API is DEFAULT for all write operations
 * - GetXAPI is FALLBACK when official is rate-limited, returns 5xx, or credits depleted
 * - Official is used for analytics (GetXAPI doesn't support them)
 * - Circuit breaker prevents cascading failures
 */
export class XRouterProvider extends PlatformProvider {
  readonly platform: Platform = 'x';
  readonly providerName = 'x-router';
  readonly capabilities: ProviderCapabilities = X_OFFICIAL_CAPABILITIES;

  private officialBreaker: CircuitBreaker;

  constructor(
    logger: Logger,
    private readonly official: XOfficialProvider,
    private readonly getxapi?: XGetXApiProvider,
  ) {
    super(logger);
    this.officialBreaker = new CircuitBreaker('x-official', logger);
  }

  // ── Routing Logic ──────────────────────────────────────────────────

  private async executeWithFallback<T>(
    operation: string,
    primaryFn: () => Promise<T>,
    fallbackFn?: () => Promise<T>,
  ): Promise<T> {
    // Try primary (official)
    if (this.officialBreaker.isAvailable()) {
      try {
        return await this.officialBreaker.execute(primaryFn);
      } catch (error) {
        if (error instanceof AppError) {
          const shouldFallback =
            error.code === 'PLATFORM_RATE_LIMITED' ||
            error.code === 'PLATFORM_UNAVAILABLE' ||
            error.message.includes('CreditsDepleted');

          if (shouldFallback && fallbackFn) {
            this.logger.warn({ operation, error: error.code, message: error.message }, 'Official API failed, falling back to GetXAPI');
            return await fallbackFn();
          }
        }
        throw error;
      }
    }

    // Official breaker is open — try fallback
    if (fallbackFn) {
      this.logger.warn({ operation }, 'Official circuit open, using GetXAPI fallback');
      return await fallbackFn();
    }

    throw new AppError('PROVIDER_FALLBACK_EXHAUSTED', `All X API providers exhausted for: ${operation}`);
  }

  // ── Posts (write → official first, getxapi fallback) ───────────────

  async createPost(account: AccountContext, content: NormalizedContent): Promise<PlatformPostResult> {
    return this.executeWithFallback(
      'createPost',
      () => this.official.createPost(account, content),
      this.canFallback(account) ? () => this.getxapi!.createPost(account, content) : undefined,
    );
  }

  async deletePost(account: AccountContext, platformPostId: string): Promise<void> {
    // Delete only through official — no fallback
    return this.official.deletePost(account, platformPostId);
  }

  async createThread(
    account: AccountContext,
    items: Array<{ text: string; media?: MediaPayload[] }>,
  ): Promise<PlatformThreadResult> {
    return this.executeWithFallback(
      'createThread',
      () => this.official.createThread(account, items),
      this.canFallback(account) ? () => this.getxapi!.createThread(account, items) : undefined,
    );
  }

  // ── Engagement ─────────────────────────────────────────────────────

  async like(account: AccountContext, postId: string): Promise<void> {
    return this.executeWithFallback(
      'like',
      () => this.official.like(account, postId),
      this.canFallback(account) ? () => this.getxapi!.like(account, postId) : undefined,
    );
  }

  async unlike(account: AccountContext, postId: string): Promise<void> {
    return this.executeWithFallback(
      'unlike',
      () => this.official.unlike(account, postId),
    );
  }

  async comment(account: AccountContext, postId: string, text: string): Promise<PlatformPostResult> {
    return this.executeWithFallback(
      'comment',
      () => this.official.comment(account, postId, text),
      this.canFallback(account) ? () => this.getxapi!.comment(account, postId, text) : undefined,
    );
  }

  async repost(account: AccountContext, postId: string): Promise<void> {
    return this.executeWithFallback(
      'repost',
      () => this.official.repost(account, postId),
      this.canFallback(account) ? () => this.getxapi!.repost(account, postId) : undefined,
    );
  }

  async unrepost(account: AccountContext, postId: string): Promise<void> {
    return this.executeWithFallback(
      'unrepost',
      () => this.official.unrepost(account, postId),
    );
  }

  async bookmark(account: AccountContext, postId: string): Promise<void> {
    return this.executeWithFallback(
      'bookmark',
      () => this.official.bookmark(account, postId),
    );
  }

  // ── Media (official only — getxapi handles inline) ─────────────────

  async uploadMedia(account: AccountContext, media: MediaPayload): Promise<PlatformMediaResult> {
    return this.official.uploadMedia(account, media);
  }

  // ── Analytics (official only) ──────────────────────────────────────

  async getPostMetrics(account: AccountContext, platformPostId: string): Promise<PostMetrics> {
    return this.official.getPostMetrics(account, platformPostId);
  }

  // ── Auth (delegated to official) ───────────────────────────────────

  getAuthUrl(state: string, redirectUri: string, scopes?: string[]): string {
    return this.official.getAuthUrl(state, redirectUri, scopes);
  }

  async handleCallback(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenSet> {
    return this.official.handleCallback(code, redirectUri, codeVerifier);
  }

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    return this.official.refreshToken(refreshToken);
  }

  // ── Private Helpers ────────────────────────────────────────────────

  /**
   * Only fall back to GetXAPI if the provider is configured AND
   * the account has a GetXAPI auth_token stored in metadata.
   */
  private canFallback(account: AccountContext): boolean {
    if (!this.getxapi) return false;
    const hasToken = !!(account.metadata?.['getxapi_auth_token']);
    if (!hasToken) {
      this.logger.debug({ accountId: account.id }, 'GetXAPI fallback skipped — no auth_token in account metadata');
    }
    return hasToken;
  }

  // ── Health ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ProviderHealth> {
    const health = await this.official.healthCheck();
    return {
      ...health,
      circuitState: this.officialBreaker.getState(),
    };
  }
}
