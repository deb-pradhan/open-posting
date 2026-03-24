// ============================================================================
// Open Posting — Core Type System
// ============================================================================

// === Enums ===

export type Platform = 'x' | 'linkedin';
export type ApiProvider = 'official' | 'getxapi';
export type AccountStatus = 'active' | 'expired' | 'revoked' | 'rate_limited';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'partially_failed';
export type PostTargetStatus = 'pending' | 'publishing' | 'published' | 'failed';
export type MediaType = 'image' | 'video' | 'gif' | 'document';
export type EngagementType = 'like' | 'unlike' | 'comment' | 'repost' | 'unrepost' | 'bookmark';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// === Identity & Auth ===

export interface Workspace {
  id: string;
  name: string;
  apiKey: string;
  apiKeyPrefix: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialAccount {
  id: string;
  workspaceId: string;
  platform: Platform;
  platformUserId: string;
  platformUsername: string;
  displayName: string;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  provider: ApiProvider;
  status: AccountStatus;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// === Content ===

export interface Post {
  id: string;
  workspaceId: string;
  status: PostStatus;
  targets: PostTarget[];
  content: PostContent;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  idempotencyKey: string | null;
  retryCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostTarget {
  id: string;
  postId: string;
  socialAccountId: string;
  platform: Platform;
  status: PostTargetStatus;
  platformPostId: string | null;
  platformPostUrl: string | null;
  publishedAt: Date | null;
  error: PostError | null;
  retryCount: number;
  metadata: Record<string, unknown>;
}

export interface PostError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PostContent {
  text: string;
  platformOverrides?: {
    x?: {
      text?: string;
      replyToId?: string;
    };
    linkedin?: {
      text?: string;
      visibility?: 'PUBLIC' | 'CONNECTIONS';
      articleUrl?: string;
      articleTitle?: string;
      articleDescription?: string;
    };
  };
  media?: MediaAttachment[];
  thread?: ThreadItem[];
  poll?: PollContent;
}

export interface MediaAttachment {
  id: string;
  type: MediaType;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  altText?: string;
  platformUploads: Record<string, {
    status: 'pending' | 'uploading' | 'uploaded' | 'failed';
    platformMediaId?: string;
    error?: string;
  }>;
}

export interface ThreadItem {
  text: string;
  media?: MediaAttachment[];
}

export interface PollContent {
  question: string;
  options: string[];
  durationMinutes: number;
}

// === Engagement ===

export interface EngagementAction {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  action: EngagementType;
  targetPostId: string;
  content?: string;
  status: 'pending' | 'completed' | 'failed';
  platformResponseId?: string;
  error?: string;
  createdAt: Date;
}

// === Provider ===

export interface ProviderCapabilities {
  maxTextLength: number;
  maxMediaPerPost: number;
  supportedMediaTypes: MediaType[];
  maxMediaSizeBytes: Record<MediaType, number>;
  supportsThreads: boolean;
  supportsPolls: boolean;
  supportsScheduling: boolean;
  supportsEdit: boolean;
  supportsAltText: boolean;
  supportsHashtags: boolean;
  supportsMentions: boolean;
}

export interface ProviderHealth {
  status: 'up' | 'degraded' | 'down';
  circuitState: 'closed' | 'half-open' | 'open';
  latencyMs: number;
  rateLimitRemaining?: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
}

// === API ===

export interface ApiResponse<T> {
  ok: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
    retryAfterMs?: number;
  };
  meta: ApiMeta;
}

export interface ApiMeta {
  requestId: string;
  rateLimit?: {
    remaining: number;
    limit: number;
    resetAt: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// === API Request Types ===

export interface CreatePostRequest {
  content: {
    text: string;
    platformOverrides?: PostContent['platformOverrides'];
    media?: Array<{
      url?: string;
      uploadId?: string;
      altText?: string;
    }>;
    thread?: Array<{
      text: string;
      media?: Array<{ url?: string; uploadId?: string; altText?: string }>;
    }>;
    poll?: PollContent;
  };
  targets: Array<{
    accountId: string;
    platform: Platform;
  }>;
  scheduledAt?: string;
  idempotencyKey?: string;
}

export interface EngageRequest {
  accountId: string;
  action: EngagementType;
  targetPostId: string;
  platform: Platform;
  content?: string;
}

export interface CreatePostResponse {
  id: string;
  status: PostStatus;
  targets: Array<{
    accountId: string;
    platform: Platform;
    status: PostTargetStatus;
    platformPostId?: string;
    platformPostUrl?: string;
    error?: PostError;
  }>;
  scheduledAt?: string;
  publishedAt?: string;
}

// === Config ===

export interface AppConfig {
  port: number;
  logLevel: LogLevel;
  databaseUrl: string;
  redisUrl: string;
  encryptionKey: string;
  publicUrl: string;
  mediaStoragePath: string;
  mediaMaxStorageGb: number;
  mediaServeBaseUrl: string;
  apiRateLimit: number;

  x: {
    clientId: string;
    clientSecret: string;
    bearerToken: string;
    getxapiKey: string;
  };

  linkedin: {
    clientId: string;
    clientSecret: string;
  };

  otelEndpoint?: string;
  webhookUrl?: string;
}

// === Health ===

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  checks: {
    database: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down'; latencyMs: number };
    storage: { status: 'up' | 'down'; latencyMs: number };
    providers: Record<string, ProviderHealth>;
  };
}

// === Platform-specific results ===

export interface PlatformPostResult {
  platformPostId: string;
  platformPostUrl: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformThreadResult {
  threadId: string;
  posts: PlatformPostResult[];
}

export interface PlatformMediaResult {
  platformMediaId: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface PostMetrics {
  likes: number;
  comments: number;
  reposts: number;
  impressions: number;
  clicks: number;
  reach: number;
  engagement_rate: number;
  platformSpecific: Record<string, unknown>;
}
