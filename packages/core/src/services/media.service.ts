// ============================================================================
// Open Posting — Media Service (Local Volume Storage)
// ============================================================================

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@open-posting/db';
import { media } from '@open-posting/db';
import { AppError, type MediaType, MEDIA } from '@open-posting/shared';
import type { Logger } from '../logger.js';

export class MediaService {
  constructor(
    private readonly db: DbClient,
    private readonly storagePath: string,
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Upload media from a buffer (multipart upload or fetched from URL).
   */
  async upload(
    workspaceId: string,
    buffer: Buffer,
    options: {
      filename: string;
      mimeType: string;
      type: MediaType;
      altText?: string;
    },
  ) {
    // Validate MIME type
    const allowedTypes = [
      ...MEDIA.supportedImageTypes,
      ...MEDIA.supportedVideoTypes,
      ...MEDIA.supportedDocTypes,
    ];
    if (!allowedTypes.includes(options.mimeType as typeof allowedTypes[number])) {
      throw new AppError('MEDIA_TYPE_UNSUPPORTED', `Unsupported media type: ${options.mimeType}`);
    }

    // Validate size
    const maxBytes = MEDIA.maxFileSizeMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new AppError('MEDIA_TOO_LARGE', `File exceeds maximum size of ${MEDIA.maxFileSizeMb}MB`);
    }

    // Compute hash for dedup
    const hash = createHash('sha256').update(buffer).digest('hex');

    // Check for existing file with same hash in this workspace
    const [existing] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.workspaceId, workspaceId), eq(media.hash, hash)))
      .limit(1);

    if (existing) {
      this.logger.debug({ mediaId: existing.id, hash }, 'Media deduplicated');
      return existing;
    }

    // Write to local storage
    const relativePath = `${workspaceId}/originals/${hash}/${options.filename}`;
    const absolutePath = join(this.storagePath, relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);

    // Insert record
    const [record] = await this.db.insert(media).values({
      workspaceId,
      type: options.type,
      storageUrl: relativePath,
      mimeType: options.mimeType,
      sizeBytes: buffer.length,
      altText: options.altText ?? null,
      hash,
    }).returning();

    this.logger.info({
      mediaId: record!.id,
      workspaceId,
      type: options.type,
      sizeBytes: buffer.length,
    }, 'Media uploaded');

    return record!;
  }

  /**
   * Upload media from a URL (fetch first, then store).
   */
  async uploadFromUrl(
    workspaceId: string,
    url: string,
    options?: { altText?: string; type?: MediaType },
  ) {
    this.logger.info({ workspaceId, url: url.substring(0, 120) }, 'Fetching media from URL');

    // SSRF protection: block private IPs
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
      this.logger.warn({ hostname }, 'SSRF protection: blocked private URL');
      throw new AppError('VALIDATION_FAILED', 'Cannot fetch from private/local URLs');
    }

    const response = await fetch(url);
    if (!response.ok) {
      this.logger.error({ url: url.substring(0, 120), status: response.status }, 'Failed to fetch media from URL');
      throw new AppError('VALIDATION_FAILED', `Failed to fetch media from URL: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
    const filename = urlObj.pathname.split('/').pop() ?? 'media';
    const type = options?.type ?? this.inferMediaType(mimeType);

    this.logger.debug({ mimeType, sizeBytes: buffer.length, filename }, 'Media fetched from URL, uploading');

    return this.upload(workspaceId, buffer, {
      filename,
      mimeType,
      type,
      altText: options?.altText,
    });
  }

  async getById(mediaId: string, workspaceId: string) {
    const [record] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.workspaceId, workspaceId)))
      .limit(1);

    if (!record) {
      throw new AppError('NOT_FOUND', `Media ${mediaId} not found`);
    }

    return record;
  }

  async getFileBuffer(mediaId: string, workspaceId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const record = await this.getById(mediaId, workspaceId);
    const absolutePath = join(this.storagePath, record.storageUrl);

    try {
      const buffer = await readFile(absolutePath);
      return { buffer, mimeType: record.mimeType };
    } catch {
      throw new AppError('NOT_FOUND', 'Media file not found on disk');
    }
  }

  async delete(mediaId: string, workspaceId: string): Promise<void> {
    const record = await this.getById(mediaId, workspaceId);
    const absolutePath = join(this.storagePath, record.storageUrl);

    // Delete from storage
    try {
      await unlink(absolutePath);
    } catch {
      this.logger.warn({ mediaId, path: absolutePath }, 'Failed to delete media file from disk');
    }

    // Delete record
    await this.db
      .delete(media)
      .where(and(eq(media.id, mediaId), eq(media.workspaceId, workspaceId)));

    this.logger.info({ mediaId, workspaceId }, 'Media deleted');
  }

  /**
   * Get the serving URL for a media item.
   */
  getMediaUrl(mediaId: string): string {
    return `${this.baseUrl}/api/v1/media/${mediaId}/file`;
  }

  /**
   * Check storage health.
   */
  async healthCheck(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
    const start = Date.now();
    try {
      if (!existsSync(this.storagePath)) {
        await mkdir(this.storagePath, { recursive: true });
      }
      return { status: 'up', latencyMs: Date.now() - start };
    } catch {
      return { status: 'down', latencyMs: Date.now() - start };
    }
  }

  private inferMediaType(mimeType: string): MediaType {
    if (mimeType.startsWith('image/gif')) return 'gif';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType === 'application/pdf') return 'document';
    return 'image';
  }
}
