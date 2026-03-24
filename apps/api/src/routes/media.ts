// ============================================================================
// Open Posting — Media Routes
// ============================================================================

import { Hono } from 'hono';
import type { MediaService } from '@open-posting/core';
import { AppError, type MediaType } from '@open-posting/shared';
import type { AuthEnv } from '../middleware/auth.js';

interface MediaDeps {
  mediaService: MediaService;
}

export function mediaRoutes(deps: MediaDeps) {
  const app = new Hono<AuthEnv>();

  // Upload media (multipart or URL)
  app.post('/upload', async (c) => {
    const workspaceId = c.get('workspaceId');
    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      // Multipart file upload
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;
      const altText = formData.get('altText') as string | null;
      const type = (formData.get('type') as MediaType) ?? undefined;

      if (!file) {
        throw new AppError('VALIDATION_FAILED', 'File is required in multipart upload');
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const record = await deps.mediaService.upload(workspaceId, buffer, {
        filename: file.name,
        mimeType: file.type,
        type: type ?? inferType(file.type),
        altText: altText ?? undefined,
      });

      return c.json({
        ok: true,
        data: {
          id: record.id,
          type: record.type,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          url: deps.mediaService.getMediaUrl(record.id),
        },
        meta: { requestId: c.get('requestId') },
      }, 201);
    }

    // JSON body with URL
    const body = await c.req.json<{ url: string; altText?: string; type?: MediaType }>();

    if (!body.url) {
      throw new AppError('VALIDATION_FAILED', 'url is required');
    }

    const record = await deps.mediaService.uploadFromUrl(workspaceId, body.url, {
      altText: body.altText,
      type: body.type,
    });

    return c.json({
      ok: true,
      data: {
        id: record.id,
        type: record.type,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        url: deps.mediaService.getMediaUrl(record.id),
      },
      meta: { requestId: c.get('requestId') },
    }, 201);
  });

  // Get media info
  app.get('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const record = await deps.mediaService.getById(c.req.param('id'), workspaceId);

    return c.json({
      ok: true,
      data: {
        ...record,
        url: deps.mediaService.getMediaUrl(record.id),
      },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Serve media file (public — no auth required for serving)
  app.get('/:id/file', async (c) => {
    // Note: This endpoint is mounted outside auth middleware
    // For now, we serve without workspace check (media ID is ULID, hard to guess)
    // In production, add signed URLs or token-based access
    try {
      const mediaId = c.req.param('id');
      // We need workspace context — for file serving, extract from query or skip
      // This is a simplified version; production would use signed URLs
      const { buffer, mimeType } = await deps.mediaService.getFileBuffer(mediaId, '');
      c.header('Content-Type', mimeType);
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(new Uint8Array(buffer));
    } catch {
      return c.notFound();
    }
  });

  // Delete media
  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    await deps.mediaService.delete(c.req.param('id'), workspaceId);

    return c.json({
      ok: true,
      data: { deleted: true },
      meta: { requestId: c.get('requestId') },
    });
  });

  return app;
}

function inferType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/gif')) return 'gif';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'document';
  return 'image';
}
