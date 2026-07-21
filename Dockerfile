# ── Stage 1: build TypeScript ─────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Stage 2: runtime with Playwright-managed Chromium ─────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Use Playwright's OWN Chromium build (the one that matches this Playwright
# version) instead of the distro's `chromium` package. The system package tracks
# the latest Debian Chromium, and after an image rebuild it can drift ahead of
# what Playwright speaks (CDP protocol mismatch) — the browser then crashes on
# launch with SIGTRAP ("Target page, context or browser has been closed").
# `--with-deps` also pulls the shared libraries Chromium needs.
RUN npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY src/pdf/templates ./dist/pdf/templates
COPY src/pdf/assets ./dist/pdf/assets
COPY index.html login.html clients.json ./
COPY favicon.svg favicon-32.png favicon-64.png ./
COPY ["Logo Zebra Blanco.png", "./"]
COPY fixtures/ ./fixtures/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||3000) + '/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
