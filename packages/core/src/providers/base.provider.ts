// ============================================================================
// Open Posting — Base Platform Provider Interface
// ============================================================================

import type {
  Platform,
  ProviderCapabilities,
  ProviderHealth,
  TokenSet,
  PlatformPostResult,
  PlatformThreadResult,
  PlatformMediaResult,
  PostMetrics,
  PostContent,
  MediaAttachment,
  ThreadItem,
} from '@open-posting/shared';
import type { Logger } from '../logger.js';

export interface AccountContext {
  id: string;
  platform: Platform;
  platformUserId: string;
  accessToken: string;
  refreshToken?: string;
  metadata: Record<string, unknown>;
}

export interface MediaPayload {
  buffer: Buffer;
  mimeType: string;
  type: string;
  sizeBytes: number;
  altText?: string;
}

export interface NormalizedContent {
  text: string;
  media?: MediaPayload[];
  replyToId?: string;
  poll?: {
    question: string;
    options: string[];
    durationMinutes: number;
  };
  visibility?: string;
  articleUrl?: string;
  articleTitle?: string;
  articleDescription?: string;
}

export abstract class PlatformProvider {
  abstract readonly platform: Platform;
  abstract readonly providerName: string;
  abstract readonly capabilities: ProviderCapabilities;

  constructor(protected readonly logger: Logger) {}

  // Posts
  abstract createPost(account: AccountContext, content: NormalizedContent): Promise<PlatformPostResult>;
  abstract deletePost(account: AccountContext, platformPostId: string): Promise<void>;

  // Threads
  abstract createThread(account: AccountContext, items: Array<{ text: string; media?: MediaPayload[] }>): Promise<PlatformThreadResult>;

  // Engagement
  abstract like(account: AccountContext, postId: string): Promise<void>;
  abstract unlike(account: AccountContext, postId: string): Promise<void>;
  abstract comment(account: AccountContext, postId: string, text: string): Promise<PlatformPostResult>;
  abstract repost(account: AccountContext, postId: string): Promise<void>;
  abstract unrepost(account: AccountContext, postId: string): Promise<void>;
  abstract bookmark(account: AccountContext, postId: string): Promise<void>;

  // Media
  abstract uploadMedia(account: AccountContext, media: MediaPayload): Promise<PlatformMediaResult>;

  // Analytics
  abstract getPostMetrics(account: AccountContext, platformPostId: string): Promise<PostMetrics>;

  // Auth
  abstract getAuthUrl(state: string, redirectUri: string, scopes?: string[]): string;
  abstract handleCallback(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenSet>;
  abstract refreshToken(refreshToken: string): Promise<TokenSet>;

  // Health
  abstract healthCheck(): Promise<ProviderHealth>;

  /**
   * Normalize content for this platform — apply platform-specific text overrides
   */
  protected normalizeContent(content: PostContent, platformKey: string): NormalizedContent {
    const overrides = content.platformOverrides?.[platformKey as keyof NonNullable<PostContent['platformOverrides']>];
    return {
      text: (overrides as { text?: string } | undefined)?.text ?? content.text,
      poll: content.poll,
    };
  }
}
