# ==============================================================================
# Build Stage
#
# This stage installs all dependencies (including dev), builds the TypeScript
# source code into JavaScript, and prepares the production assets.
# --platform=$BUILDPLATFORM keeps the build on the native architecture: Bun 1.4
# aborts under QEMU emulation, which multi-arch builds hit on the non-native
# builder. The produced JS is architecture-independent.
# ==============================================================================
FROM --platform=$BUILDPLATFORM oven/bun:1.4.0 AS build

WORKDIR /usr/src/app

# Copy dependency manifests for optimized layer caching
COPY package.json bun.lock ./

# Install all dependencies (including dev dependencies for building).
# --ignore-scripts: the build only runs tsc, which needs type declarations,
# not compiled bindings. The BuildKit cache mount persists Bun's global
# package cache across builds.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

# Copy the rest of the source code
COPY . .

# Build the application
RUN bun run build


# ==============================================================================
# Production Dependencies Stage
#
# Bun resolves the lockfile and optional OpenTelemetry peers. The final runtime
# copies only these production dependencies into the Node image.
# ==============================================================================
FROM --platform=$BUILDPLATFORM oven/bun:1.4.0 AS production-dependencies

WORKDIR /usr/src/app

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --omit=peer --frozen-lockfile --ignore-scripts

# Conditionally install OpenTelemetry optional peer dependencies (Tier 3).
# These are not bundled by default to keep the base image lean. Enable at build time
# with: docker build --build-arg OTEL_ENABLED=true
ARG OTEL_ENABLED=true
RUN --mount=type=cache,target=/root/.bun/install/cache \
    if [ "$OTEL_ENABLED" = "true" ]; then \
      bun add --omit=dev --omit=peer --ignore-scripts @hono/otel \
        @opentelemetry/instrumentation-http \
        @opentelemetry/exporter-metrics-otlp-http \
        @opentelemetry/exporter-trace-otlp-http \
        @opentelemetry/instrumentation-pino \
        @opentelemetry/resources \
        @opentelemetry/sdk-metrics \
        @opentelemetry/sdk-node \
        @opentelemetry/sdk-trace-node \
        @opentelemetry/semantic-conventions; \
    fi


# ==============================================================================
# Production Stage
#
# This stage creates a minimal, optimized, and secure image for running the
# application. It uses a slim base image and only includes production
# dependencies and build artifacts.
# ==============================================================================
FROM node:24-bookworm-slim AS production

WORKDIR /usr/src/app

# Set the environment to production for performance and to ensure only
# production dependencies are installed.
ENV NODE_ENV=production

ARG APP_VERSION

# OCI image metadata (https://github.com/opencontainers/image-spec/blob/main/annotations.md)
LABEL org.opencontainers.image.title="sports-mcp-server"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.description="Get live scores, schedules, standings, team and player data for NFL, NBA, MLB, NHL, and soccer."
LABEL org.opencontainers.image.source="https://github.com/cyanheads/sports-mcp-server"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY package.json ./
COPY --from=production-dependencies /usr/src/app/node_modules ./node_modules

# Copy the compiled application code from the build stage
COPY --from=build /usr/src/app/dist ./dist

# Create and set permissions for the log directory, assigning ownership to the built-in Node user.
RUN mkdir -p /var/log/sports-mcp-server && chown -R node:node /var/log/sports-mcp-server

# Switch to the non-root user
USER node

# Define an argument for the port, allowing it to be overridden at build time.
# The `PORT` variable is often injected by cloud environments at runtime.
ARG PORT

# Set runtime environment variables
# Note: PORT is an automatic variable in many cloud environments (e.g., Cloud Run)
ENV MCP_HTTP_PORT=${PORT:-3010}
ENV MCP_HTTP_HOST="0.0.0.0"
ENV MCP_TRANSPORT_TYPE="http"
ENV MCP_SESSION_MODE="stateless"
ENV MCP_LOG_LEVEL="info"
ENV LOGS_DIR="/var/log/sports-mcp-server"
ENV MCP_FORCE_CONSOLE_LOGGING="true"

# Expose the port the server listens on
EXPOSE ${MCP_HTTP_PORT}

# Health check using Node's native fetch (slim image ships no curl/wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://localhost:'+(process.env.MCP_HTTP_PORT??'3010')+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The command to start the server
CMD ["node", "dist/index.js"]
