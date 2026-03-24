// ============================================================================
// Open Posting — X GetXAPI Provider (Fallback/Proxy)
// ============================================================================
//
// Uses getxapi.com as an alternative X API provider.
// Auth: GetXAPI API key (Bearer) + Twitter session auth_token per request.
// Docs: https://docs.getxapi.com

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
import type { Logger } from '../../logger.js';

const GETXAPI_BASE = 'https://api.getxapi.com';

interface GetXApiConfig {
  apiKey: string;
}

interface GetXApiResponse {
  status: string;
  msg?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export class XGetXApiProvider extends PlatformProvider {
  readonly platform: Platform = 'x';
  readonly providerName = 'x-getxapi';
  readonly capabilities: ProviderCapabilities = X_OFFICIAL_CAPABILITIES;

  constructor(
    logger: Logger,
    private readonly config: GetXApiConfig,
  ) {
    super(logger);
  }

  /**
   * Login to Twitter via GetXAPI to obtain an auth_token.
   * This token is stored in the account's metadata for subsequent calls.
   */
  async login(username: string, password: string, email?: string, totpSecret?: string): Promise<{
    authToken: string;
    ct0: string;
    twid: string;
  }> {
    this.logger.info({ username }, 'GetXAPI: Logging in to obtain auth_token');

    const body: Record<string, string> = { username, password };
    if (email) body['email'] = email;
    if (totpSecret) body['totp_secret'] = totpSecret;

    const res = await this.gxFetch('/twitter/user_login', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = res.data as { auth_token?: string; ct0?: string; twid?: string } | undefined;
    if (!data?.auth_token) {
      this.logger.error({ response: res }, 'GetXAPI: Login failed — no auth_token returned');
      throw new AppError('PLATFORM_AUTH_FAILED', 'GetXAPI login failed: no auth_token returned');
    }

    this.logger.info({ username }, 'GetXAPI: Login successful');
    return {
      authToken: data.auth_token,
      ct0: data.ct0 ?? '',
      twid: data.twid ?? '',
    };
  }

  // ── Posts ──────────────────────────────────────────────────────────

  async createPost(account: AccountContext, content: NormalizedContent): Promise<PlatformPostResult> {
    const authToken = this.getAuthToken(account);

    this.logger.info({ accountId: account.id, textLength: content.text.length }, 'GetXAPI: Creating post');

    const body: Record<string, unknown> = {
      auth_token: authToken,
      text: content.text,
    };

    if (content.replyToId) {
      body['reply_to_tweet_id'] = content.replyToId;
    }

    // Media: use media_urls if we have URLs, or base64 for buffers
    if (content.media && content.media.length > 0) {
      const mediaPayloads: Array<{ data: string; type: string }> = [];
      for (const m of content.media) {
        mediaPayloads.push({
          data: m.buffer.toString('base64'),
          type: m.mimeType,
        });
      }
      body['media'] = mediaPayloads;
      this.logger.debug({ mediaCount: mediaPayloads.length }, 'GetXAPI: Attaching media as base64');
    }

    const res = await this.gxFetch('/twitter/tweet/create', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const tweetData = res.data as { id?: string; text?: string } | undefined;
    const tweetId = tweetData?.id ?? '';

    if (!tweetId) {
      this.logger.error({ response: res }, 'GetXAPI: No tweet ID in response');
      throw new AppError('PLATFORM_REJECTED', 'GetXAPI: tweet created but no ID returned');
    }

    this.logger.info({ accountId: account.id, platformPostId: tweetId }, 'GetXAPI: Post created');
    return {
      platformPostId: tweetId,
      platformPostUrl: `https://x.com/i/status/${tweetId}`,
    };
  }

  async deletePost(_account: AccountContext, _platformPostId: string): Promise<void> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI: delete not implemented');
  }

  // ── Threads ────────────────────────────────────────────────────────

  async createThread(
    account: AccountContext,
    items: Array<{ text: string; media?: MediaPayload[] }>,
  ): Promise<PlatformThreadResult> {
    this.logger.info({ accountId: account.id, threadLength: items.length }, 'GetXAPI: Creating thread');
    const results: PlatformPostResult[] = [];
    let replyToId: string | undefined;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      const content: NormalizedContent = {
        text: item.text,
        media: item.media,
        replyToId,
      };

      this.logger.debug({ threadIndex: idx, replyToId }, 'GetXAPI: Creating thread item');
      const result = await this.createPost(account, content);
      results.push(result);
      replyToId = result.platformPostId;
    }

    this.logger.info({ threadId: results[0]!.platformPostId, postCount: results.length }, 'GetXAPI: Thread created');
    return {
      threadId: results[0]!.platformPostId,
      posts: results,
    };
  }

  // ── Engagement ─────────────────────────────────────────────────────

  async like(account: AccountContext, postId: string): Promise<void> {
    const authToken = this.getAuthToken(account);
    this.logger.info({ postId }, 'GetXAPI: Liking tweet');
    await this.gxFetch('/twitter/tweet/like', {
      method: 'POST',
      body: JSON.stringify({ auth_token: authToken, tweet_id: postId }),
    });
  }

  async unlike(_account: AccountContext, _postId: string): Promise<void> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI: unlike not supported');
  }

