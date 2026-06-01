# ── Stage 1: build TypeScript ─────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Stage 2: runtime with system Chromium ─────────────────────────────────────
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/pdf/templates ./dist/pdf/templates
COPY index.html clients.json ./
COPY favicon.svg favicon-32.png favicon-64.png ./
COPY ["Logo Zebra Blanco.png", "./"]
COPY fixtures/ ./fixtures/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||3000) + '/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
