// ============================================================================
// Open Posting — Platform Constants & Limits
// ============================================================================

import type { ProviderCapabilities, MediaType } from './types.js';

// === Platform Capabilities ===

export const X_OFFICIAL_CAPABILITIES: ProviderCapabilities = {
  maxTextLength: 280,
  maxMediaPerPost: 4,
  supportedMediaTypes: ['image', 'video', 'gif'] as MediaType[],
  maxMediaSizeBytes: {
    image: 5 * 1024 * 1024,       // 5 MB
    video: 512 * 1024 * 1024,     // 512 MB
    gif: 15 * 1024 * 1024,        // 15 MB
    document: 0,                   // Not supported
  },
  supportsThreads: true,
  supportsPolls: true,
  supportsScheduling: false,
  supportsEdit: false,
  supportsAltText: true,
  supportsHashtags: true,
  supportsMentions: true,
};

export const X_GETXAPI_CAPABILITIES: ProviderCapabilities = {
  maxTextLength: 280,
  maxMediaPerPost: 4,
  supportedMediaTypes: ['image', 'video', 'gif'] as MediaType[],
  maxMediaSizeBytes: {
    image: 5 * 1024 * 1024,
    video: 512 * 1024 * 1024,
    gif: 15 * 1024 * 1024,
    document: 0,
  },
  supportsThreads: true,
  supportsPolls: false,
  supportsScheduling: false,
  supportsEdit: false,
  supportsAltText: false,
  supportsHashtags: true,
  supportsMentions: true,
};

export const LINKEDIN_CAPABILITIES: ProviderCapabilities = {
  maxTextLength: 3000,
  maxMediaPerPost: 9,
  supportedMediaTypes: ['image', 'video', 'document'] as MediaType[],
  maxMediaSizeBytes: {
    image: 10 * 1024 * 1024,      // 10 MB
    video: 200 * 1024 * 1024,     // 200 MB
    gif: 10 * 1024 * 1024,        // Treated as image
    document: 100 * 1024 * 1024,  // 100 MB PDF
  },
  supportsThreads: false,
  supportsPolls: true,
  supportsScheduling: false,
  supportsEdit: true,
  supportsAltText: true,
  supportsHashtags: true,
  supportsMentions: true,
};

// === Rate Limits ===

export const RATE_LIMITS = {
  api: {
    perKey: 100,            // requests per minute per API key
    perIp: 20,              // requests per minute per IP (unauthenticated)
    authEndpoints: 10,      // requests per minute per IP for auth endpoints
    windowMs: 60_000,       // 1 minute sliding window
  },
  x: {
    official: {
      tweetsPerWindow: 300,  // per 15-min window
      likesPerWindow: 500,
      retweetsPerWindow: 300,
      windowMs: 15 * 60 * 1000,
    },
    getxapi: {
      // No hard limits, cost-per-call
      readCost: 0.001,      // $0.001 per read
      writeCost: 0.002,     // $0.002 per write
    },
  },
  linkedin: {
    memberPostsPerDay: 150,
    appRequestsPerDay: 100_000,
  },
} as const;

// === Circuit Breaker ===

export const CIRCUIT_BREAKER = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 2,
  monitorWindowMs: 120_000,
} as const;

// === Scheduler ===

export const SCHEDULER = {
  maxConcurrency: 10,
  maxRetries: 3,
  backoffType: 'exponential' as const,
  maxBackoffMs: 300_000,
  dlqRetentionDays: 30,
  tokenRefreshCron: '*/15 * * * *',
  healthCheckCron: '*/5 * * * *',
  analyticsCollectionCron: '0 * * * *',
  mediaCleanupCron: '0 3 * * *',   // 3 AM daily
} as const;

// === Media ===

export const MEDIA = {
  maxFileSizeMb: 512,
  supportedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  supportedVideoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
  supportedDocTypes: ['application/pdf'],
  thumbnailSizes: [150, 300, 600],
  chunkSizeBytes: 5 * 1024 * 1024,  // 5 MB chunks for upload
  orphanCleanupHours: 24,
  originalRetentionDays: 90,
} as const;

// === Misc ===

export const PLATFORMS = ['x', 'linkedin'] as const;

export const API_KEY_PREFIX = 'op_';
export const API_KEY_PREFIX_LENGTH = 8;
export const ULID_LENGTH = 26;