  async comment(account: AccountContext, postId: string, text: string): Promise<PlatformPostResult> {
    return this.createPost(account, { text, replyToId: postId });
  }

  async repost(account: AccountContext, postId: string): Promise<void> {
    const authToken = this.getAuthToken(account);
    this.logger.info({ postId }, 'GetXAPI: Retweeting');
    await this.gxFetch('/twitter/tweet/retweet', {
      method: 'POST',
      body: JSON.stringify({ auth_token: authToken, tweet_id: postId }),
    });
  }

  async unrepost(_account: AccountContext, _postId: string): Promise<void> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI: unrepost not supported');
  }

  async bookmark(_account: AccountContext, _postId: string): Promise<void> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI: bookmark not supported');
  }

  // ── Media ──────────────────────────────────────────────────────────
  // Media is handled inline with createPost (base64 or media_urls)

  async uploadMedia(_account: AccountContext, _media: MediaPayload): Promise<PlatformMediaResult> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI handles media inline with tweet creation');
  }

  // ── Analytics (not supported) ──────────────────────────────────────

  async getPostMetrics(_account: AccountContext, _platformPostId: string): Promise<PostMetrics> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI does not support analytics');
  }

  // ── Auth ───────────────────────────────────────────────────────────
  // GetXAPI uses username/password login, not OAuth

  getAuthUrl(_state: string, _redirectUri: string, _scopes?: string[]): string {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI uses username/password login, not OAuth');
  }

  async handleCallback(_code: string, _redirectUri: string): Promise<TokenSet> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI uses username/password login, not OAuth');
  }

  async refreshToken(_refreshToken: string): Promise<TokenSet> {
    throw new AppError('PLATFORM_REJECTED', 'GetXAPI tokens do not use refresh flow');
  }

  // ── Health ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${GETXAPI_BASE}/twitter/tweet/advanced_search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'test', count: 1 }),
      });
      return {
        status: res.ok || res.status === 400 ? 'up' : 'degraded',
        circuitState: 'closed',
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        status: 'down',
        circuitState: 'closed',
        latencyMs: Date.now() - start,
      };
    }
  }

  // ── Private Helpers ────────────────────────────────────────────────

  private getAuthToken(account: AccountContext): string {
    // The GetXAPI auth_token is stored in account.metadata.getxapi_auth_token
    const authToken = (account.metadata?.['getxapi_auth_token'] as string) ?? account.accessToken;
    if (!authToken) {
      throw new AppError('AUTH_ACCOUNT_EXPIRED', 'No GetXAPI auth_token found. Login required.');
    }
    return authToken;
  }

  private async gxFetch(path: string, init: RequestInit): Promise<GetXApiResponse> {
    this.logger.debug({ method: init.method, path }, 'GetXAPI: Request');

    const res = await fetch(`${GETXAPI_BASE}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> ?? {}),
      },
    });

    if (res.status === 429) {
      this.logger.warn({ path }, 'GetXAPI: Rate limited');
      throw new AppError('PLATFORM_RATE_LIMITED', 'GetXAPI rate limit exceeded', {
        retryAfterMs: 60_000,
        details: { platform: 'x', provider: 'getxapi' },
      });
    }

    if (res.status >= 500) {
      this.logger.error({ path, status: res.status }, 'GetXAPI: Server error');
      throw new AppError('PLATFORM_UNAVAILABLE', `GetXAPI returned ${res.status}`);
    }

    const data = await res.json() as GetXApiResponse;

    if (data.status !== 'success' && !res.ok) {
      this.logger.error({ path, status: res.status, response: data }, 'GetXAPI: Request failed');
      throw new AppError('PLATFORM_REJECTED', `GetXAPI error: ${data.msg ?? data.error ?? JSON.stringify(data)}`, {
        details: { status: res.status, response: data },
      });
    }

    return data;
  }
}
