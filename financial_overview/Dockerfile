# The base image is pinned here instead of taken from BUILD_FROM. The Supervisor
# does not reliably pass build.yaml's build_from through (a build resolved it to
# the Alpine Home Assistant base), and an Alpine base breaks the prebuilt engines
# this app depends on: Prisma and better-sqlite3 ship glibc binaries.
#
# No compiler toolchain, and none wanted: better-sqlite3 ships prebuilt binaries
# for every platform, but it also ships a binding.gyp, and npm reads a binding.gyp
# without an install script as "compile this with node-gyp". Without python3 that
# build fails outright. `--ignore-scripts` skips it, and the package then loads
# prebuilds/<platform>-<arch>.node, which is the binary we want anyway.
# `overrides` keeps one better-sqlite3 in the tree, so the Prisma adapter gets the
# prebuilt copy too instead of its own 12.x release, which has no prebuilds. The
# only install step we do need is Prisma's engine download, so it runs by hand.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --ignore-scripts \
 && npm rebuild @prisma/engines

# -- Next.js build, then everything the runtime does not need is dropped ------
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/tmp/build.db"
COPY . .
# Prisma reads its config (and therefore a URL) even to generate a client.
RUN npx prisma generate \
 && npm run build

# One install, then prune: the image used to run a second full `npm ci --omit=dev`
# in its own stage, which is minutes on a Pi for the same result.
# `prisma` is a runtime dependency (run.sh migrates on start), so it survives the
# prune; the generated client in node_modules/.prisma is not a package and is left
# alone. Then strip what only the build or another platform needed:
#   @next/swc-*        the Rust compiler, used by `next build`, not by `next start`
#   sharp-wasm32       image-optimisation fallback for other platforms
#   prebuilds/*.node   better-sqlite3 binaries for macOS, Windows and musl
#   .next/cache        Turbopack's rebuild cache, 60 MB of nothing at runtime
RUN npm prune --omit=dev \
 && rm -rf .next/cache \
 && rm -rf node_modules/@next/swc-* \
 && rm -rf node_modules/@img/sharp-wasm32 \
 && find node_modules/better-sqlite3/prebuilds -name '*.node' ! -name 'linux-*' -delete

# -- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/data/financial.db"

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
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
