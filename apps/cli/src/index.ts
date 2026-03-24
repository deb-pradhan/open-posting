#!/usr/bin/env node
// ============================================================================
// Open Posting — CLI
// ============================================================================

import { Command } from 'commander';
import { apiCall, isJsonOutput } from './api-client.js';

const program = new Command();

program
  .name('op')
  .description('Open Posting — AI-agent-native social media access layer')
  .version('1.0.0');

// ── Setup ─────────────────────────────────────────────────────────

program
  .command('init')
  .description('Create a new workspace and get an API key')
  .option('--name <name>', 'Workspace name', 'Default Workspace')
  .action(async (opts) => {
    const result = await apiCall<{ workspaceId: string; apiKey: string; message: string }>(
      'POST', '/setup', { name: opts.name },
    );

    if (isJsonOutput()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n✅ Workspace created!\n');
      console.log(`  Workspace ID: ${result.workspaceId}`);
      console.log(`  API Key:      ${result.apiKey}`);
      console.log(`\n⚠️  Save this API key — it cannot be retrieved again.`);
      console.log(`\nExport it:\n  export OPEN_POSTING_API_KEY=${result.apiKey}\n`);
    }
  });

// ── Accounts ──────────────────────────────────────────────────────

const accounts = program.command('accounts').description('Manage social media accounts');

accounts
  .command('list')
  .description('List connected accounts')
  .option('--platform <platform>', 'Filter by platform (x, linkedin)')
  .action(async (opts) => {
    const params = opts.platform ? `?platform=${opts.platform}` : '';
    const result = await apiCall<unknown[]>('GET', `/accounts${params}`);

    if (isJsonOutput()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if ((result as unknown[]).length === 0) {
        console.log('No accounts connected. Use: op accounts connect <platform>');
        return;
      }
      console.log('\nConnected Accounts:\n');
      for (const acc of result as Array<{ id: string; platform: string; platformUsername: string; status: string; displayName: string }>) {
        const status = acc.status === 'active' ? '🟢' : '🔴';
        console.log(`  ${status} ${acc.platform.padEnd(10)} @${acc.platformUsername} (${acc.displayName}) — ${acc.id}`);
      }
      console.log('');
    }
  });

accounts
  .command('connect <platform>')
  .description('Connect a new account (opens browser for OAuth)')
  .action(async (platform) => {
    const result = await apiCall<{ authUrl: string; state: string }>('POST', `/accounts/connect/${platform}`);

    if (isJsonOutput()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\nOpen this URL in your browser to authorize:\n\n  ${result.authUrl}\n`);
    }
  });

accounts
  .command('disconnect <id>')
  .description('Disconnect an account')
  .action(async (id) => {
    await apiCall('DELETE', `/accounts/${id}`);
    console.log(isJsonOutput() ? '{"deleted":true}' : '✅ Account disconnected');
  });

accounts
  .command('refresh <id>')
  .description('Force token refresh')
  .action(async (id) => {
    const result = await apiCall('POST', `/accounts/${id}/refresh`);
    console.log(isJsonOutput() ? JSON.stringify(result, null, 2) : '✅ Token refreshed');
  });

// ── Posts ──────────────────────────────────────────────────────────

const post = program.command('post').description('Manage posts');

post
  .command('create')
  .description('Create and publish/schedule a post')
  .requiredOption('--text <text>', 'Post content')
  .requiredOption('--accounts <ids...>', 'Target account IDs')
  .option('--media <urls...>', 'Media URLs to attach')
  .option('--alt <texts...>', 'Alt text per media')
  .option('--schedule <datetime>', 'Schedule for later (ISO 8601)')
  .option('--x-text <text>', 'X-specific text override')
  .option('--linkedin-text <text>', 'LinkedIn-specific text override')
  .option('--idempotency-key <key>', 'Prevent duplicate posts')
  .action(async (opts) => {
    const media = opts.media?.map((url: string, i: number) => ({
      url,
      altText: opts.alt?.[i],
    }));

    const platformOverrides: Record<string, unknown> = {};
    if (opts.xText) platformOverrides['x'] = { text: opts.xText };
    if (opts.linkedinText) platformOverrides['linkedin'] = { text: opts.linkedinText };

    const result = await apiCall('POST', '/posts', {
      content: {
        text: opts.text,
        media,
        platformOverrides: Object.keys(platformOverrides).length > 0 ? platformOverrides : undefined,
      },
      targets: opts.accounts.map((id: string) => ({ accountId: id, platform: 'x' })),
      scheduledAt: opts.schedule,
      idempotencyKey: opts.idempotencyKey,
    });

    if (isJsonOutput()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const r = result as { id: string; status: string };
      console.log(`\n✅ Post created: ${r.id} (${r.status})\n`);
    }
  });

post
  .command('list')
  .description('List posts')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    params.set('limit', opts.limit);
    const query = params.toString() ? `?${params}` : '';

    const result = await apiCall<unknown[]>('GET', `/posts${query}`);
    console.log(JSON.stringify(result, null, 2));
  });

post
  .command('get <id>')
  .description('Get post details')
  .action(async (id) => {
    const result = await apiCall('GET', `/posts/${id}`);
    console.log(JSON.stringify(result, null, 2));
  });

post
  .command('delete <id>')
  .description('Delete/cancel a post')
  .action(async (id) => {
    await apiCall('DELETE', `/posts/${id}`);
    console.log(isJsonOutput() ? '{"deleted":true}' : '✅ Post deleted');
  });

post
  .command('retry <id>')
  .description('Retry failed post targets')
  .action(async (id) => {
    const result = await apiCall('POST', `/posts/${id}/retry`);
    console.log(isJsonOutput() ? JSON.stringify(result, null, 2) : '🔄 Post retry enqueued');
  });

// ── Engagement ────────────────────────────────────────────────────

program
  .command('engage')
  .description('Perform engagement action')
  .requiredOption('--account <id>', 'Account ID')
  .requiredOption('--action <action>', 'like|unlike|comment|repost|unrepost|bookmark')
  .requiredOption('--target <postId>', 'Platform post ID')
  .requiredOption('--platform <platform>', 'x|linkedin')
  .option('--content <text>', 'Comment text')
  .action(async (opts) => {
    const result = await apiCall('POST', '/engage', {
      accountId: opts.account,
      action: opts.action,
      targetPostId: opts.target,
      platform: opts.platform,
      content: opts.content,
    });

    if (isJsonOutput()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ ${opts.action} completed`);
    }
  });

