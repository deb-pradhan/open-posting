// ============================================================================
// Open Posting — Database Schema (Drizzle ORM)
// ============================================================================

import { pgTable, text, timestamp, jsonb, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ulid } from 'ulid';

// === Workspaces ===

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  emergencyStop: boolean('emergency_stop').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('workspaces_api_key_prefix_idx').on(table.apiKeyPrefix),
]);

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  socialAccounts: many(socialAccounts),
  posts: many(posts),
  media: many(media),
}));

// === Social Accounts ===

export const socialAccounts = pgTable('social_accounts', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  platformUserId: text('platform_user_id').notNull(),
  platformUsername: text('platform_username').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  tokenExpiresAt: timestamp('token_expires_at'),
  scopes: jsonb('scopes').$type<string[]>().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  provider: text('provider').notNull().default('official'),
  status: text('status').notNull().default('active'),
  nickname: text('nickname'),
  color: text('color'),
  tags: jsonb('tags').$type<string[]>().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  healthScore: integer('health_score').notNull().default(100),
  accountType: text('account_type').notNull().default('personal'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('social_accounts_workspace_idx').on(table.workspaceId),
  uniqueIndex('social_accounts_platform_user_idx').on(table.workspaceId, table.platform, table.platformUserId),
]);

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [socialAccounts.workspaceId],
    references: [workspaces.id],
  }),
  postTargets: many(postTargets),
}));

// === Posts ===

export const posts = pgTable('posts', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),
  content: jsonb('content').$type<{
    text: string;
    platformOverrides?: Record<string, unknown>;
    media?: Array<{ id: string; type: string; url: string; altText?: string }>;
    thread?: Array<{ text: string; media?: Array<{ id: string; type: string; url: string; altText?: string }> }>;
    poll?: { question: string; options: string[]; durationMinutes: number };
  }>().notNull(),
  scheduledAt: timestamp('scheduled_at'),
  publishedAt: timestamp('published_at'),
  idempotencyKey: text('idempotency_key'),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('posts_workspace_status_idx').on(table.workspaceId, table.status),
  index('posts_scheduled_at_idx').on(table.scheduledAt),
  uniqueIndex('posts_idempotency_idx').on(table.workspaceId, table.idempotencyKey),
]);

export const postsRelations = relations(posts, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [posts.workspaceId],
    references: [workspaces.id],
  }),
  targets: many(postTargets),
}));

// === Post Targets ===

export const postTargets = pgTable('post_targets', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  socialAccountId: text('social_account_id').notNull().references(() => socialAccounts.id),
  platform: text('platform').notNull(),
  status: text('status').notNull().default('pending'),
  platformPostId: text('platform_post_id'),
  platformPostUrl: text('platform_post_url'),
  publishedAt: timestamp('published_at'),
  error: jsonb('error').$type<{ code: string; message: string; retryable: boolean }>(),
  retryCount: integer('retry_count').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('post_targets_post_idx').on(table.postId),
  index('post_targets_status_idx').on(table.status),
]);

export const postTargetsRelations = relations(postTargets, ({ one }) => ({
  post: one(posts, {
    fields: [postTargets.postId],
    references: [posts.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [postTargets.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

// === Media ===

export const media = pgTable('media', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  storageUrl: text('storage_url').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  altText: text('alt_text'),
  hash: text('hash').notNull(),
  platformUploads: jsonb('platform_uploads').$type<Record<string, { status: string; platformMediaId?: string; error?: string }>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('media_workspace_idx').on(table.workspaceId),
  index('media_hash_idx').on(table.hash),
]);

export const mediaRelations = relations(media, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [media.workspaceId],
    references: [workspaces.id],
  }),
}));

// === Engagement Actions ===

export const engagementActions = pgTable('engagement_actions', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  socialAccountId: text('social_account_id').notNull().references(() => socialAccounts.id),
  platform: text('platform').notNull(),
  action: text('action').notNull(),
  targetPostId: text('target_post_id').notNull(),
  content: text('content'),
  status: text('status').notNull().default('pending'),
  platformResponseId: text('platform_response_id'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('engagement_workspace_idx').on(table.workspaceId),
]);

// === Analytics Snapshots ===

export const analyticsSnapshots = pgTable('analytics_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  postTargetId: text('post_target_id').notNull().references(() => postTargets.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
  platformSpecific: jsonb('platform_specific').$type<Record<string, unknown>>().default({}),
  collectedAt: timestamp('collected_at').defaultNow().notNull(),
}, (table) => [
  index('analytics_post_target_idx').on(table.postTargetId),
  index('analytics_collected_at_idx').on(table.collectedAt),
]);

// === Webhook Events (Outbox Pattern) ===

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  deliveredAt: timestamp('delivered_at'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('webhook_events_undelivered_idx').on(table.deliveredAt),
]);
