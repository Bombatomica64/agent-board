# Agent Board — Noctalia bar widget

A one-click bar widget for [Noctalia](https://noctalia.dev) that starts and opens
the shared [agent-board](../../README.md).

- **Left click** — start the board (`docker compose up -d`, idempotent) and open
  it in your browser. If it's already running, just opens it.
- **Right click** — opens a small panel: Open / Start / Stop / Restart.
- **Middle click** — force a status refresh.
- The widget polls container status and tints its glyph when the board is up.

## Noctalia v5

This plugin was rewritten for Noctalia v5, which replaced the QML plugin system
with Luau. v4 and v5 plugins are not interchangeable — if you are still on v4,
use the `BarWidget.qml` version from before this commit.

| | v4 | v5 |
| --- | --- | --- |
| Runtime | QML on Quickshell | Luau, one isolated VM per entry |
| Manifest | `manifest.json` | `plugin.toml` |
| Plugin id | `agent-board` | `lollo/agent-board` |
| Install path | `~/.config/noctalia/plugins/` | `~/.local/share/noctalia/plugins/` |

Entries: `service.luau` owns every `docker` subprocess and publishes state,
`widget.luau` is the bar glyph, `panel.luau` is the action panel. They
communicate only through `noctalia.state`, since each runs in its own VM.

The v4 right-click context menu became a panel.

## Install

Symlink the plugin into Noctalia's local plugin directory so it tracks this repo:

```bash
ln -s /home/lollo/Playground/agent-board/noctalia/agent-board \
      ~/.local/share/noctalia/plugins/agent-board
noctalia msg config-reload
noctalia msg plugins enable lollo/agent-board
```

Then add the `agent-board` widget to a bar section in **Settings → Bar**.

## Settings

Configured in **Settings → Plugins → Agent Board**.

| Key                | Default                                                  |
| ------------------ | -------------------------------------------------------- |
| `board_url`        | `http://localhost:4111`                                  |
| `compose_file`     | `/home/lollo/Playground/agent-board/docker-compose.yml`  |
| `container_name`   | `agent-board`                                            |
| `refresh_interval` | `5` (seconds; was `5000` ms in v4)                       |

Requires Docker (the service shells out to `docker compose`) and `xdg-open`.
