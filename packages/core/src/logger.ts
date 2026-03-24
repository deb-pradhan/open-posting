// ============================================================================
// Open Posting — Structured Logger (pino)
// ============================================================================

import pino from 'pino';
import type { LogLevel } from '@open-posting/shared';

export function createLogger(level: LogLevel = 'info', service: string = 'api') {
  return pino({
    level,
    name: service,
    redact: {
      paths: [
        'accessToken',
        'refreshToken',
        'accessTokenEnc',
        'refreshTokenEnc',
        'apiKey',
        'apiKeyHash',
        'encryptionKey',
        'password',
        'secret',
        'authorization',
        'req.headers.authorization',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
