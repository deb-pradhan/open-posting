// ============================================================================
// Open Posting — Account Routes
// ============================================================================

import { Hono } from 'hono';
import type { AccountService, PlatformProvider } from '@open-posting/core';
import { createLogger } from '@open-posting/core';
import type { Platform, LogLevel } from '@open-posting/shared';
import { AppError, PLATFORMS } from '@open-posting/shared';
import type { AuthEnv } from '../middleware/auth.js';
import { randomBytes } from 'node:crypto';

const logger = createLogger((process.env['LOG_LEVEL'] as LogLevel) ?? 'info', 'api:accounts');

interface AccountDeps {
  accountService: AccountService;
  providers: Map<Platform, PlatformProvider>;
  publicUrl: string;
  redis: import('ioredis').Redis;
  xGetXApi?: import('@open-posting/core').XGetXApiProvider;
}

export function accountRoutes(deps: AccountDeps) {
  const app = new Hono<AuthEnv>();

  // List accounts
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const platform = c.req.query('platform') as Platform | undefined;
    const accounts = await deps.accountService.list(workspaceId, platform);

    // Strip encrypted tokens from response
    const safe = accounts.map(({ accessTokenEnc, refreshTokenEnc, ...rest }) => rest);

    return c.json({
      ok: true,
      data: safe,
      meta: { requestId: c.get('requestId') },
    });
  });

  // Get account by ID
  app.get('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const { accessTokenEnc, refreshTokenEnc, ...account } =
      await deps.accountService.getById(c.req.param('id'), workspaceId);

    return c.json({
      ok: true,
      data: account,
      meta: { requestId: c.get('requestId') },
    });
  });

  // Initiate OAuth flow
  app.post('/connect/:platform', async (c) => {
    const platform = c.req.param('platform') as Platform;
    if (!PLATFORMS.includes(platform as any)) {
      throw new AppError('VALIDATION_FAILED', `Unsupported platform: ${platform}`);
    }

    const provider = deps.providers.get(platform);
    if (!provider) {
      throw new AppError('VALIDATION_FAILED', `No provider configured for: ${platform}`);
    }

    // Generate OAuth state — store workspace association in Redis
    const state = randomBytes(32).toString('hex');
    const workspaceId = c.get('workspaceId');

    await deps.redis.set(
      `oauth:state:${state}`,
      JSON.stringify({ workspaceId, platform }),
      'EX',
      600, // 10 min expiry
    );

    const redirectUri = `${deps.publicUrl}/api/v1/accounts/callback/${platform}`;
    const authUrl = provider.getAuthUrl(state, redirectUri);

    logger.info({ workspaceId, platform }, 'OAuth flow initiated');

    return c.json({
      ok: true,
      data: { authUrl, state },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Login via GetXAPI (store session token on existing account)
  app.post('/:id/getxapi-login', async (c) => {
    const workspaceId = c.get('workspaceId');
    const accountId = c.req.param('id');

    if (!deps.xGetXApi) {
      throw new AppError('VALIDATION_FAILED', 'GetXAPI provider not configured (X_GETXAPI_KEY missing)');
    }

    const body = await c.req.json<{
      username: string;
      password: string;
      email?: string;
      totpSecret?: string;
    }>();

    if (!body.username || !body.password) {
      throw new AppError('VALIDATION_FAILED', 'username and password are required');
    }

    // Verify account exists and belongs to this workspace
    const account = await deps.accountService.getById(accountId, workspaceId);
    if (account.platform !== 'x') {
      throw new AppError('VALIDATION_FAILED', 'GetXAPI login is only for X accounts');
    }

    // Login via GetXAPI
    const { authToken, ct0, twid } = await deps.xGetXApi.login(
      body.username,
      body.password,
      body.email,
      body.totpSecret,
    );

    // Store the auth_token in account metadata
    await deps.accountService.updateMetadata(accountId, {
      getxapi_auth_token: authToken,
      getxapi_ct0: ct0,
      getxapi_twid: twid,
    });

    logger.info({ accountId, workspaceId }, 'GetXAPI auth_token stored on account');

    return c.json({
      ok: true,
      data: { accountId, getxapiLinked: true, message: 'GetXAPI session token stored. Fallback posting is now enabled.' },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Disconnect account
  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    await deps.accountService.disconnect(c.req.param('id'), workspaceId);

    return c.json({
      ok: true,
      data: { deleted: true },
      meta: { requestId: c.get('requestId') },
    });
  });

  // Force token refresh
  app.post('/:id/refresh', async (c) => {
    const workspaceId = c.get('workspaceId');
    const account = await deps.accountService.getAccountContext(c.req.param('id'), workspaceId);

    const provider = deps.providers.get(account.platform);
    if (!provider || !account.refreshToken) {
      throw new AppError('VALIDATION_FAILED', 'Cannot refresh token for this account');
    }

    const tokens = await provider.refreshToken(account.refreshToken);
    await deps.accountService.updateTokens(c.req.param('id'), tokens);

    return c.json({
      ok: true,
      data: { refreshed: true, expiresAt: tokens.expiresAt?.toISOString() },
      meta: { requestId: c.get('requestId') },
    });
  });

  return app;
}

// ── Profile Fetchers ────────────────────────────────────────────────────

const LI_VERSION = '202602';

async function fetchProfile(
  platform: Platform,
  accessToken: string,
): Promise<{
  platformUserId: string;
  platformUsername: string;
  displayName: string;
  avatarUrl?: string;
}> {
  switch (platform) {
    case 'linkedin':
      return fetchLinkedInProfile(accessToken);
    case 'x':
      return fetchXProfile(accessToken);
    default:
      throw new AppError('VALIDATION_FAILED', `Profile fetch not implemented for: ${platform}`);
  }
}

async function fetchLinkedInProfile(accessToken: string) {
  logger.info('Fetching LinkedIn user profile via /v2/userinfo');

  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'LinkedIn-Version': LI_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error({ status: res.status, response: err }, 'LinkedIn profile fetch failed');
    throw new AppError('PLATFORM_AUTH_FAILED', `LinkedIn profile fetch failed: ${err}`);
  }

  const data = await res.json() as {
    sub: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    email?: string;
  };

  logger.info({ sub: data.sub, name: data.name }, 'LinkedIn profile fetched');

  return {
    platformUserId: data.sub,
    platformUsername: data.email ?? data.sub,
    displayName: data.name ?? (`${data.given_name ?? ''} ${data.family_name ?? ''}`.trim() || data.sub),
    avatarUrl: data.picture,
  };
}

async function fetchXProfile(accessToken: string) {
  logger.info('Fetching X user profile via /2/users/me');

  const res = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error({ status: res.status, response: err }, 'X profile fetch failed');
    throw new AppError('PLATFORM_AUTH_FAILED', `X profile fetch failed: ${err}`);
  }

  const data = await res.json() as {
    data: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
  };

  logger.info({ id: data.data.id, username: data.data.username }, 'X profile fetched');

  return {
    platformUserId: data.data.id,
    platformUsername: data.data.username,
    displayName: data.data.name,
    avatarUrl: data.data.profile_image_url,
  };
}

/**
 * OAuth callback routes — mounted WITHOUT auth middleware since
 * these are browser redirects from X/LinkedIn (no Bearer token).
 * Security comes from the Redis-stored state parameter.
 */
export function oauthCallbackRoutes(deps: AccountDeps) {
  const app = new Hono();

  app.get('/callback/:platform', async (c) => {
    const platform = c.req.param('platform') as Platform;
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (!code || !state) {
      throw new AppError('VALIDATION_FAILED', 'Missing code or state parameter');
    }

    // Validate state — this is our security: only someone who initiated
    // the flow via an authenticated /connect request has a valid state
    const stateData = await deps.redis.get(`oauth:state:${state}`);
    if (!stateData) {
      throw new AppError('VALIDATION_FAILED', 'Invalid or expired OAuth state');
    }
    await deps.redis.del(`oauth:state:${state}`);

    const { workspaceId } = JSON.parse(stateData) as { workspaceId: string; platform: string };

    const provider = deps.providers.get(platform);
    if (!provider) {
      throw new AppError('VALIDATION_FAILED', `No provider for: ${platform}`);
    }

    logger.info({ platform, workspaceId }, 'OAuth callback received');

    const redirectUri = `${deps.publicUrl}/api/v1/accounts/callback/${platform}`;
    const tokens = await provider.handleCallback(code, redirectUri, state);

    // Fetch user profile from the platform
    const profile = await fetchProfile(platform, tokens.accessToken);
    logger.info({ platform, profileId: profile.platformUserId, name: profile.displayName }, 'Fetched user profile');

    const account = await deps.accountService.createFromOAuth(
      workspaceId,
      platform,
      tokens,
      profile,
    );

    logger.info({ platform, workspaceId, accountId: account.id }, 'OAuth account connected');

    // Return HTML for browser — this is always a browser redirect
    return c.html(`
      <html><body style="font-family: system-ui, sans-serif; max-width: 500px; margin: 60px auto; text-align: center;">
        <h1>✅ Account Connected!</h1>
        <p><strong>Platform:</strong> ${platform}</p>
        <p><strong>Account ID:</strong> <code>${account.id}</code></p>
        <p style="color: #666; margin-top: 24px;">You can close this window now.</p>
      </body></html>
    `);
  });

  return app;
}
