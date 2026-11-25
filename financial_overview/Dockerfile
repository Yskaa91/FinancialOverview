# The base image is pinned here instead of taken from BUILD_FROM. The Supervisor
# does not reliably pass build.yaml's build_from through (a build resolved it to
# the Alpine Home Assistant base), and an Alpine base breaks the prebuilt engines
# this app depends on: Prisma and better-sqlite3 ship glibc binaries.
FROM node:22-bookworm-slim AS toolchain
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# -- all dependencies, for the Next.js build ---------------------------------
FROM toolchain AS deps-dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# -- Next.js build -----------------------------------------------------------
FROM toolchain AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/tmp/build.db"
COPY --from=deps-dev /app/node_modules ./node_modules
COPY . .
# Prisma reads its config (and therefore a URL) even to generate a client.
RUN npx prisma generate \
 && npm run build

# -- production dependencies -------------------------------------------------
FROM toolchain AS deps-prod
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/tmp/build.db"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# The generated client has to live in *these* node_modules: the migrate command
# and the app both import it.
RUN npx prisma generate

# -- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/data/financial.db"

WORKDIR /app
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts/container-env.mjs ./scripts/container-env.mjs
COPY run.sh /run.sh
RUN chmod +x /run.sh && mkdir -p /data

EXPOSE 3000
CMD ["/run.sh"]
