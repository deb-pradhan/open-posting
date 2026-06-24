# Open Posting

Open-source, AI-agent-native social media bridge API. Post to X, LinkedIn, and more from a single endpoint.

## What is this?

Open Posting lets you post to multiple social media platforms through one simple API. Instead of building separate integrations for Twitter/X, LinkedIn, and every other platform, you call one endpoint and Open Posting handles the rest.

It's built specifically for AI agents — connect your agent via the built-in MCP server and it can schedule and publish content across all your accounts automatically.

## Features

- **Single API** — one endpoint to post to all platforms
- **MCP Server** — built-in support for AI assistants (Claude, etc.)
- **OAuth management** — handles authentication for each platform
- **Media pipeline** — upload and process images and videos
- **Scheduling** — queue posts for later publishing
- **Rate limiting** — smart fallbacks to avoid hitting platform limits
- **Analytics** — track how your posts perform across platforms

## Architecture

```
AI Agent / Your App
        ↓
  ┌─────────────────────┐
  │   REST API Gateway   │ ←→ MCP Server (for AI assistants)
  └─────────┬───────────┘
            ↓
  ┌─────────────────────┐
  │  Platform Providers  │ → X, LinkedIn, ...
  │  OAuth + Media       │
  │  Scheduler           │
  └─────────┬───────────┘
            ↓
       PostgreSQL
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js (TypeScript) |
| **Build** | Turborepo (monorepo) |
| **Database** | PostgreSQL + Prisma |
| **Deploy** | Docker, Railway |
| **Testing** | Unit + Integration |

## Project Structure

```
open-posting/
├── apps/        # API server + web dashboard
├── packages/    # Shared libraries + MCP server
└── docker-compose.yml
```

## Getting Started

```bash
git clone https://github.com/deb-pradhan/open-posting.git
cd open-posting
pnpm install
cp .env.example .env   # configure API keys and database
pnpm run dev
```

## License

MIT
