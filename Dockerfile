# ============================================================================
# Open Posting — Multi-Stage Dockerfile
# ============================================================================

# Stage 1: Base
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

# Stage 2: Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/cli/package.json ./apps/cli/
RUN pnpm install --frozen-lockfile

# Stage 3: Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=deps /app/apps/cli/node_modules ./apps/cli/node_modules
COPY . .
RUN pnpm turbo build

# Stage 4: API server
FROM base AS api
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# Include DB schema + drizzle config for migrations
COPY --from=builder /app/packages/db/src ./packages/db/src
COPY --from=builder /app/packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
RUN mkdir -p /data/media
EXPOSE 3000
CMD ["sh", "-c", "cd packages/db && npx drizzle-kit push --force && cd /app && node dist/server.js"]

# Stage 5: MCP server
FROM base AS mcp
COPY --from=builder /app/apps/mcp/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/server.js"]

# Stage 6: CLI
FROM base AS cli
COPY --from=builder /app/apps/cli/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
ENTRYPOINT ["node", "dist/index.js"]
