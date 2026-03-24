# =============================================================================
# Crown Service Equipment Tracker — Multi-stage Docker Build
# =============================================================================

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# libc6-compat: required for some native npm packages on Alpine
# python3 / make / g++: required to compile native addons (pg, pdf-parse canvas)
RUN apk add --no-cache libc6-compat python3 make g++

# Copy whichever lockfile exists — the build works with npm, yarn, or pnpm
COPY package.json ./
COPY package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Install pnpm if a pnpm lockfile is present; otherwise fall back to npm install
RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --frozen-lockfile; \
    else \
      npm install; \
    fi

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Baked into the JS bundle at build time — tells the client to use /api/db/* routes
ARG  NEXT_PUBLIC_USE_DB=true
ENV  NEXT_PUBLIC_USE_DB=$NEXT_PUBLIC_USE_DB
ENV  NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone build output
COPY --from=builder /app/public                              ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

# Create import directories for file ingestion
RUN mkdir -p /app/imports/incoming /app/imports/processed /app/imports/failed \
 && chown -R nextjs:nodejs /app/imports

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
