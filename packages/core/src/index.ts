// ============================================================================
// Open Posting — Core Package Entry Point
// ============================================================================

// Config
export { loadConfig } from './config.js';

// Logger
export { createLogger, type Logger } from './logger.js';

// Auth
export { encrypt, decrypt } from './auth/encryption.js';
export { generateApiKey, extractKeyPrefix, hashApiKey, verifyApiKey } from './auth/api-keys.js';

// Services
export { WorkspaceService } from './services/workspace.service.js';
export { AccountService } from './services/account.service.js';
export { PostService } from './services/post.service.js';
export { MediaService } from './services/media.service.js';
export { EngagementService } from './services/engagement.service.js';
export { AnalyticsService } from './services/analytics.service.js';

// Providers
export { PlatformProvider, type AccountContext, type NormalizedContent, type MediaPayload } from './providers/base.provider.js';
export { XOfficialProvider } from './providers/x/x-official.provider.js';
export { XGetXApiProvider } from './providers/x/x-getxapi.provider.js';
export { XRouterProvider } from './providers/x/x-router.provider.js';
export { LinkedInProvider } from './providers/linkedin/linkedin.provider.js';
export { CircuitBreaker } from './providers/circuit-breaker.js';

// Scheduler
export { createQueues, QUEUE_NAMES, type Queues, type PublishJobData } from './scheduler/queue.js';
export { createWorkers } from './scheduler/workers.js';
export { PostPublisher } from './scheduler/publisher.js';

// Re-export shared for convenience
export * from '@open-posting/shared';
