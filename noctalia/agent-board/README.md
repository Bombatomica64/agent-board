# Agent Board — Noctalia bar widget

A one-click bar widget for [Noctalia](https://noctalia.dev) that starts and opens
the shared [agent-board](../../README.md).

- **Left click** — start the board (`docker compose up -d`, idempotent) and open
  it in your browser. If it's already running, just opens it.
- **Right click** — menu: Open / Start / Stop / Restart.
- The pill polls container status every 5s and tints its icon when the board is up.

## Install

The plugin is symlinked into Noctalia's plugin directory so it tracks this repo:

```bash
ln -s /home/lollo/Playground/agent-board/noctalia/agent-board \
      ~/.config/noctalia/plugins/agent-board
```

Then enable it in **Settings → Plugins → Agent Board** and add the widget to a
bar section (Settings → Bar). It's registered as a local plugin in
`~/.config/noctalia/plugins.json`.

## Settings (manifest defaults)

| Key             | Default                                                   |
| --------------- | -------------------------------------------------------- |
| `boardUrl`      | `http://localhost:4111`                                  |
| `composeFile`   | `/home/lollo/Playground/agent-board/docker-compose.yml`  |
| `containerName` | `agent-board`                                            |

Requires Docker (the widget shells out to `docker compose`) and `xdg-open`.
