// ============================================================================
// Open Posting — LinkedIn API Provider
// ============================================================================

import {
  LINKEDIN_CAPABILITIES,
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

const LI_API_BASE = 'https://api.linkedin.com';
const LI_VERSION = '202602';

interface LinkedInConfig {
  clientId: string;
  clientSecret: string;
}

export class LinkedInProvider extends PlatformProvider {
  readonly platform: Platform = 'linkedin';
  readonly providerName = 'linkedin';
  readonly capabilities: ProviderCapabilities = LINKEDIN_CAPABILITIES;

  constructor(
    logger: Logger,
    private readonly config: LinkedInConfig,
  ) {
    super(logger);
  }

  // ── Posts ──────────────────────────────────────────────────────────

  async createPost(account: AccountContext, content: NormalizedContent): Promise<PlatformPostResult> {
    this.logger.info({ accountId: account.id, textLength: content.text.length, hasMedia: !!content.media?.length, hasArticle: !!content.articleUrl, hasPoll: !!content.poll }, 'LinkedIn: Creating post');
    const authorUrn = `urn:li:person:${account.platformUserId}`;

    const body: Record<string, unknown> = {
      author: authorUrn,
      commentary: content.text,
      visibility: content.visibility ?? 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
    };

    // Media attachments
    if (content.media && content.media.length > 0) {
      const mediaAssets: string[] = [];
      for (const m of content.media) {
        const result = await this.uploadMedia(account, m);
        mediaAssets.push(result.platformMediaId);
      }

      if (content.media.length === 1 && content.media[0]!.type === 'video') {
        // Single video
        body['content'] = {
          media: { id: mediaAssets[0] },
        };
      } else if (content.media.length === 1) {
        // Single image — use media content type (not multiImage which requires 2+)
        body['content'] = {
          media: {
            id: mediaAssets[0],
            altText: content.media[0]?.altText ?? '',
          },
        };
      } else {
        // Multiple images (2-20)
        body['content'] = {
          multiImage: {
            images: mediaAssets.map((assetUrn, i) => ({
              id: assetUrn,
              altText: content.media![i]?.altText ?? '',
            })),
          },
        };
      }
    }

    // Article attachment
    if (content.articleUrl) {
      body['content'] = {
        article: {
          source: content.articleUrl,
          title: content.articleTitle ?? '',
          description: content.articleDescription ?? '',
        },
      };
    }

    // Poll
    if (content.poll) {
      body['content'] = {
        poll: {
          question: content.poll.question,
          options: content.poll.options.map(o => ({ text: o })),
          settings: { duration: 'THREE_DAYS' },
        },
      };
    }

    const res = await this.liFetch(account, '/rest/posts', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // LinkedIn returns the post URN in the x-restli-id header
    const postUrn = res.headers?.['x-restli-id'] ?? '';

    this.logger.info({ accountId: account.id, postUrn }, 'LinkedIn: Post created successfully');
    return {
      platformPostId: postUrn,
      platformPostUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
      metadata: { urn: postUrn },
    };
  }

  async deletePost(account: AccountContext, platformPostId: string): Promise<void> {
    this.logger.info({ accountId: account.id, platformPostId }, 'LinkedIn: Deleting post');
    const encodedUrn = encodeURIComponent(platformPostId);
    await this.liFetch(account, `/rest/posts/${encodedUrn}`, {
      method: 'DELETE',
    });
    this.logger.info({ platformPostId }, 'LinkedIn: Post deleted');
  }

  // ── Threads (not natively supported) ───────────────────────────────

  async createThread(
    account: AccountContext,
    items: Array<{ text: string; media?: MediaPayload[] }>,
  ): Promise<PlatformThreadResult> {
    // LinkedIn doesn't support native threads — post individually
    const results: PlatformPostResult[] = [];
    for (const item of items) {
      const result = await this.createPost(account, { text: item.text, media: item.media });
      results.push(result);
    }
    return {
      threadId: results[0]!.platformPostId,
      posts: results,
    };
  }

  // ── Engagement ─────────────────────────────────────────────────────

  async like(account: AccountContext, postId: string): Promise<void> {
    const actorUrn = `urn:li:person:${account.platformUserId}`;
    const encodedUrn = encodeURIComponent(postId);
    await this.liFetch(account, `/rest/socialActions/${encodedUrn}/likes`, {
      method: 'POST',
      body: JSON.stringify({
        actor: actorUrn,
        object: postId,
      }),
    });
  }

  async unlike(account: AccountContext, postId: string): Promise<void> {
    const actorUrn = `urn:li:person:${account.platformUserId}`;
    const encodedUrn = encodeURIComponent(postId);
    await this.liFetch(account, `/rest/socialActions/${encodedUrn}/likes/${encodeURIComponent(actorUrn)}`, {
      method: 'DELETE',
    });
  }

  async comment(account: AccountContext, postId: string, text: string): Promise<PlatformPostResult> {
    const actorUrn = `urn:li:person:${account.platformUserId}`;
    const encodedUrn = encodeURIComponent(postId);
    const res = await this.liFetch(account, `/rest/socialActions/${encodedUrn}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        actor: actorUrn,
        message: { text },
        object: postId,
      }),
    });

    return {
      platformPostId: res.headers?.['x-restli-id'] ?? '',
      platformPostUrl: `https://www.linkedin.com/feed/update/${postId}`,
    };
  }

  async repost(account: AccountContext, postId: string): Promise<void> {
    const authorUrn = `urn:li:person:${account.platformUserId}`;
    await this.liFetch(account, '/rest/posts', {
      method: 'POST',
      body: JSON.stringify({
        author: authorUrn,
        commentary: '',
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        reshareContext: {
          parent: postId,
        },
      }),
    });
  }

  async unrepost(_account: AccountContext, _postId: string): Promise<void> {
    // LinkedIn doesn't support unrepost directly — would need to delete the reshare post
    throw new AppError('PLATFORM_REJECTED', 'LinkedIn does not support unrepost');
  }

  async bookmark(_account: AccountContext, _postId: string): Promise<void> {
    throw new AppError('PLATFORM_REJECTED', 'LinkedIn does not support bookmarks via API');
  }

  // ── Media ──────────────────────────────────────────────────────────

  async uploadMedia(account: AccountContext, media: MediaPayload): Promise<PlatformMediaResult> {
    this.logger.info({ accountId: account.id, mimeType: media.mimeType, sizeBytes: media.sizeBytes, type: media.type }, 'LinkedIn: Starting media upload');
    const ownerUrn = `urn:li:person:${account.platformUserId}`;

    // Use the newer /rest/images API (versioned) for images
    // For video, use /rest/videos
    if (media.type === 'video') {
      return this.uploadVideo(account, media, ownerUrn);
    }

    // Step 1: Initialize image upload
    const initRes = await this.liFetch(account, '/rest/images?action=initializeUpload', {
      method: 'POST',
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: ownerUrn,
        },
      }),
    });

    const initData = initRes.body as {
      value: {
        uploadUrl: string;
        image: string; // urn:li:image:xxx
      };
    };

    const uploadUrl = initData.value.uploadUrl;
    const imageUrn = initData.value.image;

    if (!uploadUrl) {
      this.logger.error({ imageUrn }, 'LinkedIn: No upload URL returned from image init');
      throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', 'LinkedIn did not return upload URL');
    }

    this.logger.debug({ imageUrn, uploadUrl: uploadUrl.substring(0, 80) }, 'LinkedIn: Image upload initialized, uploading binary');

    // Step 2: Upload binary
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': media.mimeType,
      },
      body: media.buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      this.logger.error({ imageUrn, status: uploadRes.status, error: errText }, 'LinkedIn: Image binary upload failed');
      throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', `LinkedIn image upload failed: ${uploadRes.status}`);
    }

    this.logger.info({ imageUrn, mimeType: media.mimeType }, 'LinkedIn: Image upload complete');
    return {
      platformMediaId: imageUrn,
      metadata: { uploadUrl, imageUrn },
    };
  }

  private async uploadVideo(account: AccountContext, media: MediaPayload, ownerUrn: string): Promise<PlatformMediaResult> {
    // Step 1: Initialize video upload
    const initRes = await this.liFetch(account, '/rest/videos?action=initializeUpload', {
      method: 'POST',
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: ownerUrn,
          fileSizeBytes: media.sizeBytes ?? media.buffer.length,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    });

    const initData = initRes.body as {
      value: {
        uploadInstructions: Array<{ uploadUrl: string }>;
        video: string; // urn:li:video:xxx
      };
    };

    const uploadUrl = initData.value.uploadInstructions?.[0]?.uploadUrl;
    const videoUrn = initData.value.video;

    if (!uploadUrl) {
      this.logger.error({ videoUrn }, 'LinkedIn: No upload URL returned from video init');
      throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', 'LinkedIn did not return video upload URL');
    }

    // Step 2: Upload binary
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': media.mimeType,
      },
      body: media.buffer,
    });

    if (!uploadRes.ok) {
      this.logger.error({ videoUrn, status: uploadRes.status }, 'LinkedIn: Video binary upload failed');
      throw new AppError('PLATFORM_MEDIA_UPLOAD_FAILED', `LinkedIn video upload failed: ${uploadRes.status}`);
    }

    this.logger.info({ videoUrn, mimeType: media.mimeType }, 'LinkedIn: Video upload complete');
    return {
      platformMediaId: videoUrn,
      metadata: { uploadUrl, videoUrn },
    };
  }

  // ── Analytics ──────────────────────────────────────────────────────

  async getPostMetrics(account: AccountContext, platformPostId: string): Promise<PostMetrics> {
    this.logger.debug({ platformPostId }, 'LinkedIn: Fetching post metrics');
    const encodedUrn = encodeURIComponent(platformPostId);

    const res = await this.liFetch(account, `/rest/socialActions/${encodedUrn}`, {
      method: 'GET',
    });

    const data = res.body as {
      likesSummary?: { totalLikes?: number };
      commentsSummary?: { totalFirstLevelComments?: number };
      shareStatistics?: { shareCount?: number };
    };

    return {
      likes: data.likesSummary?.totalLikes ?? 0,
      comments: data.commentsSummary?.totalFirstLevelComments ?? 0,
      reposts: data.shareStatistics?.shareCount ?? 0,
      impressions: 0, // Requires organization-level stats endpoint
      clicks: 0,
      reach: 0,
      engagement_rate: 0,
      platformSpecific: data,
    };
  }

  // ── Auth ───────────────────────────────────────────────────────────

  getAuthUrl(state: string, redirectUri: string, scopes?: string[]): string {
    const defaultScopes = ['openid', 'profile', 'w_member_social'];
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: (scopes ?? defaultScopes).join(' '),
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<TokenSet> {
    this.logger.info('LinkedIn: Processing OAuth callback');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error({ status: res.status }, 'LinkedIn: OAuth token exchange failed');
      throw new AppError('PLATFORM_AUTH_FAILED', `LinkedIn token exchange failed: ${err}`);
    }

    this.logger.info('LinkedIn: OAuth token exchange successful');
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scope: data.scope,
    };
  }

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    this.logger.info('LinkedIn: Refreshing OAuth token');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      this.logger.error({ status: res.status }, 'LinkedIn: Token refresh failed');
      throw new AppError('PLATFORM_AUTH_FAILED', 'LinkedIn token refresh failed');
    }

    this.logger.info('LinkedIn: Token refreshed successfully');
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scope: data.scope,
    };
  }

  // ── Health ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${LI_API_BASE}/v2/me`, {
        headers: {
          'Authorization': `Bearer test`,
          'LinkedIn-Version': LI_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      // A 401 means the API is up but token is invalid — that's fine for health
      return {
        status: res.status < 500 ? 'up' : 'degraded',
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

  private async liFetch(
    account: AccountContext,
    path: string,
    init: RequestInit,
  ): Promise<{ body: unknown; headers: Record<string, string> }> {
    this.logger.debug({ method: init.method, path }, 'LinkedIn API: Request');
    const res = await fetch(`${LI_API_BASE}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': LI_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        ...(init.headers as Record<string, string> ?? {}),
      },
    });

    if (res.status === 429) {
      this.logger.warn({ path }, 'LinkedIn API: Rate limited');
      throw new AppError('PLATFORM_RATE_LIMITED', 'LinkedIn API rate limit exceeded', {
        retryAfterMs: 60_000,
        details: { platform: 'linkedin' },
      });
    }

    if (res.status >= 500) {
      this.logger.error({ path, status: res.status }, 'LinkedIn API: Server error');
      throw new AppError('PLATFORM_UNAVAILABLE', `LinkedIn API returned ${res.status}`);
    }

    if (!res.ok && res.status !== 201) {
      const err = await res.text();
      this.logger.error({ path, status: res.status, response: err }, 'LinkedIn API: Request rejected');
      throw new AppError('PLATFORM_REJECTED', `LinkedIn API error: ${err}`, {
        details: { status: res.status, response: err },
      });
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => { headers[key] = value; });

    let body: unknown = null;
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      body = await res.json();
    }

    return { body, headers };
  }
}
