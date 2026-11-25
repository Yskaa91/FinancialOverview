ARG BUILD_FROM=node:22-bookworm-slim

# -- toolchain ---------------------------------------------------------------
# Only the builder stages need a compiler: better-sqlite3 and Prisma ship
# prebuilt binaries, but a missing prebuild must not break the build.
FROM ${BUILD_FROM} AS toolchain
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
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps-dev /app/node_modules ./node_modules
COPY . .
# Prisma only needs a URL to read its config, never to generate.
RUN DATABASE_URL="file:/tmp/build.db" npx prisma generate \
 && npm run build

# -- production dependencies -------------------------------------------------
FROM toolchain AS deps-prod
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# The generated client has to live in *these* node_modules: the migrate command
# and the app both import it.
RUN DATABASE_URL="file:/tmp/build.db" npx prisma generate

# -- runtime -----------------------------------------------------------------
FROM ${BUILD_FROM} AS runner
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
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts/container-env.mjs ./scripts/container-env.mjs
COPY run.sh /run.sh
RUN chmod +x /run.sh && mkdir -p /data

EXPOSE 3000
CMD ["/run.sh"]
