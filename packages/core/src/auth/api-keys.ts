// ============================================================================
// Open Posting — API Key Management
// ============================================================================

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { API_KEY_PREFIX, API_KEY_PREFIX_LENGTH } from '@open-posting/shared';

const BCRYPT_ROUNDS = 12;

/**
 * Generate a new API key: op_<32 random hex chars>
 */
export function generateApiKey(): string {
  const random = randomBytes(32).toString('hex');
  return `${API_KEY_PREFIX}${random}`;
}

/**
 * Extract the prefix used for fast lookup (first 8 chars after 'op_')
 */
export function extractKeyPrefix(apiKey: string): string {
  const stripped = apiKey.startsWith(API_KEY_PREFIX)
    ? apiKey.slice(API_KEY_PREFIX.length)
    : apiKey;
  return stripped.slice(0, API_KEY_PREFIX_LENGTH);
}

/**
 * Hash an API key for storage
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, BCRYPT_ROUNDS);
}

/**
 * Verify an API key against its hash
 */
export async function verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
  return bcrypt.compare(apiKey, hash);
}
