// ============================================================================
// Open Posting — AES-256-GCM Token Encryption
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 256-bit key from the encryption key using SHA-256.
 * In production, consider HKDF for key derivation.
 */
function deriveKey(encryptionKey: string): Buffer {
  return createHash('sha256').update(encryptionKey).digest();
}

/**
 * Encrypt a string value using AES-256-GCM.
 * Returns: base64(iv + ciphertext + authTag)
 */
export function encrypt(plaintext: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // iv (12) + encrypted (variable) + authTag (16)
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64');
}

/**
 * Decrypt a value encrypted with encrypt().
 */
export function decrypt(ciphertext: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const combined = Buffer.from(ciphertext, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
