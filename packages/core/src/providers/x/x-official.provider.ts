// ============================================================================
// Open Posting — X Official API Provider (v2)
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
import type { Logger } from '../../logger.js';

const X_API_BASE = 'https://api.x.com';
const X_UPLOAD_BASE = 'https://upload.twitter.com';

interface XApiConfig {
  clientId: string;
  clientSecret: string;
  bearerToken: string;
}

export class XOfficialProvider extends PlatformProvider {
  readonly platform: Platform = 'x';
  readonly providerName = 'x-official';
  readonly capabilities: ProviderCapabilities = X_OFFICIAL_CAPABILITIES;

  constructor(
    logger: Logger,
    private readonly config: XApiConfig,
  ) {
    super(logger);
  }

  // ── Posts ──────────────────────────────────────────────────────────

  async createPost(account: AccountContext, content: NormalizedContent): Promise<PlatformPostResult> {
    this.logger.info({ accountId: account.id, textLength: content.text.length, hasMedia: !!content.media?.length, hasReply: !!content.replyToId, hasPoll: !!content.poll }, 'X: Creating post');

    const body: Record<string, unknown> = { text: content.text };

    if (content.replyToId) {
      body['reply'] = { in_reply_to_tweet_id: content.replyToId };
    }

    if (content.media && content.media.length > 0) {
      const mediaIds: string[] = [];
      for (const m of content.media) {
        const result = await this.uploadMedia(account, m);
        mediaIds.push(result.platformMediaId);
      }
      body['media'] = { media_ids: mediaIds };
      this.logger.debug({ mediaIds }, 'X: Media attached to post');
    }

    if (content.poll) {
      body['poll'] = {
        options: content.poll.options.map(o => ({ label: o })),
        duration_minutes: content.poll.durationMinutes,
      };
    }

    const response = await this.xFetch(account, '/2/tweets', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = response.data as { id: string };
    this.logger.info({ accountId: account.id, platformPostId: data.id }, 'X: Post created successfully');

    return {
      platformPostId: data.id,
      platformPostUrl: `https://x.com/${account.platformUserId}/status/${data.id}`,
    };
  }

  async deletePost(account: AccountContext, platformPostId: string): Promise<void> {
    this.logger.info({ accountId: account.id, platformPostId }, 'X: Deleting post');
    await this.xFetch(account, `/2/tweets/${platformPostId}`, {
      method: 'DELETE',
    });
    this.logger.info({ platformPostId }, 'X: Post deleted');
  }

  // ── Threads ────────────────────────────────────────────────────────

  async createThread(
    account: AccountContext,
    items: Array<{ text: string; media?: MediaPayload[] }>,
  ): Promise<PlatformThreadResult> {
    this.logger.info({ accountId: account.id, threadLength: items.length }, 'X: Creating thread');
    const results: PlatformPostResult[] = [];
    let replyToId: string | undefined;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      const content: NormalizedContent = {
        text: item.text,
        media: item.media,
        replyToId,
      };

      this.logger.debug({ threadIndex: idx, replyToId }, 'X: Creating thread item');
      const result = await this.createPost(account, content);
      results.push(result);
      replyToId = result.platformPostId;
    }

    this.logger.info({ threadId: results[0]!.platformPostId, postCount: results.length }, 'X: Thread created');
    return {
      threadId: results[0]!.platformPostId,
      posts: results,
    };
  }

  // ── Engagement ─────────────────────────────────────────────────────

