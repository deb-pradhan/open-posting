// ============================================================================
// Open Posting — Configuration
// ============================================================================

import type { AppConfig, LogLevel } from '@open-posting/shared';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envOptional(key: string): string | undefined {
  return process.env[key];
}

function envInt(key: string, fallback: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: envInt('PORT', 3000),
    logLevel: (envOptional('LOG_LEVEL') ?? 'info') as LogLevel,
    databaseUrl: env('DATABASE_URL'),
    redisUrl: env('REDIS_URL'),
    encryptionKey: env('ENCRYPTION_KEY'),
    publicUrl: env('PUBLIC_URL', 'http://localhost:3000'),
    mediaStoragePath: env('MEDIA_STORAGE_PATH', '/data/media'),
    mediaMaxStorageGb: envInt('MEDIA_MAX_STORAGE_GB', 10),
    mediaServeBaseUrl: envOptional('MEDIA_SERVE_BASE_URL') ?? '',
    apiRateLimit: envInt('API_RATE_LIMIT', 100),

    x: {
      clientId: env('X_CLIENT_ID', ''),
      clientSecret: env('X_CLIENT_SECRET', ''),
      bearerToken: env('X_BEARER_TOKEN', ''),
      getxapiKey: env('X_GETXAPI_KEY', ''),
    },

    linkedin: {
      clientId: env('LINKEDIN_CLIENT_ID', ''),
      clientSecret: env('LINKEDIN_CLIENT_SECRET', ''),
    },

    otelEndpoint: envOptional('OTEL_EXPORTER_OTLP_ENDPOINT'),
    webhookUrl: envOptional('WEBHOOK_URL'),
  };
}
