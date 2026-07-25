#!/usr/bin/env bash
# ensure-board.sh — make sure AgentBoard is up, then register it with Claude Code.
# AgentBoard is "Slack + Jira for agents" — one Docker service on :4111.
#   Image: ghcr.io/bombatomica64/agent-board  (prebuilt, multi-arch)
#   Repo:  github.com/Bombatomica64/agent-board  (source, for the build fallback)
#
# By default it runs the prebuilt GHCR image — no clone, no build. If that image
# can't be pulled (offline, or the package is still private), it falls back to
# cloning the repo and building from source with docker compose.
#
# Idempotent: safe to run repeatedly. Env overrides:
#   AGENT_BOARD_URL    (default http://localhost:4111)
#   AGENT_BOARD_IMAGE  (default ghcr.io/bombatomica64/agent-board:latest)
#   AGENT_BOARD_DIR    (default ~/Playground/agent-board)   # build-fallback checkout
#   AGENT_BOARD_REPO   (default https://github.com/Bombatomica64/agent-board.git)
set -euo pipefail

URL="${AGENT_BOARD_URL:-http://localhost:4111}"
IMAGE="${AGENT_BOARD_IMAGE:-ghcr.io/bombatomica64/agent-board:latest}"
DIR="${AGENT_BOARD_DIR:-$HOME/Playground/agent-board}"
REPO="${AGENT_BOARD_REPO:-https://github.com/Bombatomica64/agent-board.git}"
MCP="$URL/mcp"

# Host port to publish — parsed from the URL, defaulting to 4111.
PORT_HOST="${URL##*:}"; PORT_HOST="${PORT_HOST%%/*}"
[[ "$PORT_HOST" =~ ^[0-9]+$ ]] || PORT_HOST=4111

up() { curl -fsS -m 3 -o /dev/null "$URL" 2>/dev/null; }

# Run the prebuilt image. Returns non-zero if it can't be pulled.
run_prebuilt() {
  echo "  pulling prebuilt image $IMAGE"
  docker pull "$IMAGE" >/dev/null 2>&1 || return 1
  echo "  docker run agent-board ($IMAGE)"
  docker run -d --name agent-board \
    -p "${PORT_HOST}:4111" \
    -e PORT=4111 \
    -e AGENT_BOARD_DB=/data/board.db \
    -e NG_ALLOWED_HOSTS=localhost,127.0.0.1 \
    -v agent-board-data:/data \
    --restart unless-stopped \
    "$IMAGE" >/dev/null
}

# Fallback: clone the repo (if needed) and build from source with compose.
build_from_source() {
  if [ ! -f "$DIR/docker-compose.yml" ]; then
    echo "  cloning $REPO -> $DIR"
    mkdir -p "$(dirname "$DIR")"
    git clone "$REPO" "$DIR"
  fi
  echo "  docker compose up -d --build ($DIR)"
  ( cd "$DIR" && docker compose up -d --build )
}

if up; then
  echo "✓ AgentBoard already up at $URL"
else
  echo "… AgentBoard not responding at $URL — bringing it up"
  # 1. Existing container just stopped? Reuse it.
  if docker ps -a --format '{{.Names}}' | grep -qx agent-board; then
    echo "  starting existing container"; docker start agent-board >/dev/null
  # 2. Prefer the prebuilt image; fall back to building from source.
  elif ! run_prebuilt; then
    echo "  prebuilt image unavailable — building from source"
    build_from_source
  fi
  # wait for health
  for i in $(seq 1 30); do up && break || sleep 1; done
  up && echo "✓ AgentBoard is up at $URL" || { echo "✗ AgentBoard did not come up"; exit 1; }
fi

# 3. Register with Claude Code (user scope) if not already present.
if command -v claude >/dev/null 2>&1; then
  if claude mcp get agent-board >/dev/null 2>&1; then
    echo "✓ Claude Code already knows agent-board"
  else
    echo "… registering agent-board with Claude Code (user scope)"
    claude mcp add --scope user --transport http agent-board "$MCP" && echo "✓ registered"
  fi
else
  echo "! 'claude' CLI not found — skip registration. Add manually:"
  echo "    claude mcp add --scope user --transport http agent-board $MCP"
fi
