# syntax=docker/dockerfile:1.7

# ── deps stage ──────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat openssl openssl-dev
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --include=dev

# ── builder stage ───────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat openssl openssl-dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x,linux-musl
RUN npx prisma generate
RUN npm run build

# ── runtime: web ────────────────────────────────────────────────────
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat openssl tini util-linux \
 && addgroup -g 1001 nodejs \
 && adduser -u 1001 -G nodejs -s /bin/sh -D nextjs \
 && mkdir -p /home/nextjs/.codex \
 && chown -R nextjs:nodejs /home/nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/@openai ./node_modules/@openai
COPY --from=builder /app/node_modules/.bin/codex ./node_modules/.bin/codex

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENV HOME=/home/nextjs
ENV PATH=/app/node_modules/.bin:$PATH
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]

# ── runtime: worker ────────────────────────────────────────────────
FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl tini git file \
 && addgroup -g 1001 nodejs \
 && adduser -u 1001 -G nodejs -s /bin/sh -D nextjs \
 && mkdir -p /home/nextjs/.codex \
 && chown -R nextjs:nodejs /home/nextjs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
USER nextjs
ENV HOME=/home/nextjs
ENV PATH=/app/node_modules/.bin:$PATH
ENTRYPOINT ["tini", "--"]
CMD ["node_modules/.bin/tsx", "workers/asset-worker.ts"]
