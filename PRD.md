# Open Posting — Product Requirements Document

**Version:** 1.0.0
**Date:** 2026-03-22
**Status:** Draft
**Author:** Engineering Architecture Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision & Goals](#3-product-vision--goals)
4. [System Architecture](#4-system-architecture)
5. [Tech Stack](#5-tech-stack)
6. [Core Domain Model](#6-core-domain-model)
7. [API Design — REST Gateway](#7-api-design--rest-gateway)
8. [API Design — MCP Server](#8-api-design--mcp-server)
9. [OpenClaw Skills Specification](#9-openclaw-skills-specification)
10. [CLI Interface](#10-cli-interface)
11. [Platform Providers](#11-platform-providers)
12. [Authentication & OAuth Flows](#12-authentication--oauth-flows)
13. [Media Pipeline](#13-media-pipeline)
14. [Scheduling Engine](#14-scheduling-engine)
15. [Rate Limiting & Fallback Strategy](#15-rate-limiting--fallback-strategy)
16. [Observability & Reliability](#16-observability--reliability)
17. [Security](#17-security)
18. [Deployment & Infrastructure](#18-deployment--infrastructure)
19. [Database Schema](#19-database-schema)
20. [Testing Strategy](#20-testing-strategy)
21. [Phase Rollout Plan](#21-phase-rollout-plan)
22. [Multi-Account Management & User Experience](#22-multi-account-management--user-experience)
23. [Comprehensive Media Pipeline — Deep Dive](#23-comprehensive-media-pipeline--deep-dive)
24. [Analytics & Insights Engine](#24-analytics--insights-engine)
25. [Web Dashboard — Human User Experience](#25-web-dashboard--human-user-experience)
26. [Appendix](#26-appendix)

---

## 1. Executive Summary

**Open Posting** is an open-source, AI-agent-native social media access layer. It enables any LLM, AI agent, or automation pipeline to publish content (text, images, videos, threads, polls), engage (like, comment, repost), and read analytics across social media platforms through a unified API, MCP server, and CLI.

Unlike legacy tools (Postiz, Buffer, Hootsuite) that bolt AI on top of human-first UIs, Open Posting is **designed from the ground up for programmatic, agent-driven workflows** — zero UI dependency, structured I/O, deterministic error handling, and machine-readable responses at every layer.

**Phase 1 platforms:** X (Twitter) and LinkedIn.
**Future:** Instagram, Threads, Bluesky, Facebook, TikTok, YouTube, Reddit, Medium, Dev.to, Mastodon.

### Key Differentiators

| Dimension | Postiz / Legacy Tools | Open Posting |
|---|---|---|
| Primary consumer | Humans via web UI | AI agents / LLMs via API |
| Response format | HTML / mixed | Strict JSON + MCP structured output |
| Error handling | Toast notifications | Machine-parseable error codes + retry hints |
| Agent integration | Bolted-on CLI | Native MCP server + OpenClaw skills + REST |
| Cost optimization | Single API path | Multi-provider fallback (official + cheaper APIs) |
| Architecture | Monolithic Next.js | Modular Rust core + TypeScript orchestration |
| Scheduling | Cron-based | Durable workflow engine (Temporal-compatible) |

---

## 2. Problem Statement

### For AI Agent Developers
- No standardized way to give agents social media capabilities
- Each platform requires separate OAuth flows, media upload pipelines, and rate limit management
- Existing tools return human-formatted responses that are hard for agents to parse
- Rate limits on official APIs (especially X at $100/mo for basic access) make experimentation expensive

### For Content Creators Using AI
- Managing multiple AI tools that each need separate social media access
- No unified scheduling that works across agents
- No fallback when API rate limits are hit

### For Platform Teams
- Building social media integrations from scratch for each new platform
- Handling OAuth token refresh, media transcoding, and platform-specific formatting repeatedly

---

## 3. Product Vision & Goals

### Vision
Become the **universal social media access layer** for the AI ecosystem — the equivalent of Stripe for payments, but for social media publishing.

### Goals (Phase 1 — MVP)

| # | Goal | Success Metric |
|---|---|---|
| G1 | Publish text posts to X and LinkedIn from any LLM via single API call | < 2s e2e latency, 99.5% success rate |
| G2 | Support media (images, video) upload and attachment | All X and LinkedIn media types supported |
| G3 | Thread creation on X, article-style posts on LinkedIn | Correct rendering verified on both platforms |
| G4 | Engagement actions: like, comment, repost/reshare | All actions work bidirectionally |
| G5 | MCP server for direct Claude/ChatGPT integration | Listed on MCP registries |
| G6 | OpenClaw skill files for agent learning | Skills pass OpenClaw validation |
| G7 | CLI for scripting and automation | < 500ms cold start, all API features exposed |
| G8 | Multi-provider X API with automatic fallback | Seamless failover, 10x cost reduction on reads |
| G9 | Deployable on Railway or local Docker in < 5 min | Single `docker compose up` or Railway template |
| G10 | Scheduling with durable guarantees | Zero missed posts, exactly-once delivery |

---

## 4. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONSUMERS                                 │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ AI Agent │  │ LLM (MCP) │  │   CLI    │  │ HTTP Client   │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │              │               │            │
└───────┼──────────────┼──────────────┼───────────────┼────────────┘
        │              │              │               │
        ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     GATEWAY LAYER                                │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │   REST API        │  │   MCP Server      │  │  CLI Binary   │  │
│  │   (Hono + Zod)    │  │   (stdio/SSE)     │  │  (Commander)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬────────┘  │
│           │                     │                    │           │
│           └─────────────┬───────┘────────────────────┘           │
│                         ▼                                        │
│              ┌─────────────────────┐                             │
│              │   Core Service Layer │                             │
│              │   (TypeScript)       │                             │
│              └──────────┬──────────┘                             │
│                         │                                        │
└─────────────────────────┼────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CORE ENGINE (Rust via NAPI)                    │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Post       │  │ Media      │  │ Scheduler  │  │ Provider  │ │
│  │ Composer   │  │ Pipeline   │  │ Engine     │  │ Router    │ │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  └─────┬─────┘ │
│         │               │               │              │        │
│         └───────────────┴───────────────┴──────────────┘        │
│                                   │                              │
└───────────────────────────────────┼──────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PLATFORM PROVIDERS                               │
│                                                                  │
│  ┌─────────────────┐  ┌───────────────┐  ┌────────────────────┐ │
│  │ X Official API  │  │ X GetXAPI     │  │ LinkedIn API       │ │
│  │ (Default)       │  │ (Fallback)    │  │ (Posts + UGC)      │ │
│  └─────────────────┘  └───────────────┘  └────────────────────┘ │
│                                                                  │
│  ┌─────────────────┐  ┌───────────────┐  ┌────────────────────┐ │
│  │ [Future]        │  │ [Future]      │  │ [Future]           │ │
│  │ Bluesky         │  │ Threads       │  │ Instagram/FB       │ │
│  └─────────────────┘  └───────────────┘  └────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ PostgreSQL   │  │ Redis        │  │ Local Volume Storage   │ │
│  │ (Drizzle ORM)│  │ (Queue/Cache)│  │ (Media assets)         │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Role | Technology |
|---|---|---|
| **REST API** | Primary HTTP interface for all consumers | Hono (fast, edge-ready) + Zod validation |
| **MCP Server** | Model Context Protocol server for LLM integration | `@modelcontextprotocol/sdk` via stdio + SSE |
| **CLI** | Command-line tool for scripts and terminal agents | Commander.js, packaged via `pkg` |
| **Core Service** | Business logic orchestration, auth management | TypeScript (Node.js) |
| **Core Engine** | Performance-critical: media processing, scheduling, content validation | Rust compiled to native Node addon via NAPI-RS |
| **Provider Router** | Routes requests to platform APIs with fallback logic | TypeScript with circuit breaker pattern |
| **Scheduler** | Durable task scheduling with exactly-once guarantees | BullMQ (Redis-backed) with dead letter queues |
| **PostgreSQL** | Primary data store: accounts, posts, schedules, tokens | Drizzle ORM with type-safe migrations |
| **Redis** | Job queues, rate limit counters, OAuth state, caching | ioredis |
| **Media Storage** | Media file storage before/after upload to platforms | Local filesystem (Docker volumes / Railway persistent volumes) |

---

## 5. Tech Stack

### Why This Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Runtime** | Node.js 22 LTS | Best MCP ecosystem, massive npm library support, async I/O |
| **Language** | TypeScript 5.5+ (strict) | Type safety across API boundaries, excellent DX |
| **Hot Path** | Rust via NAPI-RS | Media processing, content hashing, crypto — 10-100x faster than JS |
| **HTTP Framework** | Hono | 3x faster than Express, built-in Zod, zero dependencies, edge-compatible |
| **Database** | PostgreSQL 16 | JSONB for platform metadata, row-level security, proven reliability |
| **ORM** | Drizzle | Type-safe, zero overhead, SQL-like syntax, instant migrations |
| **Queue** | BullMQ 5 | Redis-backed, rate limiting, repeatable jobs, job dependencies |
| **Cache** | Redis 7 (Valkey compatible) | Pub/sub for events, sorted sets for rate limiting, streams for logs |
| **Media Storage** | Local filesystem (Docker/Railway volumes) | Zero external dependencies, Railway-native, simple self-hosting, no S3 needed |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Official MCP implementation, stdio + SSE transport |
| **Validation** | Zod | Runtime + compile-time validation, OpenAPI generation |
| **Testing** | Vitest + Playwright | Fast unit tests, E2E for OAuth flows |
| **Monorepo** | Turborepo + pnpm | Cached builds, workspace dependencies, parallel execution |
| **Container** | Docker + Compose | Single command local setup, Railway-ready |
| **CI/CD** | GitHub Actions | PR checks, auto-publish Docker images, changelog |

### Monorepo Structure

```
open-posting/
├── apps/
│   ├── api/                    # Hono REST API server
│   │   ├── src/
│   │   │   ├── routes/         # Route handlers
│   │   │   ├── middleware/     # Auth, rate limit, error handling
│   │   │   └── server.ts       # Entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── mcp/                    # MCP server
│   │   ├── src/
│   │   │   ├── tools/          # MCP tool definitions
│   │   │   ├── resources/      # MCP resource definitions
│   │   │   └── server.ts       # MCP server entry
│   │   └── package.json
│   │
│   └── cli/                    # CLI application
│       ├── src/
│       │   ├── commands/       # CLI commands
│       │   └── index.ts        # CLI entry
│       └── package.json
│
├── packages/
│   ├── core/                   # Shared business logic
│   │   ├── src/
│   │   │   ├── services/       # PostService, MediaService, etc.
│   │   │   ├── providers/      # Platform provider implementations
│   │   │   │   ├── x/
│   │   │   │   │   ├── x-official.provider.ts
│   │   │   │   │   ├── x-getxapi.provider.ts
│   │   │   │   │   └── x-router.provider.ts
│   │   │   │   ├── linkedin/
│   │   │   │   │   └── linkedin.provider.ts
│   │   │   │   └── base.provider.ts
│   │   │   ├── scheduler/      # BullMQ job definitions
│   │   │   ├── auth/           # OAuth flows, token management
│   │   │   ├── media/          # Upload pipeline
│   │   │   └── types/          # Shared TypeScript types
│   │   └── package.json
│   │
│   ├── engine/                 # Rust NAPI module
│   │   ├── src/
│   │   │   ├── media.rs        # Image/video processing
│   │   │   ├── content.rs      # Content validation & hashing
│   │   │   └── lib.rs
│   │   ├── Cargo.toml
│   │   └── package.json
│   │
│   ├── db/                     # Database schema & migrations
│   │   ├── src/
│   │   │   ├── schema/         # Drizzle schema definitions
│   │   │   ├── migrations/     # SQL migrations
│   │   │   └── index.ts        # DB client export
│   │   └── package.json
│   │
│   ├── sdk/                    # TypeScript SDK for consumers
│   │   ├── src/
│   │   │   └── index.ts        # OpenPostingClient class
│   │   └── package.json
│   │
│   └── shared/                 # Constants, utils, error codes
│       ├── src/
│       │   ├── errors.ts       # Error code registry
│       │   ├── constants.ts    # Platform limits, defaults
│       │   └── types.ts        # Shared types
│       └── package.json
│
├── skills/                     # OpenClaw skill definitions
│   ├── open-posting.skill.md
│   ├── x-posting.skill.md
│   └── linkedin-posting.skill.md
│
├── docker-compose.yml          # Full local stack
├── docker-compose.prod.yml     # Production compose
├── Dockerfile                  # Multi-stage build
├── railway.toml                # Railway deployment config
├── turbo.json                  # Turborepo config
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

---

## 6. Core Domain Model

### Entities

```typescript
// === Identity & Auth ===

interface Workspace {
  id: string;                    // ULID
  name: string;
  apiKey: string;                // hashed, for REST API auth
  apiKeyPrefix: string;          // first 8 chars for identification
  createdAt: Date;
  updatedAt: Date;
}

interface SocialAccount {
  id: string;                    // ULID
  workspaceId: string;
  platform: Platform;            // 'x' | 'linkedin' | ...
  platformUserId: string;        // Platform-specific user ID
  platformUsername: string;       // Display handle
  displayName: string;
  avatarUrl: string | null;
  accessToken: string;           // encrypted at rest
  refreshToken: string | null;   // encrypted at rest
  tokenExpiresAt: Date | null;
  scopes: string[];
  metadata: Record<string, unknown>; // Platform-specific data
  provider: ApiProvider;         // 'official' | 'getxapi' (for X)
  status: AccountStatus;         // 'active' | 'expired' | 'revoked'
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// === Content ===

interface Post {
  id: string;                    // ULID
  workspaceId: string;
  status: PostStatus;            // 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'partially_failed'
  targets: PostTarget[];         // Which accounts to publish to
  content: PostContent;
  scheduledAt: Date | null;      // null = publish immediately
  publishedAt: Date | null;
  idempotencyKey: string;        // Client-provided for exactly-once
  retryCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PostTarget {
  id: string;
  postId: string;
  socialAccountId: string;
  platform: Platform;
  status: PostTargetStatus;      // 'pending' | 'publishing' | 'published' | 'failed'
  platformPostId: string | null; // ID returned by platform after publish
  platformPostUrl: string | null;
  publishedAt: Date | null;
  error: PostError | null;
  retryCount: number;
  metadata: Record<string, unknown>; // Platform-specific response data
}

interface PostContent {
  text: string;                  // Primary text content
  platformOverrides?: {          // Per-platform customization
    x?: {
      text?: string;             // Override text for X (280 char limit)
      replyToId?: string;        // For threading
    };
    linkedin?: {
      text?: string;             // Override text for LinkedIn
      visibility?: 'PUBLIC' | 'CONNECTIONS';
      articleUrl?: string;
      articleTitle?: string;
      articleDescription?: string;
    };
  };
  media?: MediaAttachment[];
  thread?: ThreadItem[];         // For X threads / LinkedIn document posts
  poll?: PollContent;
}

interface MediaAttachment {
  id: string;
  type: MediaType;               // 'image' | 'video' | 'gif' | 'document'
  url: string;                   // URL served by our API (local volume storage)
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;           // For video
  altText?: string;
  platformUploads: {             // Tracks upload status per platform
    [platform: string]: {
      status: 'pending' | 'uploading' | 'uploaded' | 'failed';
      platformMediaId?: string;
      error?: string;
    };
  };
}

interface ThreadItem {
  text: string;
  media?: MediaAttachment[];
}

interface PollContent {
  question: string;
  options: string[];             // 2-4 options
  durationMinutes: number;       // X: 5-10080, LinkedIn: N/A
}

// === Engagement ===

interface EngagementAction {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: Platform;
  action: EngagementType;        // 'like' | 'unlike' | 'comment' | 'repost' | 'unrepost' | 'bookmark'
  targetPostId: string;          // Platform post ID to act on
  content?: string;              // For comments
  status: 'pending' | 'completed' | 'failed';
  platformResponseId?: string;
  error?: string;
  createdAt: Date;
}

// === Enums ===

type Platform = 'x' | 'linkedin';
type ApiProvider = 'official' | 'getxapi';
type AccountStatus = 'active' | 'expired' | 'revoked' | 'rate_limited';
type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'partially_failed';
type PostTargetStatus = 'pending' | 'publishing' | 'published' | 'failed';
type MediaType = 'image' | 'video' | 'gif' | 'document';
type EngagementType = 'like' | 'unlike' | 'comment' | 'repost' | 'unrepost' | 'bookmark';
```

---

## 7. API Design — REST Gateway

### Base URL

```
https://<host>/api/v1
```

### Authentication

All requests require an API key via `Authorization: Bearer op_<key>` header.

### Standard Response Envelope

```typescript
// Success
{
  "ok": true,
  "data": T,
  "meta": {
    "requestId": "req_01HWXYZ...",
    "rateLimit": {
      "remaining": 148,
      "limit": 150,
      "resetAt": "2026-03-22T16:00:00Z"
    }
  }
}

// Error
{
  "ok": false,
  "error": {
    "code": "PLATFORM_RATE_LIMITED",
    "message": "X API rate limit exceeded. Retry after 2026-03-22T15:05:00Z",
    "details": {
      "platform": "x",
      "provider": "official",
      "retryAfter": "2026-03-22T15:05:00Z",
      "fallbackAvailable": true
    },
    "retryable": true,
    "retryAfterMs": 300000
  },
  "meta": {
    "requestId": "req_01HWXYZ..."
  }
}
```

### Error Code Registry

```typescript
const ERROR_CODES = {
  // Auth errors (1xxx)
  AUTH_MISSING_KEY:          { status: 401, code: 'AUTH_MISSING_KEY' },
  AUTH_INVALID_KEY:          { status: 401, code: 'AUTH_INVALID_KEY' },
  AUTH_ACCOUNT_EXPIRED:      { status: 401, code: 'AUTH_ACCOUNT_EXPIRED' },

  // Validation errors (2xxx)
  VALIDATION_FAILED:         { status: 400, code: 'VALIDATION_FAILED' },
  CONTENT_TOO_LONG:          { status: 400, code: 'CONTENT_TOO_LONG' },
  MEDIA_TYPE_UNSUPPORTED:    { status: 400, code: 'MEDIA_TYPE_UNSUPPORTED' },
  MEDIA_TOO_LARGE:           { status: 400, code: 'MEDIA_TOO_LARGE' },
  INVALID_THREAD_STRUCTURE:  { status: 400, code: 'INVALID_THREAD_STRUCTURE' },

  // Platform errors (3xxx)
  PLATFORM_RATE_LIMITED:     { status: 429, code: 'PLATFORM_RATE_LIMITED' },
  PLATFORM_AUTH_FAILED:      { status: 502, code: 'PLATFORM_AUTH_FAILED' },
  PLATFORM_UNAVAILABLE:      { status: 502, code: 'PLATFORM_UNAVAILABLE' },
  PLATFORM_REJECTED:         { status: 422, code: 'PLATFORM_REJECTED' },
  PLATFORM_MEDIA_UPLOAD_FAILED: { status: 502, code: 'PLATFORM_MEDIA_UPLOAD_FAILED' },

  // Internal errors (5xxx)
  INTERNAL_ERROR:            { status: 500, code: 'INTERNAL_ERROR' },
  SCHEDULER_FAILED:          { status: 500, code: 'SCHEDULER_FAILED' },
  PROVIDER_FALLBACK_EXHAUSTED: { status: 502, code: 'PROVIDER_FALLBACK_EXHAUSTED' },

  // Resource errors (4xxx)
  NOT_FOUND:                 { status: 404, code: 'NOT_FOUND' },
  DUPLICATE_POST:            { status: 409, code: 'DUPLICATE_POST' },
  ACCOUNT_NOT_CONNECTED:     { status: 422, code: 'ACCOUNT_NOT_CONNECTED' },
} as const;
```

### Endpoints

#### Accounts

```
GET    /accounts                    # List connected social accounts
GET    /accounts/:id                # Get account details
POST   /accounts/connect/:platform  # Initiate OAuth flow (returns redirect URL)
GET    /accounts/callback/:platform # OAuth callback handler
DELETE /accounts/:id                # Disconnect account
POST   /accounts/:id/refresh        # Force token refresh
GET    /accounts/:id/limits          # Get current rate limit status per provider
```

#### Posts

```
POST   /posts                       # Create & publish/schedule a post
GET    /posts                       # List posts (filterable by status, platform, date)
GET    /posts/:id                   # Get post with all target statuses
PUT    /posts/:id                   # Update draft/scheduled post
DELETE /posts/:id                   # Delete post (cancels if scheduled, deletes from platforms if published)
POST   /posts/:id/retry             # Retry failed post targets
```

##### Create Post — Request Body

```typescript
interface CreatePostRequest {
  content: {
    text: string;                    // Required. Primary content.
    platformOverrides?: {
      x?: { text?: string; replyToId?: string };
      linkedin?: {
        text?: string;
        visibility?: 'PUBLIC' | 'CONNECTIONS';
        articleUrl?: string;
        articleTitle?: string;
        articleDescription?: string;
      };
    };
    media?: Array<{
      url?: string;                  // External URL to fetch
      uploadId?: string;             // Pre-uploaded media ID
      altText?: string;
    }>;
    thread?: Array<{
      text: string;
      media?: Array<{ url?: string; uploadId?: string; altText?: string }>;
    }>;
    poll?: {
      question: string;
      options: string[];             // 2-4 options
      durationMinutes: number;
    };
  };
  targets: Array<{
    accountId: string;               // Social account ID
    platform: Platform;              // Redundant but explicit for agent clarity
  }>;
  scheduledAt?: string;              // ISO 8601. Omit for immediate publish.
  idempotencyKey?: string;           // Client-generated. Prevents duplicate posts.
}
```

##### Create Post — Response

```typescript
interface CreatePostResponse {
  id: string;
  status: PostStatus;
  targets: Array<{
    accountId: string;
    platform: Platform;
    status: PostTargetStatus;
    platformPostId?: string;
    platformPostUrl?: string;
    error?: {
      code: string;
      message: string;
      retryable: boolean;
    };
  }>;
  scheduledAt?: string;
  publishedAt?: string;
}
```

#### Threads (X-specific convenience endpoint)

```
POST   /threads                     # Create a thread (array of posts)
GET    /threads/:id                 # Get thread with all tweet statuses
POST   /threads/:id/append          # Add tweets to existing thread
```

#### Engagement

```
POST   /engage                      # Perform engagement action
GET    /engage                      # List recent engagement actions
```

##### Engage — Request Body

```typescript
interface EngageRequest {
  accountId: string;
  action: 'like' | 'unlike' | 'comment' | 'repost' | 'unrepost' | 'bookmark';
  targetPostId: string;             // Platform-native post ID
  platform: Platform;
  content?: string;                 // Required for 'comment' action
}
```

#### Media

```
POST   /media/upload                # Upload media file (multipart or URL)
GET    /media/:id                   # Get media status and platform upload statuses
DELETE /media/:id                   # Delete media
```

#### Analytics (Read-only)

```
GET    /analytics/posts/:postId     # Get engagement metrics for a published post
GET    /analytics/accounts/:id      # Get account-level metrics
```

#### Health

```
GET    /health                      # Basic health check
GET    /health/ready                # Readiness (DB, Redis, storage connected)
GET    /health/providers             # Status of all platform API providers
```

---

## 8. API Design — MCP Server

The MCP server exposes the same capabilities as the REST API but formatted as MCP tools and resources for direct LLM integration.

### Transport

- **stdio** (default): For local Claude Code, Cursor, and other IDE integrations
- **SSE**: For remote/hosted MCP connections

### MCP Tools

```typescript
const MCP_TOOLS = [
  // === Account Management ===
  {
    name: "list_accounts",
    description: "List all connected social media accounts with their status and platform details",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["x", "linkedin"], description: "Filter by platform" },
        status: { type: "string", enum: ["active", "expired", "revoked"], description: "Filter by status" }
      }
    }
  },
  {
    name: "connect_account",
    description: "Start OAuth flow to connect a new social media account. Returns a URL the user must visit to authorize.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["x", "linkedin"] }
      },
      required: ["platform"]
    }
  },

  // === Posting ===
  {
    name: "create_post",
    description: "Create and publish a post to one or more social media platforms. Supports text, images, videos, articles, and polls. Can be scheduled for future publishing.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The post content text. Max 280 chars for X, 3000 chars for LinkedIn." },
        accounts: {
          type: "array",
          items: { type: "string" },
          description: "Array of social account IDs to post to"
        },
        media: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL of image or video to attach" },
              altText: { type: "string", description: "Alt text for accessibility" }
            }
          },
          description: "Media attachments (images, videos)"
        },
        platformOverrides: {
          type: "object",
          description: "Platform-specific content overrides",
          properties: {
            x: {
              type: "object",
              properties: { text: { type: "string" } }
            },
            linkedin: {
              type: "object",
              properties: {
                text: { type: "string" },
                visibility: { type: "string", enum: ["PUBLIC", "CONNECTIONS"] }
              }
            }
          }
        },
        scheduledAt: { type: "string", description: "ISO 8601 datetime for scheduled publishing. Omit for immediate." },
        idempotencyKey: { type: "string", description: "Unique key to prevent duplicate posts" }
      },
      required: ["text", "accounts"]
    }
  },
  {
    name: "create_thread",
    description: "Create a thread of connected posts on X (Twitter). Each item becomes one tweet in the thread.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "X social account ID" },
        posts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Tweet text (max 280 chars)" },
              media: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    altText: { type: "string" }
                  }
                }
              }
            },
            required: ["text"]
          },
          description: "Array of thread items in order"
        }
      },
      required: ["accountId", "posts"]
    }
  },
  {
    name: "get_post",
    description: "Get the status and details of a previously created post, including per-platform publish status and URLs.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "The Open Posting post ID" }
      },
      required: ["postId"]
    }
  },
  {
    name: "list_posts",
    description: "List posts with optional filters for status, platform, and date range.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "scheduled", "published", "failed"] },
        platform: { type: "string", enum: ["x", "linkedin"] },
        limit: { type: "number", description: "Max results (default 20, max 100)" },
        cursor: { type: "string", description: "Pagination cursor" }
      }
    }
  },
  {
    name: "delete_post",
    description: "Delete a post. If published, also deletes from the social platforms. If scheduled, cancels the schedule.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string" }
      },
      required: ["postId"]
    }
  },

  // === Engagement ===
  {
    name: "engage",
    description: "Perform an engagement action (like, comment, repost, bookmark) on a social media post.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Social account ID to act from" },
        action: { type: "string", enum: ["like", "unlike", "comment", "repost", "unrepost", "bookmark"] },
        targetPostId: { type: "string", description: "The platform-native post ID to engage with" },
        platform: { type: "string", enum: ["x", "linkedin"] },
        content: { type: "string", description: "Comment text (required for 'comment' action)" }
      },
      required: ["accountId", "action", "targetPostId", "platform"]
    }
  },

  // === Media ===
  {
    name: "upload_media",
    description: "Upload a media file (image, video, GIF, document) for use in posts. Returns a media ID to reference when creating posts.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch the media from" },
        altText: { type: "string", description: "Accessibility alt text" },
        type: { type: "string", enum: ["image", "video", "gif", "document"] }
      },
      required: ["url"]
    }
  },

  // === Analytics ===
  {
    name: "get_post_analytics",
    description: "Get engagement metrics (likes, reposts, comments, impressions, clicks) for a published post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string" }
      },
      required: ["postId"]
    }
  },

  // === Utilities ===
  {
    name: "validate_content",
    description: "Validate post content against platform rules (character limits, media restrictions) without publishing. Returns warnings and errors.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        platforms: {
          type: "array",
          items: { type: "string", enum: ["x", "linkedin"] }
        },
        media: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["image", "video", "gif"] },
              sizeBytes: { type: "number" }
            }
          }
        }
      },
      required: ["text", "platforms"]
    }
  },
  {
    name: "get_platform_limits",
    description: "Get current platform limits and rate limit status for an account.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" }
      },
      required: ["accountId"]
    }
  }
];
```

### MCP Resources

```typescript
const MCP_RESOURCES = [
  {
    uri: "openposting://accounts",
    name: "Connected Accounts",
    description: "All connected social media accounts and their status",
    mimeType: "application/json"
  },
  {
    uri: "openposting://accounts/{accountId}/limits",
    name: "Account Rate Limits",
    description: "Current rate limit status for a specific account across all providers",
    mimeType: "application/json"
  },
  {
    uri: "openposting://posts/recent",
    name: "Recent Posts",
    description: "Last 20 posts with their publish status",
    mimeType: "application/json"
  },
  {
    uri: "openposting://health",
    name: "System Health",
    description: "Health status of all system components and platform API providers",
    mimeType: "application/json"
  }
];
```

---

## 9. OpenClaw Skills Specification

Skills allow any OpenClaw-compatible agent to learn and execute Open Posting capabilities.

### Master Skill: `open-posting.skill.md`

```markdown
---
name: open-posting
version: 1.0.0
description: Social media access layer for AI agents. Post content, engage with posts, and manage social accounts across X and LinkedIn.
author: open-posting
repository: https://github.com/<org>/open-posting
requires:
  - env: OPEN_POSTING_API_KEY
    description: API key from Open Posting dashboard or CLI setup
  - env: OPEN_POSTING_URL
    description: Base URL of Open Posting instance (default: http://localhost:3000)
tools:
  - name: open-posting-cli
    install: npm install -g @open-posting/cli
---

# Open Posting Skill

You are an AI agent with access to social media platforms through Open Posting.

## Available Actions

### Post Content
Create posts on X (Twitter) and LinkedIn with text, images, videos, and links.

Command: `op post create --text "<content>" --accounts <account_ids> [--media <urls>] [--schedule <iso_datetime>]`

Platform limits:
- X: 280 characters, 4 images or 1 video, 1 GIF
- LinkedIn: 3,000 characters, 9 images or 1 video, documents (PDF)

### Create Threads (X)
Post a sequence of connected tweets as a thread.

Command: `op thread create --account <id> --posts '<json_array>'`

### Engage
Like, comment, repost, or bookmark posts.

Command: `op engage --account <id> --action <like|comment|repost|bookmark> --target <post_id> --platform <x|linkedin> [--content "<comment_text>"]`

### Upload Media
Upload images or videos before attaching to posts.

Command: `op media upload --url <media_url> [--alt "<alt_text>"]`

### Check Status
View post status, account health, and rate limits.

Commands:
- `op accounts list` — List connected accounts
- `op posts list --status <status>` — List posts by status
- `op posts get <post_id>` — Get detailed post status
- `op accounts limits <account_id>` — Check rate limits

## Error Handling

When a command fails, the CLI returns a JSON error with:
- `code`: Machine-readable error code (e.g., CONTENT_TOO_LONG)
- `message`: Human-readable explanation
- `retryable`: Whether you should retry
- `retryAfterMs`: How long to wait before retrying

If you receive PLATFORM_RATE_LIMITED, wait for the specified retryAfterMs before retrying.
If you receive CONTENT_TOO_LONG, shorten the text and retry.
If you receive PLATFORM_AUTH_FAILED, suggest the user re-authenticate with `op accounts connect <platform>`.

## Best Practices

1. Always validate content before posting: `op validate --text "<content>" --platforms x,linkedin`
2. Use idempotency keys for important posts: `--idempotency-key <unique_key>`
3. Use platform overrides when posting to multiple platforms to optimize for each
4. Check rate limits before bulk operations
5. Schedule posts for optimal engagement times rather than posting immediately
```

### Platform-Specific Skills

Similar `.skill.md` files for `x-posting.skill.md` and `linkedin-posting.skill.md` with platform-specific guidance, character limits, media requirements, and best practices.

---

## 10. CLI Interface

### Installation

```bash
npm install -g @open-posting/cli
# or
npx @open-posting/cli
```

### Configuration

```bash
# Interactive setup
op init

# Manual
export OPEN_POSTING_URL=http://localhost:3000
export OPEN_POSTING_API_KEY=op_xxx
```

### Command Reference

```
op
├── init                          # Interactive setup wizard
├── accounts
│   ├── list                      # List connected accounts
│   ├── connect <platform>        # Start OAuth flow (opens browser)
│   ├── disconnect <id>           # Remove account
│   ├── refresh <id>              # Force token refresh
│   └── limits <id>               # Show rate limit status
├── post
│   ├── create                    # Create & publish/schedule post
│   │   --text <text>             # Post content (required)
│   │   --accounts <ids...>       # Target accounts (required)
│   │   --media <urls...>         # Media URLs to attach
│   │   --alt <texts...>          # Alt text per media item
│   │   --schedule <iso_date>     # Schedule for later
│   │   --x-text <text>           # X-specific text override
│   │   --linkedin-text <text>    # LinkedIn-specific text override
│   │   --linkedin-visibility <v> # PUBLIC or CONNECTIONS
│   │   --idempotency-key <key>   # Prevent duplicate posts
│   │   --json                    # Output as JSON (default for piped output)
│   ├── list                      # List posts
│   │   --status <status>         # Filter by status
│   │   --platform <platform>     # Filter by platform
│   │   --limit <n>               # Max results
│   ├── get <id>                  # Get post details
│   ├── delete <id>               # Delete/cancel post
│   └── retry <id>                # Retry failed targets
├── thread
│   ├── create                    # Create X thread
│   │   --account <id>            # X account
│   │   --posts <json>            # Thread items as JSON
│   ├── get <id>                  # Get thread status
│   └── append <id>               # Add to existing thread
│       --text <text>
│       --media <urls...>
├── engage
│   --account <id>                # Acting account (required)
│   --action <action>             # like|unlike|comment|repost|unrepost|bookmark
│   --target <post_id>            # Platform post ID (required)
│   --platform <platform>         # Target platform (required)
│   --content <text>              # Comment text
├── media
│   ├── upload                    # Upload media file
│   │   --url <url>               # Source URL
│   │   --file <path>             # Local file path
│   │   --alt <text>              # Alt text
│   │   --type <type>             # image|video|gif|document
│   ├── get <id>                  # Get media status
│   └── delete <id>               # Delete media
├── validate                      # Validate content without posting
│   --text <text>
│   --platforms <platforms...>
│   --media <urls...>
├── analytics
│   ├── post <id>                 # Post engagement metrics
│   └── account <id>              # Account-level metrics
├── health                        # System health status
└── version                       # CLI version
```

### Output Format

- Interactive terminal: Formatted table/colored output
- Piped/CI: JSON (auto-detected via `process.stdout.isTTY`)
- Forced: `--json` flag or `--format table|json|csv`

---

## 11. Platform Providers

### Provider Interface

```typescript
interface PlatformProvider {
  readonly platform: Platform;
  readonly providerName: string;
  readonly capabilities: ProviderCapabilities;

  // Posts
  createPost(account: SocialAccount, content: NormalizedContent): Promise<PlatformPostResult>;
  deletePost(account: SocialAccount, platformPostId: string): Promise<void>;

  // Threads
  createThread(account: SocialAccount, items: ThreadItem[]): Promise<PlatformThreadResult>;
  appendToThread(account: SocialAccount, threadId: string, item: ThreadItem): Promise<PlatformPostResult>;

  // Engagement
  like(account: SocialAccount, postId: string): Promise<void>;
  unlike(account: SocialAccount, postId: string): Promise<void>;
  comment(account: SocialAccount, postId: string, text: string): Promise<PlatformPostResult>;
  repost(account: SocialAccount, postId: string): Promise<void>;
  unrepost(account: SocialAccount, postId: string): Promise<void>;
  bookmark(account: SocialAccount, postId: string): Promise<void>;

  // Media
  uploadMedia(account: SocialAccount, media: MediaPayload): Promise<PlatformMediaResult>;

  // Analytics
  getPostMetrics(account: SocialAccount, postId: string): Promise<PostMetrics>;

  // Auth
  getAuthUrl(state: string, scopes: string[]): string;
  handleCallback(code: string, state: string): Promise<TokenSet>;
  refreshToken(account: SocialAccount): Promise<TokenSet>;

  // Health
  healthCheck(): Promise<ProviderHealth>;
}

interface ProviderCapabilities {
  maxTextLength: number;
  maxMediaPerPost: number;
  supportedMediaTypes: MediaType[];
  maxMediaSizeBytes: Record<MediaType, number>;
  supportsThreads: boolean;
  supportsPolls: boolean;
  supportScheduling: boolean;
  supportsEdit: boolean;
  supportsAltText: boolean;
  supportsHashtags: boolean;
  supportsMentions: boolean;
}
```

### X Official Provider (`x-official.provider.ts`)

```typescript
// X API v2 — https://docs.x.com/x-api
// Auth: OAuth 2.0 with PKCE (user context) + OAuth 1.0a (for some endpoints)
// Rate limits: Pay-per-usage, varies by endpoint tier
//
// Key endpoints:
// POST /2/tweets                    — Create tweet
// DELETE /2/tweets/:id              — Delete tweet
// POST /2/tweets/:id/likes          — Like
// POST /2/tweets/:id/retweets       — Retweet
// POST /2/tweets/:id/bookmarks      — Bookmark
// POST /1.1/media/upload.json       — Chunked media upload (v1.1 still required)
//
// Thread creation: POST /2/tweets with reply.in_reply_to_tweet_id chained
//
// Capabilities:
const X_OFFICIAL_CAPABILITIES: ProviderCapabilities = {
  maxTextLength: 280,              // 25,000 for Premium+ subscribers
  maxMediaPerPost: 4,              // 4 images OR 1 video/GIF
  supportedMediaTypes: ['image', 'video', 'gif'],
  maxMediaSizeBytes: {
    image: 5 * 1024 * 1024,       // 5 MB
    video: 512 * 1024 * 1024,     // 512 MB
    gif: 15 * 1024 * 1024,        // 15 MB
    document: 0,                   // Not supported
  },
  supportsThreads: true,
  supportsPolls: true,
  supportScheduling: false,        // Must be handled by our scheduler
  supportsEdit: false,             // Only for subscribers, limited
  supportsAltText: true,
  supportsHashtags: true,
  supportsMentions: true,
};
```

### X GetXAPI Provider (`x-getxapi.provider.ts`)

```typescript
// GetXAPI — https://docs.getxapi.com
// Auth: Simple Bearer token (API key)
// Rate limits: None (pay-per-call, ~$0.001/read, ~$0.002/write)
//
// Key endpoints (mapped to capability):
// POST /tweet/create               — Create tweet ($0.002)
// POST /tweet/like                  — Like ($0.002)
// POST /tweet/retweet               — Retweet ($0.002)
// GET  /tweet/detail                — Get tweet ($0.001)
// GET  /tweet/advanced_search       — Search ($0.001)
// GET  /user/info                   — User profile ($0.001)
//
// Limitations:
// - Write operations need fresh auth tokens (periodic re-auth)
// - No native thread creation API (chain via reply_to)
// - Media upload may require uploading through official API first
// - 502 errors possible on writes (X gateway rejection)
//
// This provider is used as FALLBACK for reads and cost-sensitive writes
const X_GETXAPI_CAPABILITIES: ProviderCapabilities = {
  maxTextLength: 280,
  maxMediaPerPost: 4,
  supportedMediaTypes: ['image', 'video', 'gif'],
  maxMediaSizeBytes: {
    image: 5 * 1024 * 1024,
    video: 512 * 1024 * 1024,
    gif: 15 * 1024 * 1024,
    document: 0,
  },
  supportsThreads: true,           // Via chained replies
  supportsPolls: false,            // Not available
  supportScheduling: false,
  supportsEdit: false,
  supportsAltText: false,          // Limited support
  supportsHashtags: true,
  supportsMentions: true,
};
```

### X Provider Router (`x-router.provider.ts`)

```typescript
// Routes X API calls between Official and GetXAPI providers
// Strategy:
//   1. Official API is DEFAULT for all write operations (post, like, retweet)
//   2. GetXAPI is FALLBACK when official API is rate-limited or returns 5xx
//   3. GetXAPI is PREFERRED for read operations (cheaper)
//   4. Circuit breaker pattern prevents cascading failures
//
// Routing rules:
// ┌─────────────────┬─────────────────┬──────────────────────────┐
// │ Operation       │ Default         │ Fallback                 │
// ├─────────────────┼─────────────────┼──────────────────────────┤
// │ Create post     │ Official        │ GetXAPI (if 429/5xx)     │
// │ Delete post     │ Official        │ None (official only)     │
// │ Like/Unlike     │ Official        │ GetXAPI (if 429/5xx)     │
// │ Repost          │ Official        │ GetXAPI (if 429/5xx)     │
// │ Comment         │ Official        │ GetXAPI (if 429/5xx)     │
// │ Upload media    │ Official        │ None (official only)     │
// │ Get post        │ GetXAPI         │ Official                 │
// │ Search          │ GetXAPI         │ Official                 │
// │ Get analytics   │ Official        │ None (not on GetXAPI)    │
// └─────────────────┴─────────────────┴──────────────────────────┘

interface CircuitBreakerConfig {
  failureThreshold: 5;             // Open circuit after 5 consecutive failures
  resetTimeoutMs: 60_000;          // Try again after 60s
  halfOpenMaxAttempts: 2;          // Allow 2 test requests when half-open
  monitorWindowMs: 120_000;        // Track failures within 2-minute windows
}
```

### LinkedIn Provider (`linkedin.provider.ts`)

```typescript
// LinkedIn API — Posts API (v2) + Share on LinkedIn (UGC)
// Auth: OAuth 2.0 (3-legged)
// Scopes: w_member_social, r_member_social, openid, profile
//
// Key endpoints:
// POST /rest/posts                             — Create post (new API)
// POST /v2/ugcPosts                            — Create post (legacy, still works)
// DELETE /rest/posts/{encoded_urn}              — Delete post
// POST /v2/assets?action=registerUpload        — Register media upload
// PUT  <uploadUrl>                             — Binary media upload
// POST /rest/posts (with reshareContext)        — Reshare
// POST /rest/socialActions/{urn}/comments       — Comment
// POST /rest/socialActions/{urn}/likes          — Like
//
// Required headers: X-Restli-Protocol-Version: 2.0.0, Linkedin-Version: YYYYMM
//
// Media upload flow:
// 1. Register upload → get uploadUrl + asset URN
// 2. PUT binary to uploadUrl
// 3. Reference asset URN in post creation
//
// Rate limits:
// - Member: 150 requests/day (creating posts)
// - Application: 100,000 requests/day
//
const LINKEDIN_CAPABILITIES: ProviderCapabilities = {
  maxTextLength: 3000,
  maxMediaPerPost: 9,              // Images; 1 for video
  supportedMediaTypes: ['image', 'video', 'document'],
  maxMediaSizeBytes: {
    image: 10 * 1024 * 1024,      // 10 MB
    video: 200 * 1024 * 1024,     // 200 MB (5GB for chunked)
    gif: 10 * 1024 * 1024,        // Treated as image
    document: 100 * 1024 * 1024,  // 100 MB PDF
  },
  supportsThreads: false,          // No native threads
  supportsPolls: true,             // Via Posts API
  supportScheduling: false,        // Must use our scheduler
  supportsEdit: true,              // commentary field editable
  supportsAltText: true,
  supportsHashtags: true,          // {hashtag|\#|tag} format
  supportsMentions: true,          // @[Name](urn:li:...) format
};
```

---

## 12. Authentication & OAuth Flows

### OAuth Flow Architecture

```
┌──────────┐     1. GET /accounts/connect/x     ┌──────────────┐
│  Agent   │ ─────────────────────────────────▶  │  Open Posting │
│  / CLI   │                                     │  API Server   │
│          │  ◀──── { authUrl, state }  ────────  │               │
└──────────┘                                     └───────┬───────┘
     │                                                    │
     │  2. User opens authUrl in browser                  │
     ▼                                                    │
┌──────────┐     3. User authorizes               ┌──────┴───────┐
│ Browser  │ ────────────────────────────────────▶ │  X / LinkedIn │
│          │                                       │  OAuth Server │
│          │  ◀──── redirect to callback ────────  │               │
└──────────┘                                       └──────┬───────┘
     │                                                    │
     │  4. GET /accounts/callback/x?code=...&state=...    │
     ▼                                                    │
┌──────────────┐  5. Exchange code for tokens    ┌────────┴──────┐
│  Open Posting │ ──────────────────────────────▶ │  X / LinkedIn  │
│  API Server   │                                 │  Token Server  │
│               │  ◀──── { access_token, ... } ── │                │
└──────────────┘                                  └───────────────┘
     │
     │  6. Store encrypted tokens, return account info
     ▼
┌──────────┐
│  Agent   │  ◀──── { accountId, platform, username, status }
└──────────┘
```

### Token Management

```typescript
interface TokenManager {
  // Store tokens encrypted with AES-256-GCM
  // Key derived from ENCRYPTION_KEY env var via HKDF
  storeTokens(accountId: string, tokens: TokenSet): Promise<void>;

  // Decrypt and return tokens
  getTokens(accountId: string): Promise<TokenSet>;

  // Proactive refresh: BullMQ repeatable job checks tokens
  // expiring within 30 minutes and refreshes them
  scheduleRefresh(accountId: string, expiresAt: Date): Promise<void>;

  // Handles refresh failure: marks account as 'expired',
  // emits webhook/event for agent notification
  handleRefreshFailure(accountId: string, error: Error): Promise<void>;
}

// Token refresh schedule:
// - Check every 15 minutes for tokens expiring within 30 minutes
// - Retry failed refresh 3 times with exponential backoff
// - After 3 failures: mark account as 'expired', notify via webhook
// - X OAuth tokens: 2-hour expiry, refresh via /2/oauth2/token
// - LinkedIn tokens: 60-day expiry, refresh via /oauth/v2/accessToken
```

### Security Requirements

| Requirement | Implementation |
|---|---|
| Token encryption at rest | AES-256-GCM, key from `ENCRYPTION_KEY` env var |
| Token encryption in transit | TLS 1.3 only |
| OAuth state validation | CSRF protection via cryptographic random state param |
| PKCE for X OAuth | code_verifier/code_challenge with S256 method |
| API key hashing | bcrypt (cost 12) for stored API keys |
| Rate limit on auth endpoints | 10 req/min per IP |
| Token rotation | New refresh token invalidates previous one |

---

## 13. Media Pipeline

### Upload Flow

```
┌──────────┐                    ┌──────────────┐                  ┌────────────┐
│  Client   │  1. POST /media   │ Open Posting │  3. Process      │  Rust NAPI │
│           │ ────────────────▶ │  API         │ ───────────────▶ │  Engine    │
│           │  (URL or binary)  │              │  (validate,      │            │
│           │                   │              │   resize, probe)  │            │
│           │  ◀──── mediaId ── │              │ ◀── metadata ──  │            │
└──────────┘                    └──────┬───────┘                  └────────────┘
                                       │
                              4. Store to disk
                                       │
                                       ▼
                                ┌──────────────┐
                                │ Local Volume  │
                                │ Storage       │
                                └──────────────┘
                                       │
                    When post is published, upload to platform:
                                       │
                    ┌──────────────────┬┴──────────────────┐
                    ▼                  ▼                    ▼
             ┌─────────────┐  ┌──────────────┐   ┌──────────────┐
             │ X Media API │  │ LinkedIn     │   │ [Future      │
             │ v1.1 chunked│  │ Upload API   │   │  platforms]  │
             └─────────────┘  └──────────────┘   └──────────────┘
```

### Media Processing (Rust Engine)

```rust
// Rust NAPI module handles:
// 1. Format detection (magic bytes, not extension)
// 2. Image: resize if > platform limits, strip EXIF, validate dimensions
// 3. Video: probe duration/resolution/codec via ffprobe bindings
// 4. GIF: validate frame count, file size
// 5. Content hash: SHA-256 for deduplication
// 6. Return metadata: width, height, duration, mimeType, sizeBytes, hash

#[napi]
pub struct MediaMetadata {
  pub mime_type: String,
  pub width: u32,
  pub height: u32,
  pub duration_ms: Option<u64>,
  pub size_bytes: u64,
  pub hash: String,
  pub needs_transcoding: bool,
}

#[napi]
pub fn probe_media(buffer: Buffer) -> Result<MediaMetadata> { ... }

#[napi]
pub fn resize_image(buffer: Buffer, max_width: u32, max_height: u32, quality: u8) -> Result<Buffer> { ... }
```

### Platform Upload Strategies

| Platform | Image Upload | Video Upload |
|---|---|---|
| **X (Official)** | POST `/1.1/media/upload.json` (INIT→APPEND→FINALIZE chunked flow) | Same chunked flow with `media_category=tweet_video`, async processing with STATUS polling |
| **X (GetXAPI)** | Must use official API for media upload, then reference media_id | Same — media upload always through official API |
| **LinkedIn** | 1. Register: `POST /v2/assets?action=registerUpload` 2. Upload: `PUT <uploadUrl>` with binary 3. Reference `asset` URN in post | Same flow with `feedshare-video` recipe, larger chunk support |

---

## 14. Scheduling Engine

### Architecture

```typescript
// BullMQ-based scheduler with exactly-once semantics
// Redis is the single source of truth for job state

interface SchedulerConfig {
  // Job processing
  maxConcurrency: 10;              // Parallel post publishing jobs
  maxRetries: 3;                   // Per-target retry attempts
  backoffType: 'exponential';      // 1s, 4s, 16s, ...
  maxBackoffMs: 300_000;           // 5 min max wait

  // Dead letter queue
  dlqEnabled: true;                // Failed jobs go to DLQ after max retries
  dlqRetentionDays: 30;            // Keep failed jobs for 30 days

  // Repeatable jobs
  tokenRefreshInterval: '*/15 * * * *';    // Every 15 min
  healthCheckInterval: '*/5 * * * *';      // Every 5 min
  analyticsCollectionInterval: '0 * * * *'; // Every hour
}
```

### Job Types

```typescript
type JobType =
  | 'publish_post'          // Publish a post to all targets
  | 'publish_target'        // Publish to a single platform target
  | 'upload_media'          // Upload media to a specific platform
  | 'refresh_token'         // Refresh an OAuth token
  | 'collect_analytics'     // Fetch post metrics from platforms
  | 'health_check';         // Check platform API availability

// Job flow for scheduled post:
// 1. POST /posts with scheduledAt → creates 'publish_post' delayed job
// 2. At scheduledAt, BullMQ activates 'publish_post' job
// 3. 'publish_post' fans out to N 'publish_target' child jobs (one per target)
// 4. Each 'publish_target' calls the provider, updates PostTarget status
// 5. Parent 'publish_post' completes when all children complete
// 6. If any child fails: parent status → 'partially_failed'
// 7. Failed children are retried per backoff config
// 8. After max retries: child moves to DLQ, PostTarget.status → 'failed'
```

### Exactly-Once Delivery

```typescript
// Guarantee: A post is published to each platform exactly once, even if:
// - Server restarts mid-publish
// - Redis connection drops
// - Platform API returns ambiguous response

// Mechanism:
// 1. Idempotency key stored in Post record
// 2. Before publish: check PostTarget.platformPostId — if set, skip
// 3. BullMQ job ID = deterministic hash of (postId + targetId)
// 4. Redis SETNX guard before platform API call
// 5. Platform response stored in PostTarget before job completion
// 6. On restart: BullMQ replays in-progress jobs, idempotency check prevents duplication
```

---

## 15. Rate Limiting & Fallback Strategy

### Multi-Layer Rate Limiting

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: API Gateway (Hono middleware)                       │
│ - Per API key: 100 req/min (configurable)                   │
│ - Per IP: 20 req/min for unauthenticated endpoints          │
│ - Uses Redis sliding window counter                         │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Platform Rate Limit Tracker                         │
│ - Tracks remaining quota per platform per account           │
│ - Pre-check before making platform API call                 │
│ - X Official: tracks per-endpoint 15-min windows            │
│ - X GetXAPI: no limits (cost tracking instead)              │
│ - LinkedIn: tracks 150 member posts/day, 100K app/day       │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Provider Router (Circuit Breaker)                   │
│ - Monitors provider health per-account                      │
│ - Automatic fallback when primary provider fails            │
│ - Reports remaining capacity to callers                     │
└─────────────────────────────────────────────────────────────┘
```

### X API Fallback Strategy

```typescript
// Decision tree for X API routing:
//
// Is this a WRITE operation (post, like, retweet)?
// ├─ YES
// │  ├─ Is Official API available? (circuit closed + quota remaining)
// │  │  ├─ YES → Use Official API
// │  │  └─ NO → Is GetXAPI available?
// │  │     ├─ YES → Use GetXAPI (warn: may have higher failure rate)
// │  │     └─ NO → Return PROVIDER_FALLBACK_EXHAUSTED error
// │  └─ On failure:
// │     ├─ 429 Rate Limited → Record, try GetXAPI if not already tried
// │     ├─ 5xx Server Error → Record failure in circuit breaker, try GetXAPI
// │     └─ 4xx Client Error → Return error (don't fallback, client issue)
// │
// Is this a READ operation (get post, search, analytics)?
// ├─ YES
// │  ├─ Is this analytics? → Official API only (not available on GetXAPI)
// │  ├─ Use GetXAPI (cheaper, $0.001/call)
// │  │  ├─ Success → Return result
// │  │  └─ Failure → Fallback to Official API
// │  └─ Both fail → Return PROVIDER_FALLBACK_EXHAUSTED error

// Cost tracking:
interface CostTracker {
  recordApiCall(provider: ApiProvider, operation: 'read' | 'write', cost: number): void;
  getDailyCost(provider: ApiProvider): number;
  getProjectedMonthlyCost(provider: ApiProvider): number;
  // Exposed via GET /health/providers for monitoring
}
```

---

## 16. Observability & Reliability

### Structured Logging

```typescript
// All logs are structured JSON via pino
// Every request gets a unique requestId that propagates through all layers
{
  "level": "info",
  "time": "2026-03-22T15:30:00.000Z",
  "requestId": "req_01HWX...",
  "service": "api",
  "event": "post.publish.success",
  "postId": "post_01HWX...",
  "platform": "x",
  "provider": "official",
  "latencyMs": 1247,
  "platformPostId": "1234567890"
}
```

### Metrics (OpenTelemetry)

```
# Counters
open_posting_posts_created_total{platform, status}
open_posting_posts_published_total{platform, provider, status}
open_posting_api_calls_total{platform, provider, operation, status_code}
open_posting_api_cost_dollars{provider}
open_posting_media_uploads_total{platform, media_type, status}
open_posting_engagement_actions_total{platform, action, status}

# Histograms
open_posting_publish_latency_seconds{platform, provider}
open_posting_media_upload_latency_seconds{platform, media_type}
open_posting_api_request_duration_seconds{route, method}

# Gauges
open_posting_active_accounts{platform, status}
open_posting_scheduled_posts_pending
open_posting_circuit_breaker_state{provider}  # 0=closed, 1=half-open, 2=open
open_posting_rate_limit_remaining{platform, provider, endpoint}
```

### Health Checks

```typescript
// GET /health → 200 if all critical services up
// GET /health/ready → 200 if ready to accept traffic
// GET /health/providers → detailed provider status

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  checks: {
    database: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down'; latencyMs: number };
    storage: { status: 'up' | 'down'; latencyMs: number };
    providers: {
      [key: string]: {
        status: 'up' | 'degraded' | 'down';
        circuitState: 'closed' | 'half-open' | 'open';
        latencyMs: number;
        rateLimitRemaining?: number;
      };
    };
  };
}
```

### Alerting Rules (for Grafana/Prometheus)

| Alert | Condition | Severity |
|---|---|---|
| Provider Down | Circuit breaker open > 5 min | Critical |
| High Error Rate | > 10% publish failures in 5 min | Warning |
| Token Expiry | Account token expires in < 1 hour and refresh failing | Warning |
| Queue Backlog | > 100 jobs delayed > 5 min | Warning |
| Storage Full | Object storage > 90% capacity | Critical |
| DLQ Growing | > 10 jobs in dead letter queue | Warning |

---

## 17. Security

### Threat Model & Mitigations

| Threat | Mitigation |
|---|---|
| API key theft | Keys hashed with bcrypt, prefix-only stored for identification. Rotate via CLI. |
| OAuth token theft | AES-256-GCM encryption at rest. Decryption key in env var, never in DB. |
| Token replay | Short-lived access tokens, refresh rotation, platform token binding. |
| Injection via post content | Content passed through to platform APIs as-is (platforms handle rendering). Input validated for size limits only. |
| SSRF via media URL | URL validation: block private IPs, localhost, link-local. DNS resolution check before fetch. |
| DoS on API | Per-key and per-IP rate limiting at gateway. BullMQ concurrency caps. |
| Privilege escalation | Workspace isolation: all queries scoped by workspaceId. Row-level security in Postgres. |
| Supply chain | Lockfile pinning, npm audit in CI, Dependabot alerts. |
| Secret leakage in logs | pino redaction paths for tokens, keys, passwords. |

### Encryption Architecture

```
┌─────────────────────────────────────────────┐
│ ENCRYPTION_KEY (env var)                     │
│ 256-bit key, set by operator                │
└──────────────────────┬──────────────────────┘
                       │ HKDF derive
                       ▼
┌──────────────────────────────────────────────┐
│ Per-record encryption                         │
│ Algorithm: AES-256-GCM                        │
│ IV: 12 bytes random per encryption            │
│ Auth tag: 16 bytes                            │
│ Storage: base64(iv + ciphertext + authTag)    │
└──────────────────────────────────────────────┘
```

---

## 18. Deployment & Infrastructure

### Docker Compose (Local Development)

```yaml
# docker-compose.yml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: api
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://openposting:openposting@postgres:5432/openposting
      - REDIS_URL=redis://redis:6379
      - MEDIA_STORAGE_PATH=/data/media
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - X_CLIENT_ID=${X_CLIENT_ID}
      - X_CLIENT_SECRET=${X_CLIENT_SECRET}
      - X_GETXAPI_KEY=${X_GETXAPI_KEY}
      - LINKEDIN_CLIENT_ID=${LINKEDIN_CLIENT_ID}
      - LINKEDIN_CLIENT_SECRET=${LINKEDIN_CLIENT_SECRET}
      - PUBLIC_URL=http://localhost:3000
    volumes:
      - mediadata:/data/media
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  mcp:
    build:
      context: .
      dockerfile: Dockerfile
      target: mcp
    environment:
      - API_URL=http://api:3000
      - API_KEY=${MCP_API_KEY}
    depends_on:
      - api

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: openposting
      POSTGRES_USER: openposting
      POSTGRES_PASSWORD: openposting
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openposting"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  redisdata:
  mediadata:
```

### Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/
COPY apps/*/package.json ./apps/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules
COPY . .
RUN pnpm turbo build

# Stage 2: API server
FROM base AS api
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server.js"]

# Stage 3: MCP server
FROM base AS mcp
COPY --from=builder /app/apps/mcp/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/server.js"]
```

### Railway Deployment

```toml
# railway.toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[[services]]
name = "api"
dockerfile = "Dockerfile"
target = "api"

[[services]]
name = "postgres"
plugin = "postgresql"

[[services]]
name = "redis"
plugin = "redis"
```

### Environment Variables

```bash
# === Required ===
DATABASE_URL=postgresql://user:pass@host:5432/openposting
REDIS_URL=redis://host:6379
ENCRYPTION_KEY=<64-char-hex-string>            # Generate: openssl rand -hex 32
PUBLIC_URL=https://your-domain.com             # For OAuth callbacks

# === X (Twitter) — Official API ===
X_CLIENT_ID=<from developer.x.com>
X_CLIENT_SECRET=<from developer.x.com>
X_BEARER_TOKEN=<app-only bearer token>

# === X (Twitter) — GetXAPI (Fallback) ===
X_GETXAPI_KEY=<from getxapi.com>

# === LinkedIn ===
LINKEDIN_CLIENT_ID=<from linkedin developer portal>
LINKEDIN_CLIENT_SECRET=<from linkedin developer portal>

# === Media Storage ===
MEDIA_STORAGE_PATH=/data/media                  # Local filesystem path (Docker volume / Railway volume)
MEDIA_MAX_STORAGE_GB=10                         # Max storage per workspace in GB (default 10)
MEDIA_SERVE_BASE_URL=                           # Base URL for serving media (defaults to PUBLIC_URL/media)

# === Optional ===
LOG_LEVEL=info                                  # debug | info | warn | error
API_RATE_LIMIT=100                             # requests per minute per key
PORT=3000
OTEL_EXPORTER_OTLP_ENDPOINT=                   # OpenTelemetry collector URL
WEBHOOK_URL=                                    # Webhook for post status updates
```

---

## 19. Database Schema

### Drizzle Schema

```typescript
import { pgTable, text, timestamp, jsonb, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { ulid } from 'ulid';

// === Workspaces ===
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  apiKeyPrefix: text('api_key_prefix').notNull(),      // First 8 chars for identification
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('workspaces_api_key_prefix_idx').on(table.apiKeyPrefix),
]);

// === Social Accounts ===
export const socialAccounts = pgTable('social_accounts', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),                 // 'x' | 'linkedin'
  platformUserId: text('platform_user_id').notNull(),
  platformUsername: text('platform_username').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  accessTokenEnc: text('access_token_enc').notNull(),   // AES-256-GCM encrypted
  refreshTokenEnc: text('refresh_token_enc'),           // AES-256-GCM encrypted
  tokenExpiresAt: timestamp('token_expires_at'),
  scopes: jsonb('scopes').$type<string[]>().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  provider: text('provider').notNull().default('official'),
  status: text('status').notNull().default('active'),   // active | expired | revoked
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('social_accounts_workspace_idx').on(table.workspaceId),
  uniqueIndex('social_accounts_platform_user_idx').on(table.workspaceId, table.platform, table.platformUserId),
]);

// === Posts ===
export const posts = pgTable('posts', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),
  content: jsonb('content').$type<PostContent>().notNull(),
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

// === Media ===
export const media = pgTable('media', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                         // image | video | gif | document
  storageUrl: text('storage_url').notNull(),            // Local file path relative to MEDIA_STORAGE_PATH
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  altText: text('alt_text'),
  hash: text('hash').notNull(),                         // SHA-256 for dedup
  platformUploads: jsonb('platform_uploads').$type<Record<string, { status: string; platformMediaId?: string; error?: string }>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('media_workspace_idx').on(table.workspaceId),
  index('media_hash_idx').on(table.hash),
]);

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

// === Webhook Events (outbox pattern) ===
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),              // post.published, post.failed, account.expired, etc.
  payload: jsonb('payload').notNull(),
  deliveredAt: timestamp('delivered_at'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('webhook_events_undelivered_idx').on(table.deliveredAt),
]);
```

---

## 20. Testing Strategy

### Test Pyramid

```
         ┌─────────┐
         │  E2E    │  5%  — Full OAuth flow, publish to sandbox
         │         │       accounts, verify on platform
         ├─────────┤
         │ Integr- │  25% — Provider implementations against
         │ ation   │       platform API sandboxes/mocks,
         │         │       DB queries, Redis jobs
         ├─────────┤
         │  Unit   │  70% — Business logic, content validation,
         │         │       rate limit calculations, provider
         │         │       routing, error handling
         └─────────┘
```

### Testing Infrastructure

| Layer | Tool | Approach |
|---|---|---|
| Unit | Vitest | Fast, in-memory, mock providers |
| Integration | Vitest + Testcontainers | Real Postgres/Redis in Docker |
| E2E | Playwright + platform sandboxes | Full flow with X sandbox + LinkedIn test apps |
| Load | k6 | Simulate 1000 concurrent agent requests |
| Contract | MSW (Mock Service Worker) | Mock platform APIs with real response shapes |

### Platform Test Strategy

| Platform | Test Environment |
|---|---|
| X Official | X API sandbox (free tier), test account |
| X GetXAPI | GetXAPI test key, low-cost calls |
| LinkedIn | LinkedIn Developer app in test mode (developer admins only) |

### CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint typecheck

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo test:unit

  test-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: openposting_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo test:integration

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v6
        with:
          push: false
          tags: open-posting:test
```

---

## 21. Phase Rollout Plan

### Phase 1: Foundation (Weeks 1-4)

| Week | Deliverables |
|---|---|
| **1** | Monorepo setup, Drizzle schema, Docker Compose, basic Hono server with health endpoints, CI pipeline |
| **2** | OAuth flows for X (Official) and LinkedIn, token encryption, workspace/API key management |
| **3** | X Official provider: create post, thread, like, comment, repost. Media upload (image). Content validation. |
| **4** | LinkedIn provider: create post (text, image, video, article), comment, like. MCP server (stdio). CLI MVP. |

### Phase 2: Resilience (Weeks 5-6)

| Week | Deliverables |
|---|---|
| **5** | X GetXAPI provider, provider router with circuit breaker, fallback logic, cost tracking. BullMQ scheduler for scheduling and token refresh. |
| **6** | Rate limit tracking, idempotency, dead letter queue, retry logic, webhook events. Observability: structured logging, OpenTelemetry metrics. |

### Phase 3: Analytics & Dashboard (Weeks 7-10)

| Week | Deliverables |
|---|---|
| **7** | Analytics engine: X metrics (public_metrics, non_public_metrics, organic_metrics), LinkedIn metrics (socialMetadata, shareStatistics). Snapshot collection jobs. Unified analytics schema. |
| **8** | Analytics API endpoints, MCP analytics tools (get_post_analytics, get_account_analytics, compare_accounts, query_analytics). Analytics DB tables and time-series storage. CLI analytics commands. |
| **9** | Web dashboard MVP: accounts page (connect/manage/multi-account), compose page (rich editor, media drag-drop, platform previews, account group selector), post list with status indicators. |
| **10** | Dashboard analytics views: metric cards, engagement charts, top posts, LinkedIn audience insights. Calendar view for scheduling. Media library with compatibility indicators. |

### Phase 4: Polish (Weeks 11-12)

| Week | Deliverables |
|---|---|
| **11** | OpenClaw skill files, MCP SSE transport, SDK package, comprehensive test suite. Account groups, labeling, health scores. |
| **12** | Railway deployment template, production Docker image, documentation, load testing, security audit. |

### Phase 5: Expansion (Post-Launch)

| Priority | Platform | Complexity |
|---|---|---|
| 1 | Bluesky | Low (AT Protocol, good docs) |
| 2 | Threads | Medium (Meta API, requires app review) |
| 3 | Instagram | Medium (Graph API, media-heavy) |
| 4 | Facebook Pages | Medium (Graph API, same auth as Instagram) |
| 5 | TikTok | High (video-only, complex upload) |
| 6 | YouTube | High (complex video pipeline) |
| 7 | Reddit | Low (simple API) |
| 8 | Medium / Dev.to | Low (article APIs) |
| 9 | Mastodon | Low (ActivityPub standard) |

---

## 22. Multi-Account Management & User Experience

### Design Philosophy

Open Posting serves **two distinct user personas simultaneously**:

1. **Human users** who manage multiple social accounts across brands, clients, or personal profiles
2. **AI agents/LLMs** that need programmatic, deterministic access to social platforms

The system must deliver a **rich, intuitive experience for humans** while maintaining **machine-efficient structured I/O for agents**. Every feature must work through both the web dashboard AND the API/MCP/CLI — no feature is UI-only or API-only.

### Multi-Account Architecture

#### Core Principle: Unlimited Accounts Per Platform

A single workspace can connect **unlimited accounts on the same platform**. A social media manager running 5 X accounts and 3 LinkedIn profiles gets a unified view across all of them.

```
Workspace: "Acme Agency"
├── X Accounts
│   ├── @acme_official     (brand account)
│   ├── @acme_support      (support account)
│   ├── @john_at_acme      (personal/founder)
│   ├── @acme_engineering  (engineering blog)
│   └── @acme_careers      (recruiting)
├── LinkedIn Accounts
│   ├── Acme Corp (Organization Page)
│   ├── John Doe (Personal Profile)
│   └── Jane Smith (Personal Profile)
└── [Future: Instagram, Threads, etc.]
```

#### Account Data Model (Extended)

```typescript
interface SocialAccount {
  id: string;                       // ULID
  workspaceId: string;
  platform: Platform;
  platformUserId: string;
  platformUsername: string;          // @handle for X, vanity URL for LinkedIn
  displayName: string;              // Human-readable name
  avatarUrl: string | null;         // Cached locally + CDN
  bio: string | null;               // Profile description
  followerCount: number | null;     // Cached, refreshed hourly
  followingCount: number | null;
  postCount: number | null;
  accountType: AccountType;         // 'personal' | 'organization' | 'brand'

  // === Auth ===
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];

  // === Multi-Provider (X only) ===
  providers: {
    official?: {
      enabled: boolean;
      rateLimitRemaining: number | null;
      rateLimitResetsAt: Date | null;
    };
    getxapi?: {
      enabled: boolean;
      costAccumulatedToday: number;
    };
  };

  // === User Experience ===
  color: string;                    // User-assigned color for visual identification
  nickname: string | null;          // User-assigned label ("Client: Nike", "Personal")
  tags: string[];                   // Organizational tags ["client:nike", "team:marketing"]
  isDefault: boolean;               // Default account for this platform
  sortOrder: number;                // User-defined display order

  // === Health ===
  status: AccountStatus;
  lastHealthCheck: Date | null;
  lastPostAt: Date | null;
  lastSyncAt: Date | null;          // Last time profile data was refreshed
  healthScore: number;              // 0-100 based on token freshness, rate limits, recent errors

  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

type AccountType = 'personal' | 'organization' | 'brand';
```

### OAuth Login Flow — Frictionless UX

#### Flow 1: Web Dashboard (Human Users)

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard                              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          Connect a New Account                       │    │
│  │                                                      │    │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────────┐     │    │
│  │   │  ╔═══╗   │  │  🔗 in   │  │  [Coming     │     │    │
│  │   │  ║ X ║   │  │ LinkedIn │  │   Soon]      │     │    │
│  │   │  ╚═══╝   │  │          │  │  Instagram   │     │    │
│  │   │ Connect  │  │ Connect  │  │  Threads     │     │    │
│  │   └──────────┘  └──────────┘  └──────────────┘     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Already connected (3):                                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🟢 @acme_official  │ X       │ Active  │ [Manage]  │    │
│  │ 🟢 @john_at_acme   │ X       │ Active  │ [Manage]  │    │
│  │ 🟡 Acme Corp       │ LinkedIn│ Expires │ [Refresh] │    │
│  │                     │         │ in 5d   │           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  + Connect another account                                   │
└─────────────────────────────────────────────────────────────┘
```

**Key UX decisions:**
- One-click platform selection → instant OAuth redirect
- No form fields before OAuth — minimize friction
- Post-OAuth: auto-detect account type (personal vs org), fetch profile picture + bio
- Color auto-assigned from platform palette; user can customize
- "Add another" button always visible — encourage multi-account usage
- Token expiry warnings shown proactively (amber at 7 days, red at 24 hours)
- One-click re-auth when tokens expire (pre-fills the same account)

#### Flow 2: CLI (Developer / Agent Users)

```bash
# Connect first X account
$ op accounts connect x
🔗 Opening browser for X authorization...
   → https://twitter.com/i/oauth2/authorize?client_id=...

   Waiting for callback... ✓

✅ Connected: @acme_official (X)
   Account ID: acc_01HWX7...
   Type: Organization
   Followers: 12,400

# Connect ANOTHER X account (same platform, different user)
$ op accounts connect x
🔗 Opening browser for X authorization...
   ⚠️  Tip: Make sure you're logged into the correct X account
        in your browser before authorizing.

   Waiting for callback... ✓

✅ Connected: @john_at_acme (X)
   Account ID: acc_01HWX8...
   Type: Personal
   Followers: 3,200

# List all accounts with visual indicators
$ op accounts list
┌────────────────┬──────────┬────────────────┬────────┬─────────┐
│ ID             │ Platform │ Handle         │ Status │ Health  │
├────────────────┼──────────┼────────────────┼────────┼─────────┤
│ acc_01HWX7...  │ X        │ @acme_official │ Active │ 98/100  │
│ acc_01HWX8...  │ X        │ @john_at_acme  │ Active │ 100/100 │
│ acc_01HWX9...  │ LinkedIn │ Acme Corp      │ Active │ 85/100  │
└────────────────┴──────────┴────────────────┴────────┴─────────┘

# Set default account per platform
$ op accounts default acc_01HWX7
✅ @acme_official is now the default X account.

# Post from a SPECIFIC account (not default)
$ op post create --text "Hello from John!" --accounts acc_01HWX8

# Post the SAME content from MULTIPLE accounts simultaneously
$ op post create --text "Big announcement!" --accounts acc_01HWX7,acc_01HWX8,acc_01HWX9
```

#### Flow 3: MCP / LLM (AI Agent Users)

```typescript
// Agent asks: "Post this to all my X accounts"
// MCP tool: list_accounts → returns all accounts
// Agent selects relevant ones → create_post with multiple account IDs

// The MCP server provides rich context to help the agent decide:
{
  "tool": "list_accounts",
  "result": {
    "accounts": [
      {
        "id": "acc_01HWX7",
        "platform": "x",
        "username": "@acme_official",
        "displayName": "Acme Official",
        "type": "organization",
        "followerCount": 12400,
        "nickname": "Brand Account",
        "tags": ["brand", "primary"],
        "isDefault": true,
        "healthScore": 98,
        "rateLimitRemaining": 45,
        "lastPostAt": "2026-03-22T10:00:00Z"
      },
      {
        "id": "acc_01HWX8",
        "platform": "x",
        "username": "@john_at_acme",
        "displayName": "John Doe",
        "type": "personal",
        "followerCount": 3200,
        "nickname": "Founder Personal",
        "tags": ["personal", "founder"],
        "isDefault": false,
        "healthScore": 100,
        "rateLimitRemaining": 50,
        "lastPostAt": "2026-03-21T18:30:00Z"
      }
    ]
  }
}
// Agent has enough context to make intelligent decisions about which account to use
```

### Account Grouping & Workspaces

```typescript
// Users can create logical groups for batch operations
interface AccountGroup {
  id: string;
  workspaceId: string;
  name: string;                     // "All Brand Accounts", "Client: Nike"
  description: string | null;
  accountIds: string[];             // Ordered list of account IDs in this group
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

// Use in API:
// POST /posts { targets: [{ groupId: "grp_01HWX..." }] }
// This expands to all accounts in the group

// Use in CLI:
// op post create --text "Hello!" --group "All Brand Accounts"

// Use in MCP:
// create_post({ text: "Hello!", groups: ["grp_01HWX..."] })
```

### Account Health Monitoring

```typescript
// Background job runs every 15 minutes
interface AccountHealthCheck {
  // Token validity: is the token still valid? When does it expire?
  tokenValid: boolean;
  tokenExpiresIn: number;           // seconds until expiry

  // Rate limit status: how much quota remains?
  rateLimitStatus: {
    official?: { remaining: number; limit: number; resetsAt: Date };
    getxapi?: { dailyCost: number; projectedMonthlyCost: number };
  };

  // Connectivity: can we reach the platform API?
  apiReachable: boolean;
  apiLatencyMs: number;

  // Account status: is the account still active on the platform?
  accountActive: boolean;           // Not suspended/deactivated

  // Computed health score (0-100)
  healthScore: number;

  // Actionable issues for the user
  issues: Array<{
    severity: 'critical' | 'warning' | 'info';
    code: string;
    message: string;
    action: string;                 // "Re-authenticate", "Upgrade API tier", etc.
  }>;
}
```

---

## 23. Comprehensive Media Pipeline — Deep Dive

### Media Types & Platform Compatibility Matrix

| Media Type | Format | X (Official) | X (GetXAPI) | LinkedIn | Max Size | Notes |
|---|---|---|---|---|---|---|
| **Static Image** | JPEG | 4 per post | 4 per post | 9 per post | X: 5MB, LI: 10MB | Most compatible |
| **Static Image** | PNG | 4 per post | 4 per post | 9 per post | X: 5MB, LI: 10MB | Supports transparency |
| **Static Image** | WEBP | 4 per post | 4 per post | N/A | X: 5MB | X supports, LinkedIn doesn't |
| **Static Image** | GIF (static) | 4 per post | 4 per post | 9 per post | X: 5MB, LI: 10MB | Treated as image |
| **Animated GIF** | GIF | 1 per post | 1 per post | N/A | X: 15MB | Counts as video on X |
| **Video** | MP4 (H.264) | 1 per post | N/A (use official) | 1 per post | X: 512MB, LI: 200MB | Primary video format |
| **Video** | MOV | N/A | N/A | 1 per post | LI: 200MB | LinkedIn only |
| **Document** | PDF | N/A | N/A | 1 per post | LI: 100MB | LinkedIn carousel/document |
| **Document** | PPT/PPTX | N/A | N/A | 1 per post | LI: 100MB | Auto-converted to carousel |

### Complete Media Upload Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     MEDIA INGESTION                               │
│                                                                   │
│  Three entry points:                                              │
│                                                                   │
│  1. URL Fetch          2. Direct Upload       3. Base64 Inline    │
│     (agent provides       (CLI/dashboard         (MCP tool        │
│      image URL)           file picker)           for small imgs)  │
│                                                                   │
│  POST /media/upload     POST /media/upload    POST /media/upload  │
│  { url: "https://..." } multipart/form-data   { base64: "..." }  │
│                                                                   │
└───────────┬──────────────────┬──────────────────┬────────────────┘
            │                  │                  │
            ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    MEDIA VALIDATION LAYER                         │
│                    (Rust NAPI Engine)                             │
│                                                                   │
│  Step 1: Magic Byte Detection                                     │
│  ├─ Read first 16 bytes → determine true MIME type                │
│  ├─ Reject if MIME doesn't match claimed type                    │
│  ├─ Reject if file is empty or corrupt                            │
│  └─ Map to internal MediaType enum                                │
│                                                                   │
│  Step 2: Security Scan                                            │
│  ├─ SSRF protection: block private IPs, localhost, link-local    │
│  ├─ DNS rebinding protection: resolve + verify IP before fetch   │
│  ├─ File size pre-check via HEAD request (before downloading)    │
│  ├─ SVG/HTML injection scan (reject if <script> found in images) │
│  └─ Malicious payload detection (polyglot file check)            │
│                                                                   │
│  Step 3: Metadata Extraction                                      │
│  ├─ Image: width, height, color space, DPI, EXIF data            │
│  ├─ Video: duration, resolution, codec, bitrate, framerate       │
│  ├─ GIF: frame count, loop count, total duration                 │
│  ├─ Document: page count, file format version                    │
│  └─ All: SHA-256 content hash for deduplication                  │
│                                                                   │
│  Step 4: EXIF & Metadata Stripping                               │
│  ├─ Strip GPS coordinates (privacy)                               │
│  ├─ Strip camera serial numbers (privacy)                        │
│  ├─ Preserve color profile (ICC) for rendering accuracy          │
│  └─ Preserve IPTC caption if alt text not provided               │
│                                                                   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    MEDIA PROCESSING LAYER                         │
│                    (Rust NAPI Engine)                             │
│                                                                   │
│  Image Processing:                                                │
│  ├─ Auto-resize if exceeds platform max dimensions               │
│  │   X: 4096x4096 max, LinkedIn: 7680x4320 max                  │
│  ├─ Format conversion: WEBP→JPEG for LinkedIn (no WEBP support)  │
│  ├─ Quality optimization: maintain visual quality at smaller size │
│  ├─ Generate thumbnails: 150px, 300px, 600px for preview         │
│  └─ Generate blurhash for placeholder loading                    │
│                                                                   │
│  Video Processing:                                                │
│  ├─ Codec detection: verify H.264/AAC for X, broader for LI     │
│  ├─ Duration check: X free=140s, premium=4hr, LinkedIn=15min     │
│  ├─ Resolution check: X=1920x1200, LinkedIn=4096x2304            │
│  ├─ Bitrate analysis: flag if too high for reliable upload       │
│  ├─ Generate poster frame at 1s mark for thumbnail               │
│  └─ Probe via ffprobe (Rust bindings) — no actual transcoding    │
│      (transcoding deferred to platform-specific upload step)      │
│                                                                   │
│  GIF Processing:                                                  │
│  ├─ Frame count check (X rejects GIFs > certain frames)          │
│  ├─ Size optimization: lossy GIF compression if > 5MB            │
│  └─ Duration calculation from frame delays                       │
│                                                                   │
│  Document Processing:                                             │
│  ├─ PDF: page count, detect if text-based or scanned             │
│  ├─ PPT: slide count, convert to PDF if needed for LinkedIn      │
│  └─ Generate first-page thumbnail for preview                    │
│                                                                   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    MEDIA STORAGE LAYER                            │
│                    (Local Filesystem / Docker & Railway Volumes)   │
│                                                                   │
│  Storage root: $MEDIA_STORAGE_PATH (default: /data/media)        │
│                                                                   │
│  Directory structure:                                              │
│  /{workspace_id}/                                                │
│    ├── originals/{media_id}/{filename}     # Unmodified upload    │
│    ├── processed/{media_id}/{filename}     # Optimized version    │
│    ├── thumbnails/{media_id}/              # Multiple sizes       │
│    │   ├── 150.jpg                                                │
│    │   ├── 300.jpg                                                │
│    │   └── 600.jpg                                                │
│    └── poster/{media_id}/poster.jpg        # Video poster frame  │
│                                                                   │
│  Deployment options:                                               │
│  ├─ Railway: Railway persistent volumes mounted at /data/media   │
│  │   (Railway Premium supports up to 100GB persistent storage)    │
│  ├─ Docker (local/self-hosted): Named Docker volume `mediadata`  │
│  │   mapped to /data/media inside the container                   │
│  └─ Bare metal: Any local filesystem path                        │
│                                                                   │
│  Media serving:                                                    │
│  ├─ API serves files via GET /api/v1/media/:id/file endpoint     │
│  ├─ Streaming response with proper Content-Type headers           │
│  ├─ ETag-based caching for browser cache hit optimization        │
│  ├─ Optional: put Nginx/Caddy in front for static file serving   │
│  └─ Dashboard uploads via multipart POST to /api/v1/media        │
│                                                                   │
│  Features:                                                        │
│  ├─ Deduplication via SHA-256 hash (same file = same storage)    │
│  ├─ BullMQ cron job: delete originals after 90 days              │
│  ├─ Automatic cleanup: orphaned media (not attached to any post) │
│  │   deleted after 24 hours via scheduled job                     │
│  └─ Total storage quota per workspace (configurable, default 10GB│
│                                                                   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                PLATFORM UPLOAD LAYER                              │
│         (Triggered when post is published, NOT at upload time)    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ X Official — Chunked Media Upload (v1.1)                │     │
│  │                                                          │     │
│  │ Step 1: INIT                                             │     │
│  │   POST /1.1/media/upload.json                            │     │
│  │   { command: "INIT",                                     │     │
│  │     total_bytes: 2048576,                                │     │
│  │     media_type: "image/jpeg",                            │     │
│  │     media_category: "tweet_image" }                      │     │
│  │   → Returns: { media_id: "710511363345354753" }          │     │
│  │                                                          │     │
│  │ Step 2: APPEND (chunked, 5MB chunks)                     │     │
│  │   POST /1.1/media/upload.json                            │     │
│  │   { command: "APPEND",                                   │     │
│  │     media_id: "710511363345354753",                      │     │
│  │     segment_index: 0,                                    │     │
│  │     media_data: <base64_chunk> }                         │     │
│  │   (Repeat for each chunk)                                │     │
│  │                                                          │     │
│  │ Step 3: FINALIZE                                         │     │
│  │   POST /1.1/media/upload.json                            │     │
│  │   { command: "FINALIZE",                                 │     │
│  │     media_id: "710511363345354753" }                     │     │
│  │   → Returns: { processing_info?: { state, check_after }} │     │
│  │                                                          │     │
│  │ Step 4: STATUS (for video/GIF — async processing)        │     │
│  │   GET /1.1/media/upload.json?command=STATUS&media_id=... │     │
│  │   → Poll until processing_info.state = "succeeded"       │     │
│  │   → Exponential backoff: 1s, 2s, 4s, 8s, max 30s        │     │
│  │   → Timeout after 10 minutes → mark as failed            │     │
│  │                                                          │     │
│  │ Step 5: ALT TEXT (optional but recommended)              │     │
│  │   POST /1.1/media/metadata/create.json                   │     │
│  │   { media_id: "...", alt_text: { text: "Description" } } │     │
│  │                                                          │     │
│  │ media_category values:                                   │     │
│  │   tweet_image, tweet_gif, tweet_video,                   │     │
│  │   dm_image, dm_gif, dm_video, subtitles                  │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ LinkedIn — Register + Upload Flow                        │     │
│  │                                                          │     │
│  │ Step 1: Register Upload                                  │     │
│  │   POST /v2/assets?action=registerUpload                  │     │
│  │   { registerUploadRequest: {                             │     │
│  │       recipes: ["urn:li:digitalmediaRecipe:              │     │
│  │                  feedshare-image"],                       │     │
│  │       owner: "urn:li:person:8675309",                    │     │
│  │       serviceRelationships: [{                           │     │
│  │         relationshipType: "OWNER",                       │     │
│  │         identifier: "urn:li:userGeneratedContent"        │     │
│  │       }]                                                 │     │
│  │   }}                                                     │     │
│  │   → Returns: { uploadUrl, asset URN }                    │     │
│  │                                                          │     │
│  │   Recipe values:                                         │     │
│  │     feedshare-image, feedshare-video,                    │     │
│  │     feedshare-document                                   │     │
│  │                                                          │     │
│  │ Step 2: Binary Upload                                    │     │
│  │   PUT <uploadUrl>                                        │     │
│  │   Authorization: Bearer <token>                          │     │
│  │   Body: <raw binary file>                                │     │
│  │                                                          │     │
│  │ Step 3: Reference in Post                                │     │
│  │   POST /rest/posts                                       │     │
│  │   { content: { media: {                                  │     │
│  │       id: "urn:li:image:C5522AQ...",                     │     │
│  │       title: "Image title"                               │     │
│  │   }}}                                                    │     │
│  │                                                          │     │
│  │ Multi-image: Upload each → use multiImage content type   │     │
│  │ Video: Same flow with feedshare-video recipe             │     │
│  │ Document: Same flow with feedshare-document recipe       │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ GetXAPI (X Fallback) — Media Limitation                  │     │
│  │                                                          │     │
│  │ GetXAPI does NOT have its own media upload endpoint.     │     │
│  │ Strategy:                                                │     │
│  │ 1. Always upload media via X Official API (v1.1)         │     │
│  │ 2. Obtain media_id from official upload                  │     │
│  │ 3. If using GetXAPI for the tweet creation, pass the     │     │
│  │    same media_id — it's valid across both APIs since     │     │
│  │    the media is associated with the X account, not       │     │
│  │    the API consumer.                                     │     │
│  │ 4. If official API is completely down (can't upload      │     │
│  │    media), fall back to text-only post via GetXAPI       │     │
│  │    and return warning: MEDIA_UPLOAD_DEGRADED             │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Media API Endpoints (Extended)

```
POST   /media/upload              # Upload from URL, file, or base64
POST   /media/upload/presigned    # Get presigned URL for direct browser upload
GET    /media/:id                 # Get media metadata, thumbnails, platform upload status
GET    /media/:id/thumbnail/:size # Get thumbnail (150, 300, 600)
DELETE /media/:id                 # Delete media and all derivatives
POST   /media/:id/alt-text        # Set/update alt text
GET    /media                     # List workspace media (paginated, filterable)
POST   /media/bulk-upload         # Upload multiple files at once (max 10)
```

#### Upload Request — Full Schema

```typescript
interface MediaUploadRequest {
  // Source (exactly one required)
  url?: string;                      // Fetch from URL (agent-friendly)
  base64?: string;                   // Inline base64 data (small images from LLMs)
  // OR multipart/form-data with 'file' field (dashboard/CLI)

  // Metadata
  altText?: string;                  // Accessibility text (recommended, max 1000 chars)
  type?: MediaType;                  // Hint: 'image' | 'video' | 'gif' | 'document'
                                     // Auto-detected if not provided
  title?: string;                    // Display title (used by LinkedIn)
  description?: string;              // Description (used by LinkedIn articles)

  // Processing options
  autoOptimize?: boolean;            // Default: true. Resize/compress for platforms.
  preserveOriginal?: boolean;        // Default: true. Keep original in storage.
  targetPlatforms?: Platform[];      // Pre-validate against these platforms' limits
}

interface MediaUploadResponse {
  id: string;                        // Media ID to reference in posts
  type: MediaType;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  altText: string | null;
  hash: string;                      // SHA-256 for client dedup
  thumbnails: {
    small: string;                   // 150px URL
    medium: string;                  // 300px URL
    large: string;                   // 600px URL
  };
  posterUrl: string | null;          // Video poster frame
  blurhash: string | null;           // Placeholder hash for loading states
  platformCompatibility: {
    [platform: string]: {
      compatible: boolean;
      issues: string[];              // e.g., ["File too large", "Format not supported"]
      autoConvertible: boolean;      // Can we auto-fix the issues?
    };
  };
  url: string;                       // CDN URL for the processed file
  originalUrl: string;               // CDN URL for the original file
  expiresAt: string;                 // When the media will be auto-deleted if unused
}
```

### Media in MCP (Agent-Optimized)

```typescript
// MCP tool: upload_media
// Agents can provide media by URL (most common) or base64
// The tool returns rich metadata so the agent knows exactly what it's working with

{
  name: "upload_media",
  description: "Upload media (image, video, GIF, document) for use in social media posts. " +
    "Provide a URL to any publicly accessible image or video. " +
    "Returns a media ID to reference when creating posts, plus compatibility info for each platform. " +
    "Supports: JPEG, PNG, WEBP, GIF, MP4, MOV, PDF, PPTX. " +
    "Images auto-resized, videos validated for codec/duration. " +
    "Alt text is strongly recommended for accessibility.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public URL of the media file to upload. Supports image URLs, video URLs, and direct file links."
      },
      base64: {
        type: "string",
        description: "Base64-encoded file content. Use for small images (<2MB). Include data URI prefix: 'data:image/png;base64,...'"
      },
      altText: {
        type: "string",
        description: "Alt text for accessibility. Strongly recommended. Max 1000 characters. Describe what the image shows."
      },
      title: {
        type: "string",
        description: "Title for the media (used in LinkedIn document/video posts)"
      },
      targetPlatforms: {
        type: "array",
        items: { type: "string", enum: ["x", "linkedin"] },
        description: "Platforms you plan to post this to. Returns compatibility warnings if the media won't work."
      }
    }
  }
}

// MCP tool: create_post (media section enhanced)
// When an agent creates a post with media, it can:
// 1. Reference previously uploaded media by ID
// 2. Provide URLs inline (auto-uploaded during post creation)
// 3. Mix both approaches

{
  name: "create_post",
  inputSchema: {
    properties: {
      media: {
        type: "array",
        maxItems: 9,
        items: {
          type: "object",
          properties: {
            mediaId: {
              type: "string",
              description: "ID from a previous upload_media call"
            },
            url: {
              type: "string",
              description: "URL to auto-upload. Slower than pre-uploading but more convenient for single-use media."
            },
            altText: {
              type: "string",
              description: "Override alt text for this specific post (if different from upload-time alt text)"
            }
          }
        },
        description: "Media attachments. Max 4 images for X, 9 for LinkedIn. 1 video or GIF replaces all images."
      }
    }
  }
}
```

---

## 24. Analytics & Insights Engine

### Design Principle

Every metric that a social platform makes available through its API must be **queryable through Open Posting**. Users and agents should never need to visit the native platform to check engagement numbers. The analytics system is both a **real-time query proxy** AND a **historical data warehouse**.

### Analytics Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANALYTICS CONSUMERS                            │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Dashboard │  │ LLM (MCP) │  │   CLI    │  │ REST Client   │  │
│  │ Charts & │  │ "How did  │  │ op stats │  │ GET /analytics │  │
│  │ Tables   │  │  my post  │  │          │  │               │  │
│  │          │  │  perform?" │  │          │  │               │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └──────┬────────┘  │
└───────┼──────────────┼──────────────┼───────────────┼────────────┘
        │              │              │               │
        └──────────────┴──────────────┴───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ANALYTICS SERVICE LAYER                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Unified Analytics Query Engine               │    │
│  │                                                          │    │
│  │  • Normalizes platform-specific metrics to common schema │    │
│  │  • Handles cache-then-fetch pattern                      │    │
│  │  • Aggregates cross-platform metrics                     │    │
│  │  • Supports time-range queries with granularity control  │    │
│  │  • Handles pagination for historical data                │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                         │                                        │
│  ┌─────────────────────┴───────────────────────────────────┐    │
│  │              Analytics Cache Layer (Redis)                │    │
│  │                                                          │    │
│  │  • Hot metrics cached for 5 minutes (real-time feel)     │    │
│  │  • Historical snapshots cached for 1 hour                │    │
│  │  • Account-level aggregates cached for 15 minutes        │    │
│  │  • Cache warming: BullMQ job fetches top posts hourly    │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                         │                                        │
│  ┌─────────────────────┴───────────────────────────────────┐    │
│  │           Analytics Persistence (PostgreSQL)              │    │
│  │                                                          │    │
│  │  • Snapshots of metrics at regular intervals             │    │
│  │  • Enables trend analysis ("likes over time")            │    │
│  │  • Historical data survives platform API changes         │    │
│  │  • Supports complex queries agents might ask             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PLATFORM ANALYTICS PROVIDERS                     │
│                                                                  │
│  ┌────────────────────────────┐  ┌────────────────────────────┐ │
│  │ X Analytics Provider        │  │ LinkedIn Analytics Provider │ │
│  │                             │  │                             │ │
│  │ GET /2/tweets/:id           │  │ GET /rest/socialMetadata/   │ │
│  │   ?tweet.fields=            │  │   {shareUrn}               │ │
│  │   public_metrics,           │  │ → reactionSummaries        │ │
│  │   non_public_metrics,       │  │   (LIKE, PRAISE, EMPATHY,  │ │
│  │   organic_metrics           │  │    MAYBE, INTEREST,        │ │
│  │                             │  │    APPRECIATION)           │ │
│  │ Public metrics:             │  │ → commentSummary           │ │
│  │   • retweet_count           │  │   (count, topLevelCount)   │ │
│  │   • reply_count             │  │                             │ │
│  │   • like_count              │  │ GET /rest/organizationalE-  │ │
│  │   • quote_count             │  │   ntityShareStatistics     │ │
│  │   • bookmark_count          │  │ → clickCount               │ │
│  │   • impression_count        │  │ → commentCount             │ │
│  │                             │  │ → engagement (rate)        │ │
│  │ Non-public metrics:         │  │ → impressionCount          │ │
│  │   • impression_count        │  │ → likeCount                │ │
│  │   • url_link_clicks         │  │ → shareCount               │ │
│  │   • user_profile_clicks     │  │ → uniqueImpressionsCount   │ │
│  │                             │  │                             │ │
│  │ Organic metrics:            │  │ Time-bound: DAY or MONTH   │ │
│  │   • impression_count        │  │ granularity with date      │ │
│  │   • url_link_clicks         │  │ range filters.             │ │
│  │   • user_profile_clicks     │  │ Rolling 12-month window.   │ │
│  │   • retweet_count           │  │                             │ │
│  │   • reply_count             │  │ Per-post & aggregate stats │ │
│  │   • like_count              │  │ supported.                 │ │
│  │                             │  │                             │ │
│  │ Video metrics (if video):   │  │ Batch get: up to 20 posts  │ │
│  │   • view_count              │  │ per request.               │ │
│  │   • playback_0_count        │  │                             │ │
│  │   • playback_25_count       │  │ LinkedIn Reactions types:  │ │
│  │   • playback_50_count       │  │   LIKE     → "Like"        │ │
│  │   • playback_75_count       │  │   PRAISE   → "Celebrate"   │ │
│  │   • playback_100_count      │  │   MAYBE    → "Curious"     │ │
│  │                             │  │   EMPATHY  → "Love"        │ │
│  │ GetXAPI read fallback:      │  │   INTEREST → "Insightful"  │ │
│  │   GET /tweet/detail          │  │   APPRECIATION → "Support" │ │
│  │   → basic engagement counts │  │                             │ │
│  └────────────────────────────┘  └────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Unified Analytics Schema

```typescript
// All platform metrics normalized to a single schema
// Platform-specific fields preserved in 'platformSpecific' for full fidelity

interface PostAnalytics {
  postId: string;                    // Open Posting post ID
  targets: PostTargetAnalytics[];    // Per-platform breakdown
  aggregate: AggregateMetrics;       // Cross-platform totals
  fetchedAt: string;                 // ISO 8601 — when this data was retrieved
  cacheAge: number;                  // Seconds since last platform API fetch
}

interface PostTargetAnalytics {
  socialAccountId: string;
  platform: Platform;
  platformPostId: string;
  platformPostUrl: string;

  // === Universal Metrics (all platforms) ===
  metrics: {
    impressions: number;             // Total views/impressions
    uniqueImpressions: number | null; // Unique viewers (LinkedIn)
    reach: number | null;            // Unique accounts that saw the post

    likes: number;                   // Total likes/favorites
    comments: number;                // Total comments/replies
    shares: number;                  // Reposts/reshares/retweets
    saves: number | null;            // Bookmarks (X) / Saves

    clicks: number | null;           // Total clicks (links + profile + media)
    linkClicks: number | null;       // URL clicks specifically
    profileClicks: number | null;    // Profile visits from this post

    engagementRate: number | null;   // (interactions / impressions) × 100
    totalEngagements: number;        // Sum of all interactions

    quotes: number | null;           // Quote tweets (X only)
  };

  // === Video Metrics (if media type is video) ===
  videoMetrics: {
    views: number;                   // Total video views
    viewDuration: {                  // Viewership retention
      pct0: number | null;          // Started watching
      pct25: number | null;         // Watched 25%
      pct50: number | null;         // Watched 50%
      pct75: number | null;         // Watched 75%
      pct100: number | null;        // Watched 100%
    };
    averageWatchTime: number | null; // Seconds
  } | null;

  // === Platform-Specific (full fidelity) ===
  platformSpecific: {
    x?: {
      publicMetrics: {
        retweetCount: number;
        replyCount: number;
        likeCount: number;
        quoteCount: number;
        bookmarkCount: number;
        impressionCount: number;
      };
      nonPublicMetrics?: {           // Requires user auth
        impressionCount: number;
        urlLinkClicks: number;
        userProfileClicks: number;
      };
      organicMetrics?: {
        impressionCount: number;
        urlLinkClicks: number;
        userProfileClicks: number;
        retweetCount: number;
        replyCount: number;
        likeCount: number;
      };
      promotedMetrics?: {            // If promoted
        impressionCount: number;
        urlLinkClicks: number;
        userProfileClicks: number;
        retweetCount: number;
        replyCount: number;
        likeCount: number;
      };
    };
    linkedin?: {
      reactionSummaries: {
        LIKE: number;
        PRAISE: number;
        EMPATHY: number;
        MAYBE: number;
        INTEREST: number;
        APPRECIATION: number;
      };
      commentSummary: {
        count: number;
        topLevelCount: number;
      };
      shareStatistics: {
        clickCount: number;
        commentCount: number;
        engagement: number;
        impressionCount: number;
        likeCount: number;
        shareCount: number;
        uniqueImpressionsCount: number;
      };
    };
  };
}

interface AggregateMetrics {
  totalImpressions: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalClicks: number;
  totalEngagements: number;
  weightedEngagementRate: number;    // Impressions-weighted average
  platformBreakdown: {
    [platform: string]: {
      impressions: number;
      engagements: number;
      engagementRate: number;
    };
  };
}
```

### Account-Level Analytics

```typescript
interface AccountAnalytics {
  socialAccountId: string;
  platform: Platform;
  username: string;

  // === Profile Metrics ===
  profile: {
    followers: number;
    following: number;
    postCount: number;
    followerGrowth: {               // Change over time
      last24h: number;
      last7d: number;
      last30d: number;
    };
  };

  // === Posting Performance ===
  performance: {
    timeRange: { start: string; end: string };
    postsPublished: number;
    totalImpressions: number;
    totalEngagements: number;
    averageEngagementRate: number;
    bestPerformingPost: {
      postId: string;
      platformPostUrl: string;
      text: string;                  // First 100 chars
      impressions: number;
      engagementRate: number;
    } | null;
    worstPerformingPost: {
      postId: string;
      platformPostUrl: string;
      text: string;
      impressions: number;
      engagementRate: number;
    } | null;
  };

  // === Time Series Data ===
  timeSeries: Array<{
    date: string;                    // ISO 8601 date
    impressions: number;
    engagements: number;
    followers: number;
    postsPublished: number;
  }>;

  // === LinkedIn Specific: Organization Statistics ===
  linkedinOrgStats?: {
    followerStatistics: {
      totalFollowers: number;
      organicFollowers: number;
      paidFollowers: number;
      byFunction: Record<string, number>;      // {Engineering: 500, Marketing: 300}
      bySeniority: Record<string, number>;     // {Senior: 200, Entry: 150}
      byIndustry: Record<string, number>;      // {Technology: 400, Finance: 200}
      byRegion: Record<string, number>;        // {US: 300, UK: 100}
    };
    pageStatistics: {
      views: { desktop: number; mobile: number };
      uniqueVisitors: number;
      clicksOnJobs: number;
    };
  };
}
```

### Analytics API Endpoints

```
# === Post Analytics ===
GET /analytics/posts/:postId                    # Single post metrics
GET /analytics/posts/:postId/history            # Metrics snapshots over time
GET /analytics/posts/bulk?ids=id1,id2,id3       # Batch post metrics (max 50)

# === Account Analytics ===
GET /analytics/accounts/:accountId              # Account overview + performance
GET /analytics/accounts/:accountId/followers    # Follower growth time series
GET /analytics/accounts/:accountId/top-posts    # Best performing posts
GET /analytics/accounts/:accountId/time-series  # Daily/weekly/monthly aggregates
  ?granularity=day|week|month
  &start=2026-01-01
  &end=2026-03-22

# === Cross-Platform Analytics ===
GET /analytics/workspace                        # Aggregate across all accounts
GET /analytics/workspace/compare                # Side-by-side platform comparison
  ?accountIds=acc1,acc2
  &start=2026-03-01
  &end=2026-03-22

# === Real-time ===
GET /analytics/posts/:postId/live               # SSE stream of live metric updates
                                                 # (polls platform every 60s, pushes diffs)
```

### Analytics MCP Tools

```typescript
const ANALYTICS_MCP_TOOLS = [
  {
    name: "get_post_analytics",
    description: "Get detailed engagement metrics for a published post. Returns likes, comments, shares, impressions, clicks, engagement rate, and video metrics if applicable. Data is cross-platform normalized plus raw platform-specific metrics. Ask follow-up questions to analyze trends.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Open Posting post ID" },
        includeHistory: {
          type: "boolean",
          description: "Include historical snapshots to see how metrics changed over time. Default: false."
        }
      },
      required: ["postId"]
    }
  },
  {
    name: "get_account_analytics",
    description: "Get performance analytics for a social media account: follower growth, posting frequency, average engagement rate, best/worst performing posts, and time-series data. For LinkedIn organization pages, also returns follower demographics (industry, seniority, region).",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Social account ID" },
        timeRange: {
          type: "string",
          enum: ["24h", "7d", "30d", "90d", "365d", "all"],
          description: "Time range for analytics. Default: 30d."
        },
        includeTopPosts: {
          type: "boolean",
          description: "Include top 5 best and worst performing posts. Default: true."
        },
        includeTimeSeries: {
          type: "boolean",
          description: "Include daily time-series data for charts. Default: false."
        }
      },
      required: ["accountId"]
    }
  },
  {
    name: "compare_accounts",
    description: "Compare performance across multiple social accounts side by side. Useful for comparing X vs LinkedIn performance, or comparing multiple accounts on the same platform.",
    inputSchema: {
      type: "object",
      properties: {
        accountIds: {
          type: "array",
          items: { type: "string" },
          description: "Account IDs to compare (2-10)"
        },
        timeRange: {
          type: "string",
          enum: ["7d", "30d", "90d"],
          description: "Comparison time range. Default: 30d."
        },
        metrics: {
          type: "array",
          items: { type: "string", enum: ["impressions", "engagements", "engagementRate", "followers", "posts"] },
          description: "Which metrics to compare. Default: all."
        }
      },
      required: ["accountIds"]
    }
  },
  {
    name: "query_analytics",
    description: "Run a natural language analytics query. Examples: 'What was my best performing post this month?', 'Which platform gives me more engagement?', 'How has my follower count changed in the last 90 days?', 'Show me posts with over 1000 impressions'. Returns structured data the LLM can interpret.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language analytics question"
        },
        accountIds: {
          type: "array",
          items: { type: "string" },
          description: "Scope the query to specific accounts. Omit for all accounts."
        }
      },
      required: ["query"]
    }
  }
];
```

### Analytics Data Collection (Background Jobs)

```typescript
// BullMQ repeatable jobs for analytics data collection

const ANALYTICS_JOBS = {
  // Collect metrics for recently published posts (< 7 days old)
  // Frequency: Every 30 minutes
  // Rationale: Metrics change rapidly in the first week
  collectRecentPostMetrics: {
    repeat: { every: 30 * 60 * 1000 },  // 30 min
    filter: 'posts published within last 7 days',
    action: 'Fetch metrics from platform APIs, store snapshot in analytics_snapshots table',
  },

  // Collect metrics for older posts (7-90 days)
  // Frequency: Every 6 hours
  // Rationale: Metrics stabilize after first week
  collectOlderPostMetrics: {
    repeat: { every: 6 * 60 * 60 * 1000 },  // 6 hours
    filter: 'posts published 7-90 days ago',
    action: 'Fetch metrics, store snapshot',
  },

  // Collect account-level metrics (followers, profile stats)
  // Frequency: Every 1 hour
  collectAccountMetrics: {
    repeat: { every: 60 * 60 * 1000 },  // 1 hour
    action: 'Fetch follower count, profile stats for all active accounts',
  },

  // LinkedIn organization statistics (if org page connected)
  // Frequency: Every 4 hours
  collectLinkedInOrgStats: {
    repeat: { every: 4 * 60 * 60 * 1000 },
    action: 'Fetch org share statistics, follower demographics, page views',
  },

  // Cleanup old snapshots (> 1 year)
  // Frequency: Daily at 3 AM UTC
  cleanupOldSnapshots: {
    repeat: { pattern: '0 3 * * *' },
    action: 'Aggregate daily snapshots into weekly, delete raw hourly data > 90 days',
  },
};
```

### Analytics Database Tables

```typescript
// === Metrics Snapshots (time-series data) ===
export const analyticsSnapshots = pgTable('analytics_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  postTargetId: text('post_target_id').notNull().references(() => postTargets.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),

  // Normalized metrics
  impressions: integer('impressions').notNull().default(0),
  uniqueImpressions: integer('unique_impressions'),
  likes: integer('likes').notNull().default(0),
  comments: integer('comments').notNull().default(0),
  shares: integer('shares').notNull().default(0),
  saves: integer('saves'),
  clicks: integer('clicks'),
  linkClicks: integer('link_clicks'),
  profileClicks: integer('profile_clicks'),
  quotes: integer('quotes'),
  engagementRate: real('engagement_rate'),

  // Video metrics
  videoViews: integer('video_views'),
  videoPct25: integer('video_pct_25'),
  videoPct50: integer('video_pct_50'),
  videoPct75: integer('video_pct_75'),
  videoPct100: integer('video_pct_100'),

  // Raw platform response (full fidelity)
  rawMetrics: jsonb('raw_metrics'),

  snapshotAt: timestamp('snapshot_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('analytics_snapshots_target_time_idx').on(table.postTargetId, table.snapshotAt),
  index('analytics_snapshots_platform_time_idx').on(table.platform, table.snapshotAt),
]);

// === Account Metrics History ===
export const accountMetricsHistory = pgTable('account_metrics_history', {
  id: text('id').primaryKey().$defaultFn(() => ulid()),
  socialAccountId: text('social_account_id').notNull().references(() => socialAccounts.id, { onDelete: 'cascade' }),
  followers: integer('followers').notNull(),
  following: integer('following').notNull(),
  postCount: integer('post_count').notNull(),

  // LinkedIn org-specific
  orgPageViews: integer('org_page_views'),
  orgUniqueVisitors: integer('org_unique_visitors'),
  orgFollowersByFunction: jsonb('org_followers_by_function'),
  orgFollowersBySeniority: jsonb('org_followers_by_seniority'),
  orgFollowersByIndustry: jsonb('org_followers_by_industry'),
  orgFollowersByRegion: jsonb('org_followers_by_region'),

  snapshotAt: timestamp('snapshot_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('account_metrics_account_time_idx').on(table.socialAccountId, table.snapshotAt),
]);

// === Analytics Query Cache ===
export const analyticsCache = pgTable('analytics_cache', {
  key: text('key').primaryKey(),             // Hash of query parameters
  value: jsonb('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## 25. Web Dashboard — Complete User Experience

### Design Philosophy

The dashboard is **NOT** a bolted-on afterthought — it's a first-class interface that shares the exact same REST API as agents and CLI. Every action in the dashboard calls the same API. If something works in the dashboard, it works from the CLI. If an agent can do it, a human can do it in the UI. Zero feature divergence.

The dashboard serves the human user who may be:
- A solo creator managing 2-3 personal accounts
- A social media manager handling 10+ brand accounts
- A marketing team lead overseeing scheduled content across clients
- A developer testing their AI agent's posting behavior

### Tech Stack (Dashboard)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR for fast first load, RSC for data fetching |
| UI Library | shadcn/ui + Tailwind CSS 4 | Customizable, accessible, consistent |
| State | TanStack Query v5 | Cache management, optimistic updates, SSE subscriptions |
| Charts | Recharts | Lightweight, React-native charting |
| Forms | React Hook Form + Zod | Same Zod schemas as API validation |
| Real-time | SSE (EventSource) | Live analytics, post status, emergency stop events |
| DnD | dnd-kit | Drag-and-drop for media reorder, calendar reschedule |
| Dates | date-fns + Temporal API | Timezone-aware scheduling |
| Notifications | Sonner | Toast system for publish confirmations, errors |
| Keyboard | cmdk | Command palette for power users (Ctrl+K) |

### Global Navigation & Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌─ TOP BAR ─────────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  🔲 OPEN POSTING    [Ctrl+K Search...]                            │  │
│  │                                                                    │  │
│  │  Workspace: Acme Agency ▼                                          │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │ 🔴 EMERGENCY STOP   │ Active queues: 3 │ [API Keys] [⚙️]   │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ SIDEBAR ──┐  ┌─ MAIN CONTENT AREA ─────────────────────────────┐  │
│  │             │  │                                                   │  │
│  │ 📊 Overview │  │  (Dynamic — changes per page)                     │  │
│  │             │  │                                                   │  │
│  │ ✏️  Compose  │  │                                                   │  │
│  │  └ New Post │  │                                                   │  │
│  │  └ Thread   │  │                                                   │  │
│  │             │  │                                                   │  │
│  │ 📋 Content  │  │                                                   │  │
│  │  └ All Posts│  │                                                   │  │
│  │  └ Drafts   │  │                                                   │  │
│  │  └ Scheduled│  │                                                   │  │
│  │  └ Published│  │                                                   │  │
│  │  └ Failed   │  │                                                   │  │
│  │             │  │                                                   │  │
│  │ 📅 Calendar │  │                                                   │  │
│  │             │  │                                                   │  │
│  │ 📈 Analytics│  │                                                   │  │
│  │  └ Overview │  │                                                   │  │
│  │  └ Posts    │  │                                                   │  │
│  │  └ Accounts │  │                                                   │  │
│  │  └ Compare  │  │                                                   │  │
│  │             │  │                                                   │  │
│  │ 🖼️  Media   │  │                                                   │  │
│  │             │  │                                                   │  │
│  │ 👤 Accounts │  │                                                   │  │
│  │  └ Connected│  │                                                   │  │
│  │  └ Groups   │  │                                                   │  │
│  │  └ Health   │  │                                                   │  │
│  │             │  │                                                   │  │
│  │ ⚙️  Settings │  │                                                   │  │
│  │  └ API Keys │  │                                                   │  │
│  │  └ Webhooks │  │                                                   │  │
│  │  └ Workspace│  │                                                   │  │
│  │             │  │                                                   │  │
│  │ 📜 Activity │  │                                                   │  │
│  │    Log      │  │                                                   │  │
│  │             │  │                                                   │  │
│  └─────────────┘  └───────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### Page 1: Overview Dashboard (Home)

```
┌──────────────────────────────────────────────────────────────────┐
│  Overview                                     [7d] [30d] [90d]  │
│                                                                   │
│  ┌─ Emergency Banner (shown when active) ─────────────────────┐  │
│  │  🔴 EMERGENCY STOP ACTIVE — All publishing halted.          │  │
│  │     3 scheduled posts paused. 0 in-flight posts cancelled.  │  │
│  │     Activated by: john@acme.com at 2026-03-22 14:32 UTC     │  │
│  │     [Resume All Publishing]  [View Affected Posts]           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Metric Cards ────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  Total Impressions    Engagements    Eng. Rate   Followers │   │
│  │  ┌──────────────┐  ┌────────────┐  ┌──────────┐ ┌───────┐│   │
│  │  │   245,820    │  │   8,432    │  │  3.43%   │ │15,847 ││   │
│  │  │   ▲ +12.3%   │  │  ▲ +8.7%   │  │ ▲ +0.5%  │ │▲+1247 ││   │
│  │  │  vs last 30d │  │ vs last 30d│  │vs last 30│ │vs 30d ││   │
│  │  └──────────────┘  └────────────┘  └──────────┘ └───────┘│   │
│  │                                                            │   │
│  │  Posts Published     Scheduled       Failed      Drafts    │   │
│  │  ┌──────────────┐  ┌────────────┐  ┌──────────┐ ┌───────┐│   │
│  │  │     47       │  │    12      │  │    2     │ │   5   ││   │
│  │  │  ▲ +8 more   │  │  next 7d   │  │ ⚠️ retry │ │       ││   │
│  │  └──────────────┘  └────────────┘  └──────────┘ └───────┘│   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Engagement Over Time ─────────────────────────────────────┐  │
│  │  [Area chart — impressions as filled area, engagement line] │  │
│  │  Toggle: [All] [X only] [LinkedIn only]                     │  │
│  │                                                              │  │
│  │       ╱╲    ╱╲╲                                             │  │
│  │  ━━━╱━━╲━╱━━━╲━━╱━━━━━━━━━━                               │  │
│  │    ╱    ╲╱     ╲╱                                           │  │
│  │  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                               │  │
│  │  Mar 1      Mar 8      Mar 15     Mar 22                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Account Health ─────────────────┬─ Recent Activity ─────────┐│
│  │                                   │                            ││
│  │ 🟢 @acme_official  98/100       │ 📤 Published "New prod..." ││
│  │    X · 12.4K followers           │    3 min ago → X, LinkedIn  ││
│  │                                   │                            ││
│  │ 🟢 @john_at_acme   100/100      │ 📤 Published "Thread:..."  ││
│  │    X · 3.2K followers            │    1 hr ago → X (5 tweets)  ││
│  │                                   │                            ││
│  │ 🟡 Acme Corp       72/100       │ ⏰ Scheduled "Q1 results"  ││
│  │    LinkedIn · Token expires 5d   │    for Mar 25, 9:00 AM PST  ││
│  │    [Refresh Token]               │                            ││
│  │                                   │ ❌ Failed "Weekly update"  ││
│  │ 🟢 John Doe        95/100       │    2 hrs ago · Rate limited ││
│  │    LinkedIn · 1.8K connections   │    [Retry] [View Details]   ││
│  │                                   │                            ││
│  │ [Manage Accounts →]              │ [View Full Activity Log →]  ││
│  └───────────────────────────────────┴────────────────────────────┘│
│                                                                   │
│  ┌─ Upcoming Scheduled Posts ─────────────────────────────────┐  │
│  │                                                              │  │
│  │  Today                                                       │  │
│  │  ├─ 3:00 PM  "Product update..."  @acme_official, Acme LI  │  │
│  │  └─ 5:30 PM  "Evening thread..."  @acme_official            │  │
│  │                                                              │  │
│  │  Tomorrow (Mar 23)                                           │  │
│  │  ├─ 9:00 AM  "Monday motivation"  @john_at_acme             │  │
│  │  └─ 2:00 PM  "Case study..."      All Brand Accounts (grp) │  │
│  │                                                              │  │
│  │  [View Full Calendar →]                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 2: Compose — Post Editor

```
┌──────────────────────────────────────────────────────────────────┐
│  Compose New Post                     [Save Draft] [Discard]     │
│                                                                   │
│  ┌─ Posting to ──────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │ ┌─ X Accounts ─────────────────────────────────────────┐  │   │
│  │ │ [✓] 🟢 @acme_official  │ Brand · 12.4K followers    │  │   │
│  │ │ [ ] 🟢 @john_at_acme   │ Personal · 3.2K followers  │  │   │
│  │ │ [ ] 🟢 @acme_support   │ Support · 890 followers    │  │   │
│  │ │ [Select All X]                                        │  │   │
│  │ └──────────────────────────────────────────────────────┘  │   │
│  │                                                            │   │
│  │ ┌─ LinkedIn Accounts ──────────────────────────────────┐  │   │
│  │ │ [✓] 🟡 Acme Corp       │ Org Page · 8.1K followers  │  │   │
│  │ │ [ ] 🟢 John Doe        │ Personal · 1.8K connections│  │   │
│  │ │ [Select All LinkedIn]                                 │  │   │
│  │ └──────────────────────────────────────────────────────┘  │   │
│  │                                                            │   │
│  │ Quick: [All Brand Accounts ▼] [Client: Nike ▼] [Custom]  │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Content ─────────────────────────────────────────────────┐   │
│  │  [Tab: Shared] [Tab: X Override] [Tab: LinkedIn Override] │   │
│  │                                                            │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ We're thrilled to announce our latest product       │   │   │
│  │  │ launch! After months of development, Open Posting   │   │   │
│  │  │ is here to revolutionize how AI agents interact     │   │   │
│  │  │ with social media.                                  │   │   │
│  │  │                                                     │   │   │
│  │  │ Read more: https://openposting.dev/launch           │   │   │
│  │  │                                                     │   │   │
│  │  │ #OpenPosting #AIAgents #SocialMedia                 │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                                                            │   │
│  │  Character counts:                                         │   │
│  │  X: 247/280 ⚠️ (close to limit)                           │   │
│  │  LinkedIn: 247/3,000 ✅                                    │   │
│  │                                                            │   │
│  │  ┌─ Media ──────────────────────────────────────────────┐ │   │
│  │  │                                                       │ │   │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐  │ │   │
│  │  │  │  📷     │  │  📷     │  │                      │  │ │   │
│  │  │  │ launch  │  │ team    │  │  + Add Media         │  │ │   │
│  │  │  │ .png    │  │ .jpg    │  │  Drop files here     │  │ │   │
│  │  │  │ ✅ X,LI │  │ ⚠️ no alt│  │  or click to browse │  │ │   │
│  │  │  │ [×]     │  │ [×]     │  │  or paste URL        │  │ │   │
│  │  │  └─────────┘  └─────────┘  └─────────────────────┘  │ │   │
│  │  │  ↕ Drag to reorder                                   │ │   │
│  │  │                                                       │ │   │
│  │  │  Alt text for team.jpg: [                         ]   │ │   │
│  │  │  ⚠️ Missing alt text reduces accessibility            │ │   │
│  │  └───────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Schedule ────────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  (•) Publish immediately                                   │   │
│  │  ( ) Schedule for later                                    │   │
│  │      [Mar 25, 2026]  [9:00 AM]  [PST (UTC-8) ▼]          │   │
│  │                                                            │   │
│  │  💡 Suggested: Tuesday 9:00 AM PST — your audience is     │   │
│  │     most active on Tuesdays (avg 4.8% engagement)         │   │
│  │                                                            │   │
│  │  ( ) Add to queue (publish next available slot)            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Live Preview ────────────────────────────────────────────┐   │
│  │  [Tab: X Preview]  [Tab: LinkedIn Preview]                 │   │
│  │                                                            │   │
│  │  ┌── X Preview ──────────────────────────────────────┐    │   │
│  │  │  ┌───┐ Acme Official @acme_official · now          │    │   │
│  │  │  │ 🟦│                                             │    │   │
│  │  │  └───┘ We're thrilled to announce our latest       │    │   │
│  │  │       product launch! After months of development, │    │   │
│  │  │       Open Posting is here to revolutionize how    │    │   │
│  │  │       AI agents interact with social media.        │    │   │
│  │  │                                                     │    │   │
│  │  │       Read more: openposting.dev/launch            │    │   │
│  │  │                                                     │    │   │
│  │  │       ┌───────────────────────────────────┐        │    │   │
│  │  │       │  [launch.png]     [team.jpg]      │        │    │   │
│  │  │       └───────────────────────────────────┘        │    │   │
│  │  │                                                     │    │   │
│  │  │       💬 0    🔁 0    ❤️ 0    📊 0    🔖 0          │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  [Save as Draft]          [Schedule for Mar 25] / [Publish]│   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 3: Compose — Thread Builder (X)

```
┌──────────────────────────────────────────────────────────────────┐
│  Thread Builder (X)                         [Save Draft] [Post]  │
│                                                                   │
│  Account: @acme_official ▼                                        │
│                                                                   │
│  ┌─ Tweet 1 of 4 ───────────────────────────────────────────┐   │
│  │  🔵 Here's everything we learned building Open Posting,   │   │
│  │     an AI-native social media tool.                       │   │
│  │                                                            │   │
│  │     A thread 🧵👇                                          │   │
│  │                                                            │   │
│  │  📷 [header.png]  [×]                      128/280 ✅     │   │
│  └────────────────────────────────────────────────────────────┘   │
│        │                                                          │
│        ▼                                                          │
│  ┌─ Tweet 2 of 4 ───────────────────────────────────────────┐   │
│  │  1/ The problem: Every AI agent that wants to post on     │   │
│  │     social media needs to implement OAuth, handle rate    │   │
│  │     limits, manage media uploads, and deal with           │   │
│  │     platform-specific formatting. Separately. Every time. │   │
│  │                                                            │   │
│  │                                                 241/280 ⚠️ │   │
│  └────────────────────────────────────────────────────────────┘   │
│        │                                                          │
│        ▼                                                          │
│  ┌─ Tweet 3 of 4 ───────────────────────────────────────────┐   │
│  │  2/ Our solution: A universal access layer. One API call  │   │
│  │     → published everywhere. Built-in MCP server so any    │   │
│  │     LLM can use it natively.                              │   │
│  │                                                            │   │
│  │  📷 [architecture.png]  [×]                 156/280 ✅    │   │
│  │  [↑ Move Up] [↓ Move Down] [× Delete Tweet]              │   │
│  └────────────────────────────────────────────────────────────┘   │
│        │                                                          │
│        ▼                                                          │
│  ┌─ Tweet 4 of 4 ───────────────────────────────────────────┐   │
│  │  3/ We're open source and launching today. Try it now:    │   │
│  │     https://openposting.dev                               │   │
│  │                                                            │   │
│  │     Star us on GitHub ⭐                                   │   │
│  │                                                  98/280 ✅ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  [+ Add Tweet to Thread]                                          │
│                                                                   │
│  Thread summary: 4 tweets, 2 images, ~623 total characters       │
│                                                                   │
│  ┌─ Options ─────────────────────────────────────────────────┐   │
│  │  [✓] Number tweets automatically (1/, 2/, 3/...)          │   │
│  │  [ ] Add "Follow for more" to last tweet                  │   │
│  │  Schedule: (•) Now  ( ) Later [_________] [__:__]         │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  [Save as Draft]                              [Post Thread Now]  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 4: Content Manager — All Posts

```
┌──────────────────────────────────────────────────────────────────┐
│  Content Manager                                                  │
│                                                                   │
│  ┌─ Toolbar ──────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  [+ New Post]  [+ New Thread]                                │  │
│  │                                                              │  │
│  │  Filter: [All Status ▼] [All Platforms ▼] [All Accounts ▼]  │  │
│  │          [Date Range: Last 30 days ▼]  [Search: _________ ]  │  │
│  │                                                              │  │
│  │  View: [📋 List] [📊 Grid] [📅 Calendar]                    │  │
│  │                                                              │  │
│  │  Bulk: [ ] Select All  [⏸️ Pause Selected] [🗑️ Delete]       │  │
│  │         [📋 Duplicate] [🔄 Reschedule]                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Posts Table ──────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  [ ] │ Status    │ Content              │ Accounts  │ Date   │  │
│  │  ────┼───────────┼──────────────────────┼───────────┼────────│  │
│  │  [ ] │ ✅ Live   │ "We're thrilled to   │ 🔵X ×1   │ Mar 22 │  │
│  │      │           │  announce our latest  │ 🔷LI ×1  │ 2:30PM │  │
│  │      │           │  product launch!..."  │           │        │  │
│  │      │           │  📷 ×2               │           │        │  │
│  │      │           │  👁 4.2K  ❤️ 312  💬 28│          │        │  │
│  │      │  [Edit] [Delete from platforms] [View Analytics]      │  │
│  │  ────┼───────────┼──────────────────────┼───────────┼────────│  │
│  │  [ ] │ ⏰ Sched  │ "Q1 results are in   │ 🔵X ×2   │ Mar 25 │  │
│  │      │  in 3d    │  and they're..."     │ 🔷LI ×1  │ 9:00AM │  │
│  │      │           │  📷 ×1  📄 ×1        │           │        │  │
│  │      │  [Edit] [Reschedule] [Publish Now] [Cancel]           │  │
│  │  ────┼───────────┼──────────────────────┼───────────┼────────│  │
│  │  [ ] │ 📝 Draft  │ "Thread: 5 lessons   │ 🔵X ×1   │ Mar 20 │  │
│  │      │           │  from scaling..."    │           │        │  │
│  │      │           │  🧵 Thread (6 tweets)│           │        │  │
│  │      │  [Edit] [Schedule] [Publish Now] [Delete]             │  │
│  │  ────┼───────────┼──────────────────────┼───────────┼────────│  │
│  │  [ ] │ ❌ Failed │ "Weekly update: Our  │ 🔵X ×1   │ Mar 21 │  │
│  │      │  Rate     │  team shipped 3 new  │ (failed)  │ 4:00PM │  │
│  │      │  Limited  │  features this..."   │ 🔷LI ×1  │        │  │
│  │      │           │                      │ (success) │        │  │
│  │      │  [Retry X Only] [Edit & Retry] [Delete] [View Error]  │  │
│  │  ────┼───────────┼──────────────────────┼───────────┼────────│  │
│  │  [ ] │ ⚠️ Partial│ "Big news! We just   │ 🔵X ×1 ✅│ Mar 19 │  │
│  │      │           │  closed our Series   │ 🔷LI ×1 ❌│ 11:00A │  │
│  │      │           │  A round..."         │           │        │  │
│  │      │  [Retry Failed Targets] [View Details]                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Showing 1-20 of 142 posts   [← Prev] [1] [2] [3] ... [8] [→]  │
└──────────────────────────────────────────────────────────────────┘
```

#### Post Detail / Edit Page

```
┌──────────────────────────────────────────────────────────────────┐
│  Post Detail                                     [← Back to All] │
│                                                                   │
│  ┌─ Status Banner ────────────────────────────────────────────┐  │
│  │  ✅ Published on Mar 22, 2026 at 2:30 PM PST              │  │
│  │  Post ID: post_01HWX7a...  [Copy ID]                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Content (Editable) ──────────────────────────────────────┐  │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  We're thrilled to announce our latest product       │  │   │
│  │  │  launch! After months of development...              │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                            │   │
│  │  ⚠️ Editing a published post: Changes will be pushed to   │   │
│  │     platforms that support editing. X does NOT support     │   │
│  │     editing — only LinkedIn commentary can be updated.     │   │
│  │                                                            │   │
│  │  [Save Edits to LinkedIn]  [Create New Post with Edits]   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Target Status ────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  🔵 X — @acme_official                                      │  │
│  │     Status: ✅ Published                                     │  │
│  │     Post URL: https://x.com/acme_official/status/18273...   │  │
│  │     Published: Mar 22, 2:30:12 PM                           │  │
│  │     Provider: Official API (latency: 847ms)                 │  │
│  │     [View on X ↗]  [Delete from X]                          │  │
│  │                                                              │  │
│  │  🔷 LinkedIn — Acme Corp                                    │  │
│  │     Status: ✅ Published                                     │  │
│  │     Post URL: https://linkedin.com/feed/update/urn:li:...   │  │
│  │     Published: Mar 22, 2:30:14 PM                           │  │
│  │     [View on LinkedIn ↗]  [Delete from LinkedIn]            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Analytics (Live — refreshes every 60s) ───────────────────┐  │
│  │                                                              │  │
│  │  Aggregate: 4,234 impressions │ 312 likes │ 28 comments     │  │
│  │                                                              │  │
│  │  ┌─ X ──────────────────────┬─ LinkedIn ──────────────────┐ │  │
│  │  │ Impressions:  1,847      │ Impressions:   2,387        │ │  │
│  │  │ Likes:          198      │ Likes:           89         │ │  │
│  │  │ Retweets:        34      │   ├ Like:       52          │ │  │
│  │  │ Replies:         12      │   ├ Celebrate:  21          │ │  │
│  │  │ Quotes:           5      │   ├ Insightful: 11          │ │  │
│  │  │ Bookmarks:       18      │   └ Other:       5          │ │  │
│  │  │ URL clicks:      67      │ Comments:        16         │ │  │
│  │  │ Profile clicks:  23      │ Shares:          12         │ │  │
│  │  │ Eng. rate:     4.82%     │ Clicks:          98         │ │  │
│  │  │                          │ Eng. rate:     3.21%        │ │  │
│  │  └──────────────────────────┴─────────────────────────────┘ │  │
│  │                                                              │  │
│  │  [Engagement over time chart — first 72 hours]              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Danger Zone ──────────────────────────────────────────────┐  │
│  │  [🗑️ Delete from ALL Platforms]  [🗑️ Delete Post Record]   │  │
│  │                                                              │  │
│  │  ⚠️ Deleting from platforms is irreversible. The post will  │  │
│  │     be removed from X and LinkedIn. Analytics data will     │  │
│  │     be preserved locally.                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 5: Calendar View

```
┌──────────────────────────────────────────────────────────────────┐
│  Content Calendar                                                 │
│                                                                   │
│  [← Feb]  March 2026  [Apr →]   [Month] [Week] [Day]            │
│                                                                   │
│  Filter: [All Accounts ▼]  [All Platforms ▼]                     │
│  Show: [✓ Published] [✓ Scheduled] [✓ Draft] [✓ Failed]         │
│                                                                   │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐             │
│  │ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │ Sat  │ Sun  │             │
│  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤             │
│  │      │      │      │      │      │  1   │  2   │             │
│  │      │      │      │      │      │      │      │             │
│  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤             │
│  │  3   │  4   │  5   │  6   │  7   │  8   │  9   │             │
│  │      │ ✅×2 │ ✅×1 │      │ ✅×1 │      │      │             │
│  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤             │
│  │  10  │  11  │  12  │  13  │  14  │  15  │  16  │             │
│  │      │ ✅×3 │      │ ✅×1 │ ❌×1 │      │      │             │
│  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤             │
│  │  17  │  18  │  19  │  20  │  21  │  22  │  23  │             │
│  │      │ ✅×2 │ ⚠️×1 │ 📝×1 │ ❌×1 │ ✅×2 │      │             │
│  │      │      │      │      │      │ NOW  │      │             │
│  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤             │
│  │  24  │  25  │  26  │  27  │  28  │  29  │  30  │             │
│  │      │ ⏰×2 │ ⏰×1 │      │ ⏰×1 │      │      │             │
│  │      │      │      │      │      │      │      │             │
│  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤             │
│  │  31  │      │      │      │      │      │      │             │
│  │      │      │      │      │      │      │      │             │
│  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘             │
│                                                                   │
│  💡 Drag & drop posts between days to reschedule                  │
│  💡 Click any day to create a new post for that date              │
│  💡 Click any post chip to expand details inline                  │
│                                                                   │
│  ┌─ Day Detail: Mar 25 ──────────────────────────────────────┐   │
│  │                                                            │   │
│  │  ⏰ 9:00 AM  "Q1 results are in..."                       │   │
│  │     → @acme_official (X), @john_at_acme (X), Acme (LI)   │   │
│  │     📷 ×1, 📄 ×1 (PDF report)                             │   │
│  │     [Edit] [Reschedule] [Publish Now] [Cancel]            │   │
│  │                                                            │   │
│  │  ⏰ 2:00 PM  "Announcing our partnership with..."         │   │
│  │     → All Brand Accounts (group: 5 accounts)              │   │
│  │     📷 ×2                                                  │   │
│  │     [Edit] [Reschedule] [Publish Now] [Cancel]            │   │
│  │                                                            │   │
│  │  [+ Add post for Mar 25]                                  │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 6: Accounts — Connection & Management

```
┌──────────────────────────────────────────────────────────────────┐
│  Accounts                                    [+ Connect Account] │
│                                                                   │
│  ┌─ Quick Connect ────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │  │
│  │  │  ╔═══╗       │  │   🔗 in      │  │  More Coming      │ │  │
│  │  │  ║ X ║       │  │  LinkedIn    │  │                   │ │  │
│  │  │  ╚═══╝       │  │              │  │  Bluesky          │ │  │
│  │  │              │  │              │  │  Threads           │ │  │
│  │  │ + Connect    │  │ + Connect    │  │  Instagram         │ │  │
│  │  │   another X  │  │   LinkedIn   │  │  [Notify me ▼]    │ │  │
│  │  │   account    │  │   account    │  │                   │ │  │
│  │  └──────────────┘  └──────────────┘  └───────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Connected Accounts (5) ───────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌─ @acme_official ──────────────────────────────────────┐  │  │
│  │  │                                                        │  │  │
│  │  │  ┌───┐  @acme_official               Health: 🟢 98    │  │  │
│  │  │  │ 🟦│  X · Organization · 12,400 followers            │  │  │
│  │  │  └───┘  Nickname: "Brand Account"                      │  │  │
│  │  │         Tags: [brand] [primary]                        │  │  │
│  │  │         Color: ■ Blue                                  │  │  │
│  │  │         Default X account: ✅ Yes                       │  │  │
│  │  │                                                        │  │  │
│  │  │  Token: ✅ Valid (expires in 47 days)                   │  │  │
│  │  │  Rate Limit (Official): 42/50 remaining (resets 15min) │  │  │
│  │  │  Rate Limit (GetXAPI): $0.24 today                     │  │  │
│  │  │  Last post: 3 hours ago                                │  │  │
│  │  │  Last sync: 12 minutes ago                             │  │  │
│  │  │                                                        │  │  │
│  │  │  [Edit Label/Tags]  [Set as Default]  [Refresh Token]  │  │  │
│  │  │  [View Posts]  [View Analytics]  [Disconnect ⚠️]        │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ Acme Corp (LinkedIn) ────────────────────────────────┐  │  │
│  │  │                                                        │  │  │
│  │  │  ┌───┐  Acme Corp                   Health: 🟡 72     │  │  │
│  │  │  │ 🔷│  LinkedIn · Organization · 8,100 followers      │  │  │
│  │  │  └───┘  Nickname: "Company Page"                       │  │  │
│  │  │                                                        │  │  │
│  │  │  Token: ⚠️ Expires in 5 days   [🔄 Refresh Now]        │  │  │
│  │  │  Rate Limit: 134/150 posts remaining today             │  │  │
│  │  │                                                        │  │  │
│  │  │  Issues:                                               │  │  │
│  │  │  ⚠️ Token expires soon — re-authenticate recommended   │  │  │
│  │  │     [Re-authenticate LinkedIn →]                       │  │  │
│  │  │                                                        │  │  │
│  │  │  [Edit Label/Tags]  [View Posts]  [Disconnect ⚠️]       │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  (... more accounts ...)                                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Account Groups ──────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  ┌─ All Brand Accounts ────────────────────────────────┐  │   │
│  │  │  @acme_official (X), @acme_support (X), Acme (LI)  │  │   │
│  │  │  [Edit Group]  [Post to Group]  [Delete Group]      │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                            │   │
│  │  ┌─ Founder Personal ─────────────────────────────────┐   │   │
│  │  │  @john_at_acme (X), John Doe (LI)                  │   │   │
│  │  │  [Edit Group]  [Post to Group]  [Delete Group]      │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  │                                                            │   │
│  │  [+ Create New Group]                                     │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 7: Analytics — Full Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Analytics                          [7d] [30d] [90d] [Custom ▼]  │
│                                                                   │
│  Account: [✓ All Accounts ▼]    Compare: [+ Add comparison]      │
│                                                                   │
│  ┌─ KPI Cards ────────────────────────────────────────────────┐  │
│  │ Impressions  │ Engagements  │ Eng. Rate │ Followers │ Posts │  │
│  │   245.8K     │    8,432     │   3.43%   │  15,847   │  47  │  │
│  │  ▲ +12.3%    │   ▲ +8.7%    │  ▲ +0.5%  │ ▲ +1,247  │▲ +8  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Impressions & Engagement Trend ───────────────────────────┐  │
│  │  [Area + Line chart]                                        │  │
│  │  Metrics: [✓ Impressions] [✓ Likes] [✓ Comments]           │  │
│  │           [ Shares] [ Clicks] [ Eng. Rate]                 │  │
│  │  Split by: [None ▼] [Platform ▼] [Account ▼]               │  │
│  │  Granularity: [Day] [Week] [Month]                          │  │
│  │                                                              │  │
│  │     50K│         ╱╲                                         │  │
│  │        │    ╱╲  ╱  ╲    ╱╲                                  │  │
│  │     25K│   ╱  ╲╱    ╲  ╱  ╲                                 │  │
│  │        │  ╱         ╲╱    ╲╱                                │  │
│  │      0 │╱─────────────────────                              │  │
│  │        Mar 1     Mar 8    Mar 15    Mar 22                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Platform Comparison ──────────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌────────────────────────┬────────────────────────────┐   │  │
│  │  │       X (3 accounts)   │   LinkedIn (2 accounts)    │   │  │
│  │  ├────────────────────────┼────────────────────────────┤   │  │
│  │  │ Impressions: 112,400   │ Impressions: 133,420       │   │  │
│  │  │ Engagements:   4,102   │ Engagements:   4,330       │   │  │
│  │  │ Eng. Rate:     3.65%   │ Eng. Rate:     3.25%       │   │  │
│  │  │ Best post: 8.2K views  │ Best post: 12.1K views     │   │  │
│  │  │ Avg post: 2.4K views   │ Avg post: 5.6K views       │   │  │
│  │  │ Posts: 31               │ Posts: 24                  │   │  │
│  │  └────────────────────────┴────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Top Performing Posts ─────────────────────────────────────┐  │
│  │  Sort by: [Impressions ▼]  [Eng. Rate ▼]  [Likes ▼]       │  │
│  │                                                              │  │
│  │  1. "We're thrilled to announce..."   Mar 22  [View →]      │  │
│  │     X: 1.8K views 4.82%  │  LI: 8.3K views 3.21%          │  │
│  │     Aggregate: 10.1K impressions, 340 engagements           │  │
│  │                                                              │  │
│  │  2. "Thread: 5 lessons from scaling"  Mar 18  [View →]      │  │
│  │     X: 3.4K views 6.12%  (thread, 5 tweets)                │  │
│  │     Aggregate: 3.4K impressions, 208 engagements            │  │
│  │                                                              │  │
│  │  3. "Open source spotlight..."         Mar 11  [View →]     │  │
│  │     X: 2.1K views  │  LI: 5.2K views                       │  │
│  │     Aggregate: 7.3K impressions, 285 engagements            │  │
│  │                                                              │  │
│  │  [View All Posts with Metrics →]                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Content Type Breakdown ───┬─ Best Posting Times ───────────┐ │
│  │                             │                                 │ │
│  │  [Donut chart]              │  [Heatmap: Day × Hour]         │ │
│  │                             │                                 │ │
│  │  📷 Image posts: 62%       │  Best: Tue 9AM (4.8% avg eng)  │ │
│  │  📝 Text only:   25%       │  2nd:  Thu 2PM (4.2% avg eng)  │ │
│  │  🎬 Video:       8%        │  Worst: Sun 6AM (0.8% avg eng) │ │
│  │  🧵 Threads:     5%        │                                 │ │
│  │                             │  💡 Schedule posts for Tue/Thu │ │
│  │  Best type: Video (5.2%    │     mornings for max impact.   │ │
│  │  avg engagement)            │                                 │ │
│  └─────────────────────────────┴─────────────────────────────────┘ │
│                                                                   │
│  ┌─ Follower Growth ─────────────────────────────────────────┐   │
│  │  [Line chart — followers over time per account]            │   │
│  │                                                            │   │
│  │  🔵 @acme_official: 12,400 (+312 this month)              │   │
│  │  🔵 @john_at_acme:   3,200 (+89 this month)               │   │
│  │  🔷 Acme Corp (LI):  8,100 (+567 this month)              │   │
│  │  🔷 John Doe (LI):   1,800 (+279 this month)              │   │
│  │                                                            │   │
│  │  Total: 25,500 followers (+1,247 this month, +5.1%)       │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ LinkedIn Audience Insights (Org Pages) ───────────────────┐  │
│  │                                                              │  │
│  │  Acme Corp — 8,100 followers                                │  │
│  │                                                              │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐            │  │
│  │  │ By Function │  │ By Region  │  │By Seniority│            │  │
│  │  │[Bar chart]  │  │[Bar chart] │  │[Bar chart] │            │  │
│  │  │Engineering  │  │ US    42%  │  │ Senior 35% │            │  │
│  │  │  32%       │  │ UK    18%  │  │ Entry  28% │            │  │
│  │  │Marketing   │  │ India 12%  │  │ Manager22% │            │  │
│  │  │  21%       │  │ Canada 8%  │  │ VP     15% │            │  │
│  │  │IT          │  │ Germany 7% │  │            │            │  │
│  │  │  18%       │  │ Other  13% │  │            │            │  │
│  │  └────────────┘  └────────────┘  └────────────┘            │  │
│  │                                                              │  │
│  │  ┌────────────┐                                              │  │
│  │  │By Industry │                                              │  │
│  │  │Technology   │                                              │  │
│  │  │  45%       │                                              │  │
│  │  │Finance     │                                              │  │
│  │  │  18%       │                                              │  │
│  │  │Healthcare  │                                              │  │
│  │  │  12%       │                                              │  │
│  │  └────────────┘                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  [📥 Export Analytics as CSV]  [📥 Export as PDF Report]          │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 8: Media Library

```
┌──────────────────────────────────────────────────────────────────┐
│  Media Library                     [Upload] [Bulk Upload] [🗑️]   │
│                                                                   │
│  ┌─ Toolbar ──────────────────────────────────────────────────┐  │
│  │ Type: [All ▼]  Platform: [All ▼]  Status: [All ▼]         │  │
│  │ Sort: [Newest ▼]  Search: [____________]                   │  │
│  │ View: [Grid ■■] [List ≡]         Storage: 1.2 GB / 5 GB   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Upload Zone (always visible) ─────────────────────────────┐  │
│  │                                                              │  │
│  │    ┌──────────────────────────────────────────────────┐     │  │
│  │    │                                                    │     │  │
│  │    │   📁 Drop files here to upload                     │     │  │
│  │    │      or click to browse                            │     │  │
│  │    │      or paste a URL: [_________________________]   │     │  │
│  │    │                                                    │     │  │
│  │    │   Supported: JPEG, PNG, WEBP, GIF, MP4, MOV, PDF  │     │  │
│  │    │   Max: 512 MB per file, 10 files at once           │     │  │
│  │    │                                                    │     │  │
│  │    └──────────────────────────────────────────────────┘     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Media Grid ───────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │  │
│  │  │ [✓]    │  │ [ ]    │  │ [ ]    │  │ [ ]    │           │  │
│  │  │ 📷     │  │ 📷     │  │ 🎬     │  │ 📄     │           │  │
│  │  │[thumb] │  │[thumb] │  │[thumb] │  │[thumb] │           │  │
│  │  │        │  │        │  │ ▶ 2:34 │  │ 4 pgs  │           │  │
│  │  │launch  │  │team    │  │demo    │  │report  │           │  │
│  │  │.png    │  │.jpg    │  │.mp4    │  │.pdf    │           │  │
│  │  │1.2 MB  │  │ 800KB  │  │45.2 MB │  │3.4 MB  │           │  │
│  │  │✅ X,LI │  │✅ X,LI │  │✅ X,LI │  │✅ LI   │           │  │
│  │  │Alt: ✅ │  │Alt: ❌ │  │Alt: ✅ │  │⚠️ No X  │           │  │
│  │  │Used: 2 │  │Used: 0 │  │Used: 1 │  │Used: 0 │           │  │
│  │  └────────┘  └────────┘  └────────┘  └────────┘           │  │
│  │                                                              │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │  │
│  │  │ [ ]    │  │ [ ]    │  │ [ ]    │  │ [ ]    │           │  │
│  │  │ 📷     │  │ 📷     │  │ 🎞️     │  │ 📷     │           │  │
│  │  │[thumb] │  │[thumb] │  │[thumb] │  │[thumb] │           │  │
│  │  │        │  │        │  │ GIF    │  │        │           │  │
│  │  │office  │  │logo    │  │anim    │  │banner  │           │  │
│  │  │.jpg    │  │.png    │  │.gif    │  │.webp   │           │  │
│  │  │2.1 MB  │  │ 45KB   │  │8.7 MB  │  │ 320KB  │           │  │
│  │  │✅ X,LI │  │✅ X,LI │  │✅ X    │  │✅ X    │           │  │
│  │  │Alt: ❌ │  │Alt: ✅ │  │⚠️No LI  │  │⚠️No LI  │           │  │
│  │  │Used: 3 │  │Used: 8 │  │Used: 1 │  │Used: 0 │           │  │
│  │  └────────┘  └────────┘  └────────┘  └────────┘           │  │
│  │                                                              │  │
│  │  Bulk actions: [1 selected] [Add Alt Text] [Delete] [Copy ID]│ │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Detail Panel (click any media) ───────────────────────────┐  │
│  │  Preview: [████████████████████████████████████]            │  │
│  │                                                              │  │
│  │  File: launch.png                  ID: med_01HWX...         │  │
│  │  Type: PNG Image                   Hash: a3f8b2...          │  │
│  │  Dimensions: 1200 × 630            Uploaded: Mar 22, 10:30  │  │
│  │  Size: 1.2 MB (original: 1.8 MB)                           │  │
│  │                                                              │  │
│  │  Alt Text: [Product launch announcement graphic     ] [Save]│  │
│  │  Title:    [Launch Day                              ] [Save]│  │
│  │                                                              │  │
│  │  Platform Compatibility:                                     │  │
│  │    X (Official): ✅ Compatible (1.2MB < 5MB, 1200×630 OK)  │  │
│  │    X (GetXAPI):  ✅ Compatible (same media_id)              │  │
│  │    LinkedIn:     ✅ Compatible (1.2MB < 10MB)               │  │
│  │                                                              │  │
│  │  Thumbnails: [150px] [300px] [600px]    Blurhash: UBE2GK... │  │
│  │                                                              │  │
│  │  Used in posts:                                              │  │
│  │    • "We're thrilled to announce..." (Mar 22, Published)    │  │
│  │    • "Product showcase thread" (Mar 18, Published)          │  │
│  │                                                              │  │
│  │  [Copy Media ID]  [Download Original]  [Replace File]       │  │
│  │  [🗑️ Delete]  ⚠️ Used in 2 posts — will be removed from them│  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 9: Activity Log

```
┌──────────────────────────────────────────────────────────────────┐
│  Activity Log                               [Export] [Clear All] │
│                                                                   │
│  Filter: [All Types ▼]  [All Accounts ▼]  [All Sources ▼]       │
│          Sources: Dashboard, CLI, MCP, REST API, Scheduler       │
│                                                                   │
│  ┌─ Log Entries ──────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  🕐 2:34 PM  📤 Post published                              │  │
│  │     "We're thrilled to announce..."                         │  │
│  │     → X (@acme_official): ✅ Published in 847ms             │  │
│  │     → LinkedIn (Acme Corp): ✅ Published in 1,204ms         │  │
│  │     Source: Dashboard (john@acme.com)                       │  │
│  │                                                              │  │
│  │  🕐 2:33 PM  📷 Media uploaded                               │  │
│  │     launch.png (1.2 MB) — processed in 234ms               │  │
│  │     Source: Dashboard (john@acme.com)                       │  │
│  │                                                              │  │
│  │  🕐 1:15 PM  🤖 Post published (via AI agent)               │  │
│  │     "Daily market update: BTC holds above 95K..."           │  │
│  │     → X (@acme_official): ✅ Published                      │  │
│  │     Source: MCP (Claude Desktop, key: op_01HWX...)          │  │
│  │                                                              │  │
│  │  🕐 12:00 PM  ⏰ Scheduled post published (auto)            │  │
│  │     "Lunchtime poll: What's your preferred..."              │  │
│  │     → X (@acme_official): ✅ Published                      │  │
│  │     Source: Scheduler (job_01HWX...)                        │  │
│  │                                                              │  │
│  │  🕐 11:47 AM  ❌ Post failed                                 │  │
│  │     "Weekly update: Our team shipped..."                    │  │
│  │     → X (@acme_official): ❌ PLATFORM_RATE_LIMITED          │  │
│  │       Provider: Official API → Fallback: GetXAPI → ❌ 502   │  │
│  │       Retry scheduled: 12:02 PM                             │  │
│  │     → LinkedIn (Acme Corp): ✅ Published                    │  │
│  │     Source: CLI (op post create, key: op_01HWX...)          │  │
│  │                                                              │  │
│  │  🕐 11:30 AM  🔄 Token refreshed                             │  │
│  │     Acme Corp (LinkedIn) — new token expires Apr 21         │  │
│  │     Source: Scheduler (auto-refresh)                        │  │
│  │                                                              │  │
│  │  🕐 10:00 AM  🔴 EMERGENCY STOP activated                    │  │
│  │     Activated by: john@acme.com                             │  │
│  │     Reason: "Wrong campaign content going out"              │  │
│  │     Affected: 3 scheduled posts paused, 1 in-flight halted │  │
│  │                                                              │  │
│  │  🕐 10:05 AM  🟢 EMERGENCY STOP deactivated                  │  │
│  │     Deactivated by: john@acme.com                           │  │
│  │     Duration: 5 minutes                                     │  │
│  │     Posts resumed: 2 (1 cancelled manually)                 │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Showing 1-20 of 847 entries   [← Prev] [Next →]                │
└──────────────────────────────────────────────────────────────────┘
```

---

### Page 10: Settings — API Keys & Webhooks

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings                                                         │
│                                                                   │
│  [API Keys] [Webhooks] [Workspace] [Emergency Controls]          │
│                                                                   │
│  ┌─ API Keys ─────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  Create API keys for agents, scripts, and integrations.     │  │
│  │                                                              │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │ Name: "Claude Desktop"                                │   │  │
│  │  │ Key: op_01HWX7...••••••••  [Copy] [Reveal]           │   │  │
│  │  │ Created: Mar 15, 2026  │  Last used: 12 min ago      │   │  │
│  │  │ Permissions: [✓ Post] [✓ Engage] [✓ Media] [✓ Read]  │   │  │
│  │  │              [ Analytics] [ Accounts]                 │   │  │
│  │  │ Rate limit: 100 req/min (custom)                      │   │  │
│  │  │ [Edit Permissions]  [Regenerate ⚠️]  [Revoke ⚠️]      │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │ Name: "GitHub Actions CI"                             │   │  │
│  │  │ Key: op_01HWX8...••••••••  [Copy] [Reveal]           │   │  │
│  │  │ Created: Mar 18, 2026  │  Last used: 2 hours ago     │   │  │
│  │  │ Permissions: [✓ Post] [ Engage] [ Media] [✓ Read]    │   │  │
│  │  │ Rate limit: 50 req/min                                │   │  │
│  │  │ [Edit Permissions]  [Regenerate ⚠️]  [Revoke ⚠️]      │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │  [+ Create New API Key]                                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Webhooks ─────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  Receive real-time notifications when events occur.         │  │
│  │                                                              │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │ URL: https://hooks.slack.com/services/T.../B.../...  │   │  │
│  │  │ Events: [✓ post.published] [✓ post.failed]           │   │  │
│  │  │         [✓ account.expired] [ engagement.*]          │   │  │
│  │  │ Status: ✅ Active (last delivery: 12 min ago, 200 OK)│   │  │
│  │  │ [Edit]  [Test]  [View Delivery Log]  [Delete]        │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │  [+ Add Webhook Endpoint]                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Emergency Stop System

The Emergency Stop is a **workspace-wide kill switch** that immediately halts all publishing activity. It is designed for scenarios like:
- Wrong content about to go out on a brand account
- Compromised API key detected
- Platform API behaving erratically and causing unintended posts
- PR crisis where all social activity should cease immediately

#### Emergency Stop Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EMERGENCY STOP SYSTEM                          │
│                                                                  │
│  Trigger points:                                                 │
│  ┌────────────┐  ┌──────────┐  ┌────────────┐  ┌────────────┐  │
│  │ Dashboard  │  │   CLI    │  │  REST API  │  │  MCP Tool  │  │
│  │ 🔴 Button  │  │ op stop  │  │ POST /stop │  │ emergency  │  │
│  │ (top bar)  │  │          │  │            │  │ _stop      │  │
│  └─────┬──────┘  └────┬─────┘  └─────┬──────┘  └─────┬──────┘  │
│        │              │               │               │          │
│        └──────────────┴───────────────┴───────────────┘          │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                STOP COORDINATOR                            │   │
│  │                                                            │   │
│  │  1. Set workspace.emergencyStop = true (Redis + DB)       │   │
│  │  2. Publish STOP event via Redis pub/sub                  │   │
│  │  3. All API servers receive event immediately             │   │
│  │  4. BullMQ workers pause processing                       │   │
│  │  5. In-flight API calls:                                  │   │
│  │     - Already sent to platform: Cannot recall (logged)    │   │
│  │     - Not yet sent: Cancelled immediately                 │   │
│  │  6. Scheduled posts: Paused (not deleted)                 │   │
│  │  7. Activity log: Record stop event with reason           │   │
│  │  8. Webhooks: Notify all endpoints                        │   │
│  │  9. Dashboard: Show red banner on all pages               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  On RESUME:                                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  1. Set workspace.emergencyStop = false                    │   │
│  │  2. Publish RESUME event                                   │   │
│  │  3. BullMQ workers resume processing                       │   │
│  │  4. Paused scheduled posts resume their schedules          │   │
│  │  5. User chooses per-post: Resume / Cancel / Edit         │   │
│  │  6. Activity log: Record resume event                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Emergency Stop API

```typescript
// REST API
POST /emergency/stop
{
  reason: string;                // Required — logged for audit
  scope?: 'all' | 'platform' | 'account';
  platformFilter?: Platform;     // Only stop X or only LinkedIn
  accountFilter?: string[];      // Only stop specific accounts
}
// → 200 { stopped: true, affected: { scheduledPaused: 3, inFlightCancelled: 1, inFlightAlreadySent: 0 } }

POST /emergency/resume
{
  resumeScheduled?: boolean;     // Default: true. Resume paused scheduled posts.
}
// → 200 { resumed: true, scheduledResumed: 3 }

GET /emergency/status
// → 200 { active: true, activatedAt: "...", activatedBy: "...", reason: "...", affected: {...} }

// CLI
op emergency stop --reason "Wrong campaign content"
op emergency stop --reason "Compromised key" --platform x
op emergency stop --reason "Pause Nike account" --accounts acc_01HWX7
op emergency resume
op emergency status

// MCP Tool
{
  name: "emergency_stop",
  description: "IMMEDIATELY halt all publishing activity across the workspace. Use when wrong content is going out, an account is compromised, or during a PR crisis. Requires a reason. Can optionally scope to specific platforms or accounts.",
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why the stop was activated — logged for audit" },
      scope: { type: "string", enum: ["all", "platform", "account"], description: "Scope of the stop. Default: all." },
      platform: { type: "string", enum: ["x", "linkedin"], description: "Platform to stop (if scope=platform)" },
      accountIds: { type: "array", items: { type: "string" }, description: "Accounts to stop (if scope=account)" }
    },
    required: ["reason"]
  }
}
```

#### Emergency Stop Middleware

```typescript
// Every publish/engage/schedule operation checks this FIRST
// This is a Redis check (< 1ms) so it adds zero meaningful latency

async function emergencyStopGuard(workspaceId: string): Promise<void> {
  const stopped = await redis.get(`emergency:${workspaceId}`);
  if (stopped) {
    const details = JSON.parse(stopped);
    throw new OpenPostingError({
      code: 'EMERGENCY_STOP_ACTIVE',
      message: `Publishing halted. Reason: ${details.reason}. Activated at ${details.activatedAt} by ${details.activatedBy}.`,
      retryable: false,
      details,
    });
  }
}
```

---

### Complete Content Lifecycle (All Operations)

Every state a post can be in, and every action available:

```
                            ┌──────────┐
                     create │          │
              ─────────────▶│  DRAFT   │
                            │          │
                            └────┬─────┘
                                 │
                    ┌────────────┼────────────┐
                    │ publish    │ schedule    │ delete
                    ▼            ▼             ▼
             ┌───────────┐ ┌──────────┐  ┌─────────┐
             │PUBLISHING │ │SCHEDULED │  │ DELETED │
             │           │ │          │  └─────────┘
             └─────┬─────┘ └────┬─────┘
                   │            │
                   │      ┌─────┼──────────┐
                   │      │     │ cancel    │ edit
                   │      │     ▼           ▼
                   │   trigger  ┌──────┐ ┌──────┐
                   │   (time)   │DRAFT │ │SCHED │
                   │      │     └──────┘ │(edit)│
                   │      ▼              └──────┘
                   │  ┌───────────┐
                   │  │PUBLISHING │
                   │  └─────┬─────┘
                   │        │
           ┌───────┴────────┴───────┐
           │                        │
           ▼                        ▼
    ┌────────────┐           ┌────────────┐
    │ PUBLISHED  │           │   FAILED   │
    │            │           │            │
    └──────┬─────┘           └──────┬─────┘
           │                        │
    ┌──────┼──────┐          ┌──────┼──────┐
    │      │      │          │      │      │
    ▼      ▼      ▼          ▼      ▼      ▼
  edit  delete  view       retry  edit  delete
  (LI   (from   analytics  (auto  &     record
  only)  plat-             or     retry
         forms)            manual)

  PARTIALLY_FAILED: some targets succeeded, some failed
  → retry failed targets only
  → delete successful ones from platform if needed
```

#### Actions Available Per State

| State | Available Actions |
|---|---|
| **Draft** | Edit content, Edit media, Edit targets, Schedule, Publish now, Delete, Duplicate |
| **Scheduled** | Edit content, Edit media, Edit targets, Reschedule, Publish now, Cancel (→ Draft), Delete |
| **Publishing** | View status (real-time), Emergency stop |
| **Published** | View analytics, Edit (LinkedIn only — commentary field), Delete from platforms, Delete record, Duplicate as new draft |
| **Failed** | View error details, Retry all failed targets, Retry specific target, Edit & retry, Delete |
| **Partially Failed** | View per-target status, Retry failed targets only, Delete successful from platforms, Delete all |

#### Bulk Operations

| Bulk Action | Applies to States | Behavior |
|---|---|---|
| **Bulk Delete** | All | Drafts: deleted. Scheduled: cancelled + deleted. Published: option to delete from platforms. |
| **Bulk Schedule** | Draft | Applies same schedule time to all selected drafts |
| **Bulk Reschedule** | Scheduled | Shifts all selected posts by relative offset or sets absolute time |
| **Bulk Publish Now** | Draft, Scheduled | Immediately publishes all selected |
| **Bulk Pause** | Scheduled | Pauses (keeps schedule, doesn't fire). Resume individually. |
| **Bulk Retry** | Failed, Partially Failed | Retries all failed targets across selected posts |
| **Bulk Duplicate** | Published, Draft | Creates new drafts from selected posts |
| **Bulk Re-target** | Draft, Scheduled | Add or remove accounts/platforms from selected posts |

---

### Dashboard Monorepo Addition

```
open-posting/
├── apps/
│   ├── api/                    # REST API server
│   ├── mcp/                    # MCP server
│   ├── cli/                    # CLI application
│   └── dashboard/              # Next.js dashboard
│       ├── src/
│       │   ├── app/            # App Router pages
│       │   │   ├── layout.tsx                      # Root layout with sidebar + topbar
│       │   │   ├── page.tsx                        # Overview dashboard (home)
│       │   │   ├── compose/
│       │   │   │   ├── page.tsx                    # Post composer
│       │   │   │   └── thread/page.tsx             # Thread builder
│       │   │   ├── content/
│       │   │   │   ├── page.tsx                    # All posts (content manager)
│       │   │   │   ├── [id]/page.tsx               # Post detail / edit / analytics
│       │   │   │   ├── drafts/page.tsx             # Draft posts
│       │   │   │   ├── scheduled/page.tsx          # Scheduled posts
│       │   │   │   ├── published/page.tsx          # Published posts
│       │   │   │   └── failed/page.tsx             # Failed posts with retry
│       │   │   ├── calendar/page.tsx               # Calendar view
│       │   │   ├── analytics/
│       │   │   │   ├── page.tsx                    # Analytics overview
│       │   │   │   ├── posts/page.tsx              # Per-post analytics table
│       │   │   │   ├── accounts/page.tsx           # Per-account analytics
│       │   │   │   └── compare/page.tsx            # Side-by-side comparison
│       │   │   ├── media/page.tsx                  # Media library
│       │   │   ├── accounts/
│       │   │   │   ├── page.tsx                    # Account management
│       │   │   │   ├── groups/page.tsx             # Account groups
│       │   │   │   ├── health/page.tsx             # Account health monitor
│       │   │   │   └── connect/[platform]/page.tsx # OAuth flow
│       │   │   ├── activity/page.tsx               # Activity log
│       │   │   └── settings/
│       │   │       ├── page.tsx                    # General settings
│       │   │       ├── api-keys/page.tsx           # API key management
│       │   │       ├── webhooks/page.tsx           # Webhook configuration
│       │   │       └── emergency/page.tsx          # Emergency controls
│       │   │
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   ├── TopBar.tsx
│       │   │   │   ├── EmergencyBanner.tsx         # Red banner when stop active
│       │   │   │   ├── EmergencyStopButton.tsx     # Always-visible kill switch
│       │   │   │   └── CommandPalette.tsx           # Ctrl+K quick actions
│       │   │   ├── compose/
│       │   │   │   ├── PostEditor.tsx
│       │   │   │   ├── MediaUploader.tsx
│       │   │   │   ├── MediaReorder.tsx             # dnd-kit sortable
│       │   │   │   ├── PlatformPreview.tsx
│       │   │   │   ├── AccountSelector.tsx
│       │   │   │   ├── GroupSelector.tsx
│       │   │   │   ├── ThreadBuilder.tsx
│       │   │   │   ├── PollBuilder.tsx
│       │   │   │   ├── SchedulePicker.tsx
│       │   │   │   ├── CharacterCounter.tsx
│       │   │   │   └── PlatformOverrideTabs.tsx
│       │   │   ├── content/
│       │   │   │   ├── PostTable.tsx
│       │   │   │   ├── PostCard.tsx
│       │   │   │   ├── PostStatusBadge.tsx
│       │   │   │   ├── BulkActionBar.tsx
│       │   │   │   ├── PostFilters.tsx
│       │   │   │   ├── PostDetail.tsx
│       │   │   │   ├── PostEditForm.tsx
│       │   │   │   ├── TargetStatusList.tsx
│       │   │   │   └── DangerZone.tsx
│       │   │   ├── calendar/
│       │   │   │   ├── CalendarGrid.tsx
│       │   │   │   ├── CalendarDayCell.tsx
│       │   │   │   ├── CalendarPostChip.tsx         # Draggable post chips
│       │   │   │   └── DayDetailPanel.tsx
│       │   │   ├── analytics/
│       │   │   │   ├── MetricCard.tsx
│       │   │   │   ├── EngagementChart.tsx
│       │   │   │   ├── PlatformComparison.tsx
│       │   │   │   ├── TopPostsTable.tsx
│       │   │   │   ├── ContentTypeBreakdown.tsx
│       │   │   │   ├── BestTimesHeatmap.tsx
│       │   │   │   ├── FollowerGrowthChart.tsx
│       │   │   │   ├── AudienceInsights.tsx
│       │   │   │   └── ExportButton.tsx             # CSV + PDF export
│       │   │   ├── accounts/
│       │   │   │   ├── AccountCard.tsx
│       │   │   │   ├── AccountHealthIndicator.tsx
│       │   │   │   ├── AccountGroupManager.tsx
│       │   │   │   ├── ConnectFlow.tsx
│       │   │   │   ├── TokenExpiryWarning.tsx
│       │   │   │   └── AccountLabelEditor.tsx
│       │   │   ├── media/
│       │   │   │   ├── MediaGrid.tsx
│       │   │   │   ├── MediaDetailPanel.tsx
│       │   │   │   ├── UploadZone.tsx
│       │   │   │   ├── PlatformCompatBadge.tsx
│       │   │   │   └── AltTextEditor.tsx
│       │   │   ├── activity/
│       │   │   │   ├── ActivityFeed.tsx
│       │   │   │   ├── ActivityEntry.tsx
│       │   │   │   └── ActivityFilters.tsx
│       │   │   └── shared/
│       │   │       ├── PlatformBadge.tsx
│       │   │       ├── StatusIndicator.tsx
│       │   │       ├── ConfirmDialog.tsx             # "Are you sure?" for destructive actions
│       │   │       ├── EmptyState.tsx
│       │   │       ├── LoadingSkeleton.tsx
│       │   │       ├── ErrorBoundary.tsx
│       │   │       └── Pagination.tsx
│       │   │
│       │   ├── hooks/
│       │   │   ├── useAccounts.ts
│       │   │   ├── useCreatePost.ts
│       │   │   ├── useEditPost.ts
│       │   │   ├── useDeletePost.ts
│       │   │   ├── useBulkActions.ts
│       │   │   ├── useAnalytics.ts
│       │   │   ├── useMediaUpload.ts
│       │   │   ├── useCalendar.ts
│       │   │   ├── useEmergencyStop.ts
│       │   │   ├── useActivityLog.ts
│       │   │   ├── useSSE.ts                        # Server-sent events hook
│       │   │   └── useCommandPalette.ts
│       │   │
│       │   └── lib/
│       │       ├── api-client.ts                    # Type-safe API client (from OpenAPI)
│       │       ├── constants.ts
│       │       └── utils.ts
│       │
│       ├── public/
│       │   └── favicon.ico
│       ├── Dockerfile
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── package.json
```

### Dashboard-Specific API Additions

```
# === Dashboard Home ===
GET    /dashboard/overview                  # Aggregate stats + recent activity + upcoming
GET    /dashboard/activity-feed             # Paginated activity stream with source attribution
GET    /dashboard/activity-feed/stream      # SSE stream for live activity updates

# === Content Management ===
GET    /posts?status=draft&sort=updatedAt   # Drafts
GET    /posts?status=scheduled&sort=scheduledAt  # Scheduled
GET    /posts?status=published&sort=publishedAt  # Published
GET    /posts?status=failed,partially_failed     # Failed
PUT    /posts/:id                           # Edit draft/scheduled post content
PUT    /posts/:id/targets                   # Add/remove targets from post
PUT    /posts/:id/schedule                  # Reschedule a scheduled post
POST   /posts/:id/publish-now              # Immediately publish draft/scheduled
POST   /posts/:id/cancel                   # Cancel scheduled → draft
POST   /posts/:id/retry                    # Retry all failed targets
POST   /posts/:id/retry/:targetId          # Retry specific failed target
POST   /posts/:id/duplicate                # Create draft copy of any post
DELETE /posts/:id                           # Delete post (with platform delete option)
DELETE /posts/:id/platforms                 # Delete from platforms only (keep record)
PATCH  /posts/:id/platform-edit            # Edit published post on LinkedIn (commentary)

# === Bulk Operations ===
POST   /posts/bulk/delete                   # { postIds: [...], deleteFromPlatforms?: bool }
POST   /posts/bulk/schedule                 # { postIds: [...], scheduledAt: "..." }
POST   /posts/bulk/reschedule               # { postIds: [...], offsetMinutes?: num, absoluteTime?: "..." }
POST   /posts/bulk/publish-now              # { postIds: [...] }
POST   /posts/bulk/pause                    # { postIds: [...] }
POST   /posts/bulk/resume                   # { postIds: [...] }
POST   /posts/bulk/retry                    # { postIds: [...] }
POST   /posts/bulk/duplicate                # { postIds: [...] }
POST   /posts/bulk/retarget                 # { postIds: [...], addAccounts?: [...], removeAccounts?: [...] }

# === Calendar ===
GET    /dashboard/calendar                  # ?month=2026-03&accounts=...&statuses=...
PUT    /dashboard/calendar/move             # Drag-and-drop reschedule: { postId, newDate }

# === Compose Helpers ===
POST   /dashboard/compose/preview           # Generate platform-specific preview
GET    /dashboard/suggestions/time          # AI-suggested best posting times
POST   /dashboard/compose/validate          # Full validation across all targets

# === Account Management ===
POST   /accounts/groups                     # Create account group
GET    /accounts/groups                     # List groups
PUT    /accounts/groups/:id                 # Edit group (name, members)
DELETE /accounts/groups/:id                 # Delete group
POST   /accounts/:id/label                 # Set nickname, color, tags
PUT    /accounts/:id/default               # Set as default for platform
GET    /accounts/:id/health                 # Detailed health check

# === Emergency Controls ===
POST   /emergency/stop                      # Activate emergency stop
POST   /emergency/resume                    # Deactivate emergency stop
GET    /emergency/status                    # Current emergency stop status

# === API Key Management ===
POST   /api-keys                            # Create new API key
GET    /api-keys                            # List API keys (prefix only, never full key)
PUT    /api-keys/:id                        # Update name, permissions, rate limit
DELETE /api-keys/:id                        # Revoke API key
POST   /api-keys/:id/regenerate             # Regenerate key (invalidates old)

# === Webhooks ===
POST   /webhooks                            # Create webhook endpoint
GET    /webhooks                            # List webhooks
PUT    /webhooks/:id                        # Update webhook (URL, events)
DELETE /webhooks/:id                        # Delete webhook
POST   /webhooks/:id/test                   # Send test event
GET    /webhooks/:id/deliveries             # View delivery log

# === Analytics Export ===
GET    /analytics/export/csv                # ?accountIds=...&start=...&end=...
GET    /analytics/export/pdf                # Generate PDF analytics report
```

### Command Palette (Ctrl+K)

Power users can access any action without navigating:

```
┌──────────────────────────────────────────────────────┐
│  ⌘K  [Search commands, posts, accounts...]            │
│                                                       │
│  Recent:                                              │
│  📤  Create new post                                  │
│  🧵  Create new thread                                │
│                                                       │
│  Quick Actions:                                       │
│  📤  Compose new post            Ctrl+N               │
│  🧵  New thread                  Ctrl+Shift+T         │
│  📊  View analytics              Ctrl+Shift+A         │
│  📅  Open calendar               Ctrl+Shift+C         │
│  🔴  Emergency stop              Ctrl+Shift+E         │
│  👤  Connect new account         Ctrl+Shift+N         │
│                                                       │
│  Search Posts:                                        │
│  📝  "product launch" — Draft, Mar 20                 │
│  ✅  "we're thrilled" — Published, Mar 22              │
│                                                       │
│  Search Accounts:                                     │
│  🔵  @acme_official — X, 12.4K followers              │
│  🔷  Acme Corp — LinkedIn, 8.1K followers             │
│                                                       │
│  Navigation:                                          │
│  → Content Manager                                    │
│  → Media Library                                      │
│  → Settings > API Keys                                │
│  → Activity Log                                       │
└──────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Open command palette |
| `Ctrl+N` | New post |
| `Ctrl+Shift+T` | New thread |
| `Ctrl+Shift+E` | Emergency stop toggle |
| `Ctrl+Shift+A` | Analytics |
| `Ctrl+Shift+C` | Calendar |
| `Ctrl+Enter` | Publish/Schedule (in compose) |
| `Ctrl+S` | Save draft (in compose) |
| `Escape` | Close modal / cancel |
| `J/K` | Navigate up/down in lists |
| `X` | Select/deselect item in list |
| `Ctrl+Shift+D` | Duplicate selected post |
| `Delete` | Delete selected (with confirmation) |

### Responsive Design

| Breakpoint | Layout |
|---|---|
| Desktop (≥1280px) | Full sidebar + content + detail panel |
| Tablet (768-1279px) | Collapsible sidebar, content full-width, detail as modal |
| Mobile (< 768px) | Bottom nav, stacked layout, compose as full-screen modal |

### Accessibility (WCAG 2.2 AA)

- All interactive elements have focus indicators
- Color is never the sole indicator of state (icons + text always accompany color)
- Screen reader announcements for all state changes (post published, error, etc.)
- Keyboard navigable — every action reachable without mouse
- Reduced motion mode respects `prefers-reduced-motion`
- High contrast mode for all charts (pattern fills, not just color)

---

### A. Platform Content Limits Reference

| Limit | X (Twitter) | LinkedIn |
|---|---|---|
| Text length | 280 chars (25K for Premium+) | 3,000 chars |
| Images per post | 4 | 9 (multi-image) |
| Videos per post | 1 | 1 |
| Max image size | 5 MB | 10 MB |
| Max video size | 512 MB | 200 MB (5 GB chunked) |
| Image formats | JPEG, PNG, GIF, WEBP | JPEG, PNG, GIF |
| Video formats | MP4 (H.264, AAC) | MP4, MOV |
| Max video duration | 140s (free), 4 hours (premium) | 15 min |
| Alt text | Yes (1000 chars) | Yes |
| Polls | Yes (2-4 options, 5m-7d) | Yes (via Posts API) |
| Thread / multi-part | Yes (native reply chain) | No native threads |
| Hashtags | Inline # | {hashtag\|\#\|tag} format |
| Mentions | @username | @[Name](urn:li:...) format |
| Link preview | Automatic | Must set article fields manually |
| Edit after post | Limited (subscribers) | Commentary field only |
| Post rate limit | Per-endpoint, 15-min windows | 150 member posts/day |

### B. Error Code Quick Reference

| Code | HTTP | Retryable | Description |
|---|---|---|---|
| `AUTH_MISSING_KEY` | 401 | No | No API key provided |
| `AUTH_INVALID_KEY` | 401 | No | API key not recognized |
| `AUTH_ACCOUNT_EXPIRED` | 401 | No | OAuth tokens expired, re-auth needed |
| `VALIDATION_FAILED` | 400 | No | Request body validation failed |
| `CONTENT_TOO_LONG` | 400 | No | Text exceeds platform limit |
| `MEDIA_TYPE_UNSUPPORTED` | 400 | No | Media type not supported on target platform |
| `MEDIA_TOO_LARGE` | 400 | No | File exceeds size limit |
| `PLATFORM_RATE_LIMITED` | 429 | Yes | Platform rate limit hit, retry after delay |
| `PLATFORM_AUTH_FAILED` | 502 | No | Platform rejected our auth (token may need refresh) |
| `PLATFORM_UNAVAILABLE` | 502 | Yes | Platform API is down |
| `PLATFORM_REJECTED` | 422 | No | Platform rejected content (e.g., duplicate, policy) |
| `DUPLICATE_POST` | 409 | No | Idempotency key already used |
| `NOT_FOUND` | 404 | No | Resource not found |
| `PROVIDER_FALLBACK_EXHAUSTED` | 502 | Yes | All providers for platform failed |
| `INTERNAL_ERROR` | 500 | Yes | Unexpected internal error |

### C. API Key Format

```
op_<workspace_id_prefix>_<32_random_chars>

Example: op_01HWX_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

- Prefix `op_` identifies it as an Open Posting key
- Workspace prefix allows quick identification without DB lookup
- 32 random chars provide 192 bits of entropy

### D. Webhook Event Types

```typescript
type WebhookEvent =
  | 'post.published'          // Post successfully published to all targets
  | 'post.partially_failed'   // Some targets failed
  | 'post.failed'             // All targets failed
  | 'post.scheduled'          // Post scheduled for future
  | 'post.deleted'            // Post deleted
  | 'account.connected'       // New social account connected
  | 'account.expired'         // Account tokens expired
  | 'account.refreshed'       // Account tokens refreshed
  | 'engagement.completed'    // Engagement action completed
  | 'engagement.failed'       // Engagement action failed
  | 'media.uploaded'          // Media uploaded to storage
  | 'media.platform_ready';   // Media uploaded to platform, ready for post
```

### E. Platform Analytics Metrics Reference

| Metric | X (Official) | X (GetXAPI) | LinkedIn |
|---|---|---|---|
| **Impressions** | `public_metrics.impression_count` | Via tweet detail | `shareStatistics.impressionCount` |
| **Unique Impressions** | N/A | N/A | `shareStatistics.uniqueImpressionsCount` |
| **Likes** | `public_metrics.like_count` | Via tweet detail | `reactionSummaries.LIKE` + all reaction types |
| **Comments/Replies** | `public_metrics.reply_count` | Via tweet detail | `commentSummary.count` |
| **Shares/Retweets** | `public_metrics.retweet_count` | Via tweet detail | `shareStatistics.shareCount` |
| **Quotes** | `public_metrics.quote_count` | N/A | N/A |
| **Bookmarks/Saves** | `public_metrics.bookmark_count` | N/A | N/A |
| **Clicks** | `non_public_metrics.url_link_clicks` | N/A | `shareStatistics.clickCount` |
| **Profile Clicks** | `non_public_metrics.user_profile_clicks` | N/A | N/A |
| **Engagement Rate** | Calculated | Calculated | `shareStatistics.engagement` |
| **Video Views** | `public_metrics.view_count` | N/A | Via video analytics |
| **Video 25% Watched** | `organic_metrics.playback_25_count` | N/A | N/A |
| **Video 50% Watched** | `organic_metrics.playback_50_count` | N/A | N/A |
| **Video 75% Watched** | `organic_metrics.playback_75_count` | N/A | N/A |
| **Video 100% Watched** | `organic_metrics.playback_100_count` | N/A | N/A |
| **Follower Count** | User object lookup | User info endpoint | Organization stats API |
| **Follower Growth** | Computed from snapshots | Computed from snapshots | Computed from snapshots |
| **Follower Demographics** | N/A | N/A | `organizationFollowerStatistics` (function, seniority, industry, region) |
| **Page Views** | N/A | N/A | `organizationPageStatistics` |
| **Organic vs Promoted** | `organic_metrics.*` / `promoted_metrics.*` | N/A | Separate `adAnalytics` endpoint |
| **Time-bound Stats** | Per-request (real-time) | Per-request (real-time) | `timeIntervals` param (DAY/MONTH granularity, 12-month window) |

**LinkedIn Reaction Types (all counted as "likes" in normalized schema, broken out in platformSpecific):**
- `LIKE` → "Like"
- `PRAISE` → "Celebrate"
- `EMPATHY` → "Love"
- `MAYBE` → "Curious"
- `INTEREST` → "Insightful"
- `APPRECIATION` → "Support"

### F. Media Format Reference

| Format | MIME Type | X Support | LinkedIn Support | Max Size (X) | Max Size (LI) | Notes |
|---|---|---|---|---|---|---|
| JPEG | image/jpeg | Yes | Yes | 5 MB | 10 MB | Best compatibility |
| PNG | image/png | Yes | Yes | 5 MB | 10 MB | Supports transparency |
| WEBP | image/webp | Yes | **No** | 5 MB | N/A | Auto-convert to JPEG for LI |
| GIF (static) | image/gif | Yes (as image) | Yes (as image) | 5 MB | 10 MB | Treated as image |
| GIF (animated) | image/gif | Yes (as video) | **No** | 15 MB | N/A | Counts against video slot on X |
| MP4 (H.264/AAC) | video/mp4 | Yes | Yes | 512 MB | 200 MB | Primary video format |
| MOV | video/quicktime | **No** | Yes | N/A | 200 MB | LinkedIn only |
| PDF | application/pdf | **No** | Yes | N/A | 100 MB | LinkedIn documents/carousel |
| PPTX | application/vnd... | **No** | Yes | N/A | 100 MB | Auto-converted to PDF carousel |

**X Media Categories (for chunked upload INIT):**
- `tweet_image` — Static images attached to tweets
- `tweet_gif` — Animated GIFs attached to tweets
- `tweet_video` — Videos attached to tweets
- `dm_image` / `dm_gif` / `dm_video` — Direct message media
- `subtitles` — Video subtitle files (SRT)

**X Video Constraints:**
- Duration: 0.5s–140s (free), 0.5s–4 hours (Premium+)
- Resolution: min 32×32, max 1920×1200 (or 1200×1920)
- Frame rate: 40fps max
- Aspect ratio: 1:3 to 3:1

**LinkedIn Video Constraints:**
- Duration: 3s–15 minutes
- Resolution: min 256×144, max 4096×2304
- File size: 75KB–200MB (single upload), up to 5GB (chunked)

### G. Glossary

| Term | Definition |
|---|---|
| **Workspace** | Isolated tenant. Each workspace has its own API key, accounts, and posts. |
| **Social Account** | An authorized connection to a platform (e.g., @user's X account). |
| **Post** | A content unit that may be published to multiple targets. |
| **Post Target** | A specific (post, social account) pair tracking per-platform status. |
| **Provider** | An API backend for a platform (e.g., X Official vs. GetXAPI). |
| **Provider Router** | Routes requests to available providers with fallback. |
| **Circuit Breaker** | Pattern that stops calling a failing provider to prevent cascade. |
| **Idempotency Key** | Client-provided key ensuring a post is created at most once. |
| **MCP** | Model Context Protocol — standard for LLM tool integration. |
| **OpenClaw** | Standard for AI agent skill definitions. |
| **DLQ** | Dead Letter Queue — holds permanently failed jobs for inspection. |
| **Account Group** | User-defined collection of social accounts for batch posting operations. |
| **Health Score** | 0-100 score per account based on token freshness, rate limit headroom, and recent errors. |
| **Analytics Snapshot** | Point-in-time capture of post metrics, stored for historical trend analysis. |
| **Platform Override** | Per-platform content customization within a single post (e.g., short text for X, long for LinkedIn). |
| **Blurhash** | Compact image placeholder hash for loading states in the dashboard. |

---

*This PRD is a living document. Update as implementation progresses and platform APIs evolve.*
