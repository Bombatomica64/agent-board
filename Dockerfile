# syntax=docker/dockerfile:1

# --- build stage: compile the Angular SSR app (browser + server bundles) ---
FROM node:26-slim AS build
WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the SSR output into dist/agent-board.
COPY . .
RUN npm run build

# --- runtime stage: just Node + the self-contained server bundle ---
# The Angular server bundle inlines all npm dependencies, so the runtime image
# needs no node_modules — only the built dist/ and a modern Node (for the
# built-in node:sqlite module).
FROM node:26-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4111 \
    AGENT_BOARD_DB=/data/board.db

COPY --from=build /app/dist ./dist

# The SQLite database lives on a mounted volume so it survives container
# rebuilds and recreations.
VOLUME ["/data"]
EXPOSE 4111

CMD ["node", "dist/agent-board/server/server.mjs"]
