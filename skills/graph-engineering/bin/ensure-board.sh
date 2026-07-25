#!/usr/bin/env bash
# ensure-board.sh — make sure AgentBoard is up, then register it with Claude Code.
# AgentBoard is "Slack + Jira for agents" — one Docker service.
#   Repo:  github.com/Bombatomica64/agent-board   (compose service, port 4111)
#
# Idempotent: safe to run repeatedly. Env overrides:
#   AGENT_BOARD_URL   (default http://localhost:4111)
#   AGENT_BOARD_DIR   (default ~/Playground/agent-board)
#   AGENT_BOARD_REPO  (default https://github.com/Bombatomica64/agent-board.git)
set -euo pipefail

URL="${AGENT_BOARD_URL:-http://localhost:4111}"
DIR="${AGENT_BOARD_DIR:-$HOME/Playground/agent-board}"
REPO="${AGENT_BOARD_REPO:-https://github.com/Bombatomica64/agent-board.git}"
MCP="$URL/mcp"

up() { curl -fsS -m 3 -o /dev/null "$URL" 2>/dev/null; }

if up; then
  echo "✓ AgentBoard already up at $URL"
else
  echo "… AgentBoard not responding at $URL — bringing it up"
  # 1. Existing container just stopped?
  if docker ps -a --format '{{.Names}}' | grep -qx agent-board; then
    echo "  starting existing container"; docker start agent-board >/dev/null
  else
    # 2. Have the repo locally? compose it. Otherwise clone from your repo first.
    if [ ! -f "$DIR/docker-compose.yml" ]; then
      echo "  cloning $REPO -> $DIR"
      mkdir -p "$(dirname "$DIR")"
      git clone "$REPO" "$DIR"
    fi
    echo "  docker compose up -d --build ($DIR)"
    ( cd "$DIR" && docker compose up -d --build )
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