  async like(account: AccountContext, postId: string): Promise<void> {
    await this.xFetch(account, `/2/users/${account.platformUserId}/likes`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: postId }),
    });
  }

  async unlike(account: AccountContext, postId: string): Promise<void> {
    await this.xFetch(account, `/2/users/${account.platformUserId}/likes/${postId}`, {
      method: 'DELETE',
    });
  }

  async comment(account: AccountContext, postId: string, text: string): Promise<PlatformPostResult> {
    return this.createPost(account, { text, replyToId: postId });
  }

  async repost(account: AccountContext, postId: string): Promise<void> {
    await this.xFetch(account, `/2/users/${account.platformUserId}/retweets`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: postId }),
    });
  }

  async unrepost(account: AccountContext, postId: string): Promise<void> {
    await this.xFetch(account, `/2/users/${account.platformUserId}/retweets/${postId}`, {
      method: 'DELETE',
    });
  }

  async bookmark(account: AccountContext, postId: string): Promise<void> {
    await this.xFetch(account, `/2/users/${account.platformUserId}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: postId }),
    });
  }

  // ── Media ──────────────────────────────────────────────────────────

  async uploadMedia(account: AccountContext, media: MediaPayload): Promise<PlatformMediaResult> {
    this.logger.info({ accountId: account.id, mimeType: media.mimeType, sizeBytes: media.sizeBytes, type: media.type }, 'X: Starting media upload');

    // Step 1: INIT
    const initBody = new URLSearchParams({
      command: 'INIT',
      total_bytes: media.sizeBytes.toString(),
      media_type: media.mimeType,
      media_category: this.getMediaCategory(media.type),
    });

    const initRes = await this.xUploadFetch(account, initBody);
    const mediaId = (initRes as { media_id_string: string }).media_id_string;
    this.logger.debug({ mediaId }, 'X: Media INIT complete');

    // Step 2: APPEND (chunked)
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
    const chunks = Math.ceil(media.buffer.length / CHUNK_SIZE);

    for (let i = 0; i < chunks; i++) {
      const chunk = media.buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const formData = new FormData();
      formData.append('command', 'APPEND');
      formData.append('media_id', mediaId);
      formData.append('segment_index', i.toString());
      formData.append('media_data', new Blob([new Uint8Array(chunk)]));

      this.logger.debug({ mediaId, chunk: i + 1, totalChunks: chunks, chunkSize: chunk.length }, 'X: Uploading media chunk');
      await fetch(`${X_UPLOAD_BASE}/1.1/media/upload.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${account.accessToken}`,
        },
        body: formData,
      });
    }
    this.logger.debug({ mediaId, chunks }, 'X: All chunks uploaded');

    // Step 3: FINALIZE
    const finalizeBody = new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    });
    const finalizeRes = await this.xUploadFetch(account, finalizeBody);
    const processingInfo = (finalizeRes as { processing_info?: { state: string; check_after_secs?: number } }).processing_info;
    this.logger.debug({ mediaId, needsProcessing: !!processingInfo }, 'X: Media FINALIZE complete');

    // Step 4: STATUS polling (for video/gif)
    if (processingInfo) {
      this.logger.info({ mediaId }, 'X: Waiting for media processing');
      await this.waitForProcessing(account, mediaId);
    }

    // Step 5: Alt text
    if (media.altText) {
      this.logger.debug({ mediaId, altTextLength: media.altText.length }, 'X: Setting alt text');
      await this.xFetch(account, '/1.1/media/metadata/create.json', {
        method: 'POST',
        body: JSON.stringify({
          media_id: mediaId,
          alt_text: { text: media.altText },
        }),
      }, X_API_BASE);
    }

    this.logger.info({ mediaId, mimeType: media.mimeType }, 'X: Media upload complete');
    return { platformMediaId: mediaId };
  }

  // ── Analytics ──────────────────────────────────────────────────────

  async getPostMetrics(account: AccountContext, platformPostId: string): Promise<PostMetrics> {
    this.logger.debug({ platformPostId }, 'X: Fetching post metrics');
    const res = await this.xFetch(
      account,
      `/2/tweets/${platformPostId}?tweet.fields=public_metrics,non_public_metrics,organic_metrics`,
      { method: 'GET' },
    );

    const tweet = (res.data as { public_metrics?: Record<string, number>; non_public_metrics?: Record<string, number> });
    const pub = tweet.public_metrics ?? {};
    const nonPub = tweet.non_public_metrics ?? {};

    this.logger.debug({ platformPostId, likes: pub['like_count'], impressions: nonPub['impression_count'] ?? pub['impression_count'] }, 'X: Metrics fetched');

    return {
      likes: pub['like_count'] ?? 0,
      comments: pub['reply_count'] ?? 0,
      reposts: pub['retweet_count'] ?? 0,
      impressions: nonPub['impression_count'] ?? pub['impression_count'] ?? 0,
      clicks: nonPub['url_link_clicks'] ?? 0,
      reach: 0,
      engagement_rate: 0,
      platformSpecific: { public_metrics: pub, non_public_metrics: nonPub },
    };
  }

  // ── Auth ───────────────────────────────────────────────────────────

  getAuthUrl(state: string, redirectUri: string, scopes?: string[]): string {
    const defaultScopes = ['tweet.read', 'tweet.write', 'users.read', 'like.read', 'like.write', 'bookmark.write', 'offline.access'];
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: (scopes ?? defaultScopes).join(' '),
      state,
      code_challenge: state, // simplified — in production, use proper PKCE
      code_challenge_method: 'plain',
    });
    return `https://twitter.com/i/oauth2/authorize?${params}`;
  }

  async handleCallback(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenSet> {
    this.logger.info('X: Processing OAuth callback');
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier ?? '',
      client_id: this.config.clientId,
    });

    const res = await fetch(`${X_API_BASE}/2/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error({ status: res.status }, 'X: OAuth token exchange failed');
      throw new AppError('PLATFORM_AUTH_FAILED', `X OAuth token exchange failed: ${err}`);
    }

    this.logger.info('X: OAuth token exchange successful');
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scope: data.scope,
      tokenType: data.token_type,
    };
  }

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    this.logger.info('X: Refreshing OAuth token');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    const res = await fetch(`${X_API_BASE}/2/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      this.logger.error({ status: res.status }, 'X: Token refresh failed');
      throw new AppError('PLATFORM_AUTH_FAILED', 'X token refresh failed');
    }

    this.logger.info('X: Token refreshed successfully');

    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scope: data.scope,
      tokenType: data.token_type,
    };
  }

  // ── Health ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${X_API_BASE}/2/tweets/search/recent?query=test&max_results=10`, {
        headers: { 'Authorization': `Bearer ${this.config.bearerToken}` },
      });
      return {
        status: res.ok ? 'up' : 'degraded',
        circuitState: 'closed',
        latencyMs: Date.now() - start,
        rateLimitRemaining: parseInt(res.headers.get('x-rate-limit-remaining') ?? '0', 10),
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

  private async xFetch(
    account: AccountContext,
    path: string,
    init: RequestInit,
    base: string = X_API_BASE,
  ): Promise<{ data: unknown }> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    };

    this.logger.debug({ method: init.method, path }, 'X API: Request');
    const res = await fetch(`${base}${path}`, { ...init, headers });

    if (res.status === 429) {
      const retryAfter = res.headers.get('x-rate-limit-reset');
      const retryAfterMs = retryAfter ? (parseInt(retryAfter, 10) * 1000 - Date.now()) : 60_000;
      this.logger.warn({ path, retryAfterMs, remaining: res.headers.get('x-rate-limit-remaining') }, 'X API: Rate limited');
      throw new AppError('PLATFORM_RATE_LIMITED', 'X API rate limit exceeded', {
        retryAfterMs,
        details: { platform: 'x', provider: 'official' },
      });
    }

    if (res.status >= 500) {
      this.logger.error({ path, status: res.status }, 'X API: Server error');
      throw new AppError('PLATFORM_UNAVAILABLE', `X API returned ${res.status}`);
    }

    if (!res.ok) {
      const err = await res.text();
      this.logger.error({ path, status: res.status, response: err }, 'X API: Request rejected');
      throw new AppError('PLATFORM_REJECTED', `X API error: ${err}`, {
        details: { status: res.status, response: err },
      });
    }

    return (await res.json()) as { data: unknown };
  }

  private async xUploadFetch(account: AccountContext, body: URLSearchParams): Promise<unknown> {
    const res = await fetch(`${X_UPLOAD_BASE}/1.1/media/upload.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', `X media upload failed: ${err}`);
    }

    return res.json();
  }

  private async waitForProcessing(account: AccountContext, mediaId: string, maxWaitMs: number = 120_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const params = new URLSearchParams({ command: 'STATUS', media_id: mediaId });
      const res = await fetch(`${X_UPLOAD_BASE}/1.1/media/upload.json?${params}`, {
        headers: { 'Authorization': `Bearer ${account.accessToken}` },
      });

      const data = await res.json() as { processing_info?: { state: string; check_after_secs?: number; error?: unknown } };
      const info = data.processing_info;

      if (!info || info.state === 'succeeded') {
        this.logger.debug({ mediaId, state: info?.state ?? 'done' }, 'X: Media processing complete');
        return;
      }
      if (info.state === 'failed') {
        this.logger.error({ mediaId, error: info.error }, 'X: Media processing failed');
        throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', `X media processing failed: ${JSON.stringify(info.error)}`);
      }

      const waitSecs = info.check_after_secs ?? 5;
      this.logger.debug({ mediaId, state: info.state, waitSecs }, 'X: Media still processing, waiting');
      await new Promise(resolve => setTimeout(resolve, waitSecs * 1000));
    }

    this.logger.error({ mediaId, maxWaitMs }, 'X: Media processing timed out');
    throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', 'X media processing timed out');
  }

  private getMediaCategory(type: string): string {
    switch (type) {
      case 'video': return 'tweet_video';
      case 'gif': return 'tweet_gif';
      default: return 'tweet_image';
    }
  }
}