// ── Media ─────────────────────────────────────────────────────────

const mediaCmd = program.command('media').description('Manage media');

mediaCmd
  .command('upload')
  .description('Upload media')
  .option('--url <url>', 'Source URL')
  .option('--alt <text>', 'Alt text')
  .option('--type <type>', 'image|video|gif|document')
  .action(async (opts) => {
    if (!opts.url) {
      console.error('Either --url or --file is required');
      process.exit(1);
    }

    const result = await apiCall('POST', '/media/upload', {
      url: opts.url,
      altText: opts.alt,
      type: opts.type,
    });

    console.log(JSON.stringify(result, null, 2));
  });

// ── Analytics ─────────────────────────────────────────────────────

const analytics = program.command('analytics').description('View analytics');

analytics
  .command('post <id>')
  .description('Get post analytics')
  .action(async (id) => {
    const result = await apiCall('GET', `/analytics/posts/${id}`);
    console.log(JSON.stringify(result, null, 2));
  });

// ── Emergency Stop ────────────────────────────────────────────────

program
  .command('emergency-stop')
  .description('Emergency stop — halt all publishing')
  .option('--activate', 'Activate emergency stop')
  .option('--deactivate', 'Deactivate emergency stop')
  .action(async (opts) => {
    if (opts.activate) {
      const result = await apiCall('POST', '/emergency-stop');
      console.log(isJsonOutput() ? JSON.stringify(result, null, 2) : '🛑 Emergency stop ACTIVATED — all publishing halted');
    } else if (opts.deactivate) {
      const result = await apiCall('DELETE', '/emergency-stop');
      console.log(isJsonOutput() ? JSON.stringify(result, null, 2) : '✅ Emergency stop deactivated — publishing resumed');
    } else {
      const result = await apiCall<{ emergencyStop: boolean }>('GET', '/emergency-stop');
      const status = result.emergencyStop ? '🛑 ACTIVE' : '✅ Inactive';
      console.log(isJsonOutput() ? JSON.stringify(result, null, 2) : `Emergency stop: ${status}`);
    }
  });

// ── Health ────────────────────────────────────────────────────────

program
  .command('health')
  .description('Check system health')
  .action(async () => {
    try {
      const url = process.env['OPEN_POSTING_URL'] ?? 'http://localhost:3000';
      const res = await fetch(`${url}/health/ready`);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('❌ Cannot reach Open Posting API');
      process.exit(1);
    }
  });

// ── Validate ──────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate content without posting')
  .requiredOption('--text <text>', 'Content to validate')
  .requiredOption('--platforms <platforms...>', 'Target platforms')
  .action(async (opts) => {
    const issues: string[] = [];
    for (const p of opts.platforms) {
      if (p === 'x' && opts.text.length > 280) {
        issues.push(`X: ${opts.text.length}/280 characters (${opts.text.length - 280} over limit)`);
      }
      if (p === 'linkedin' && opts.text.length > 3000) {
        issues.push(`LinkedIn: ${opts.text.length}/3000 characters (${opts.text.length - 3000} over limit)`);
      }
    }

    const result = {
      valid: issues.length === 0,
      issues,
      length: opts.text.length,
    };

    if (isJsonOutput()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.valid) {
        console.log(`✅ Content valid (${result.length} chars)`);
      } else {
        console.log('❌ Validation errors:');
        issues.forEach(i => console.log(`   • ${i}`));
      }
    }
  });

program.parse();
