// ============================================================================
// Open Posting — MCP Server
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = process.env['API_URL'] ?? process.env['OPEN_POSTING_URL'] ?? 'http://localhost:3000';
const API_KEY = process.env['API_KEY'] ?? process.env['OPEN_POSTING_API_KEY'] ?? '';

// MCP uses stdio so we log to stderr to avoid interfering with the protocol
function log(level: string, msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, msg, ...data };
  console.error(JSON.stringify(entry));
}

// ── API Client ────────────────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  log('debug', 'MCP API call', { method, path });
  const start = Date.now();

  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as { ok: boolean; data?: T; error?: unknown };
  const durationMs = Date.now() - start;

  if (!data.ok) {
    log('error', 'MCP API call failed', { method, path, durationMs, error: data.error });
    throw new Error(`API Error: ${JSON.stringify(data.error)}`);
  }

  log('debug', 'MCP API call succeeded', { method, path, durationMs });
  return data.data as T;
}

// ── MCP Server ────────────────────────────────────────────────────

const server = new McpServer({
  name: 'open-posting',
  version: '1.0.0',
});

// ── Tools ─────────────────────────────────────────────────────────

server.tool(
  'list_accounts',
  'List all connected social media accounts with their status and platform details',
  {
    platform: z.enum(['x', 'linkedin']).optional().describe('Filter by platform'),
    status: z.enum(['active', 'expired', 'revoked']).optional().describe('Filter by status'),
  },
  async ({ platform, status }) => {
    const params = new URLSearchParams();
    if (platform) params.set('platform', platform);
    if (status) params.set('status', status);
    const query = params.toString() ? `?${params}` : '';

    const accounts = await api('GET', `/accounts${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(accounts, null, 2) }] };
  },
);

server.tool(
  'connect_account',
  'Start OAuth flow to connect a new social media account. Returns a URL the user must visit to authorize.',
  {
    platform: z.enum(['x', 'linkedin']).describe('Platform to connect'),
  },
  async ({ platform }) => {
    const result = await api('POST', `/accounts/connect/${platform}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'create_post',
  'Create and publish a post to one or more social media platforms. Supports text, images, videos, articles, and polls. Can be scheduled for future publishing.',
  {
    text: z.string().describe('The post content text. Max 280 chars for X, 3000 chars for LinkedIn.'),
    accounts: z.array(z.string()).describe('Array of social account IDs to post to'),
    media: z.array(z.object({
      url: z.string().describe('URL of image or video to attach'),
      altText: z.string().optional().describe('Alt text for accessibility'),
    })).optional().describe('Media attachments'),
    platformOverrides: z.object({
      x: z.object({ text: z.string().optional() }).optional(),
      linkedin: z.object({
        text: z.string().optional(),
        visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional(),
      }).optional(),
    }).optional().describe('Platform-specific content overrides'),
    scheduledAt: z.string().optional().describe('ISO 8601 datetime for scheduled publishing'),
    idempotencyKey: z.string().optional().describe('Unique key to prevent duplicate posts'),
  },
  async ({ text, accounts, media, platformOverrides, scheduledAt, idempotencyKey }) => {
    const result = await api('POST', '/posts', {
      content: {
        text,
        media: media?.map(m => ({ url: m.url, altText: m.altText })),
        platformOverrides,
      },
      targets: accounts.map(id => ({ accountId: id, platform: 'x' })), // Platform inferred from account
      scheduledAt,
      idempotencyKey,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'create_thread',
  'Create a thread of connected posts on X (Twitter). Each item becomes one tweet in the thread.',
  {
    accountId: z.string().describe('X social account ID'),
    posts: z.array(z.object({
      text: z.string().describe('Tweet text (max 280 chars)'),
      media: z.array(z.object({
        url: z.string(),
        altText: z.string().optional(),
      })).optional(),
    })).describe('Array of thread items in order'),
  },
  async ({ accountId, posts: threadPosts }) => {
    const result = await api('POST', '/threads', { accountId, posts: threadPosts });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_post',
  'Get the status and details of a previously created post, including per-platform publish status and URLs.',
  {
    postId: z.string().describe('The Open Posting post ID'),
  },
  async ({ postId }) => {
    const result = await api('GET', `/posts/${postId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'list_posts',
  'List posts with optional filters for status, platform, and date range.',
  {
    status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional(),
    platform: z.enum(['x', 'linkedin']).optional(),
    limit: z.number().optional().describe('Max results (default 20, max 100)'),
  },
  async ({ status, platform, limit }) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (platform) params.set('platform', platform);
    if (limit) params.set('limit', limit.toString());
    const query = params.toString() ? `?${params}` : '';

    const result = await api('GET', `/posts${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'delete_post',
  'Delete a post. If published, also deletes from the social platforms. If scheduled, cancels the schedule.',
  {
    postId: z.string(),
  },
  async ({ postId }) => {
    const result = await api('DELETE', `/posts/${postId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'engage',
  'Perform an engagement action (like, comment, repost, bookmark) on a social media post.',
  {
    accountId: z.string().describe('Social account ID to act from'),
    action: z.enum(['like', 'unlike', 'comment', 'repost', 'unrepost', 'bookmark']),
    targetPostId: z.string().describe('The platform-native post ID to engage with'),
    platform: z.enum(['x', 'linkedin']),
    content: z.string().optional().describe('Comment text (required for comment action)'),
  },
  async ({ accountId, action, targetPostId, platform, content }) => {
    const result = await api('POST', '/engage', { accountId, action, targetPostId, platform, content });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'upload_media',
  'Upload a media file (image, video, GIF, document) for use in posts. Returns a media ID to reference when creating posts.',
  {
    url: z.string().describe('URL to fetch the media from'),
    altText: z.string().optional().describe('Accessibility alt text'),
    type: z.enum(['image', 'video', 'gif', 'document']).optional(),
  },
  async ({ url, altText, type }) => {
    const result = await api('POST', '/media/upload', { url, altText, type });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_post_analytics',
  'Get engagement metrics (likes, reposts, comments, impressions, clicks) for a published post.',
  {
    postId: z.string(),
  },
  async ({ postId }) => {
    const result = await api('GET', `/analytics/posts/${postId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'validate_content',
  'Validate post content against platform rules without publishing. Returns warnings and errors.',
  {
    text: z.string(),
    platforms: z.array(z.enum(['x', 'linkedin'])),
  },
  async ({ text, platforms }) => {
    const issues: string[] = [];

    for (const platform of platforms) {
      if (platform === 'x' && text.length > 280) {
        issues.push(`X: Text exceeds 280 character limit (${text.length} chars)`);
      }
      if (platform === 'linkedin' && text.length > 3000) {
        issues.push(`LinkedIn: Text exceeds 3000 character limit (${text.length} chars)`);
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          valid: issues.length === 0,
          issues,
          characterCounts: {
            total: text.length,
            x: { used: text.length, max: 280, remaining: 280 - text.length },
            linkedin: { used: text.length, max: 3000, remaining: 3000 - text.length },
          },
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'get_platform_limits',
  'Get current platform limits and rate limit status for an account.',
  {
    accountId: z.string(),
  },
  async ({ accountId }) => {
    const result = await api('GET', `/accounts/${accountId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'emergency_stop',
  'Emergency stop: halt all publishing immediately, or resume publishing.',
  {
    action: z.enum(['activate', 'deactivate', 'status']).describe('Whether to activate, deactivate, or check status of emergency stop'),
  },
  async ({ action }) => {
    let result;
    switch (action) {
      case 'activate':
        result = await api('POST', '/emergency-stop');
        break;
      case 'deactivate':
        result = await api('DELETE', '/emergency-stop');
        break;
      case 'status':
        result = await api('GET', '/emergency-stop');
        break;
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Resources ─────────────────────────────────────────────────────

server.resource(
  'accounts',
  'openposting://accounts',
  async () => {
    const accounts = await api('GET', '/accounts');
    return { contents: [{ uri: 'openposting://accounts', mimeType: 'application/json', text: JSON.stringify(accounts, null, 2) }] };
  },
);

server.resource(
  'recent-posts',
  'openposting://posts/recent',
  async () => {
    const posts = await api('GET', '/posts?limit=20');
    return { contents: [{ uri: 'openposting://posts/recent', mimeType: 'application/json', text: JSON.stringify(posts, null, 2) }] };
  },
);

server.resource(
  'health',
  'openposting://health',
  async () => {
    const health = await api('GET', '/../health/ready');
    return { contents: [{ uri: 'openposting://health', mimeType: 'application/json', text: JSON.stringify(health, null, 2) }] };
  },
);

// ── Start ─────────────────────────────────────────────────────────

async function main() {
  log('info', 'Starting MCP server', { apiUrl: API_URL, hasApiKey: !!API_KEY });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'MCP server connected via stdio');
}

main().catch((err) => {
  log('error', 'MCP server fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
