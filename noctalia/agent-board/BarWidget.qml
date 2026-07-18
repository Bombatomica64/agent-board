import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Modules.Bar.Extras
import qs.Services.UI
import qs.Widgets

// Bar widget for the shared agent-board.
//
// Left click : start the board (docker compose up -d, idempotent) and open it
//              in the browser; if it is already running, just open it.
// Right click: context menu with Open / Start / Stop / Restart.
// The pill polls container status every few seconds and tints its icon when
// the board is running.
Item {
  id: root

  // --- properties injected by Noctalia's plugin host ---
  property var pluginApi: null
  property ShellScreen screen
  property string widgetId: ""
  property string section: ""
  property int sectionWidgetIndex: -1
  property int sectionWidgetsCount: 0

  // --- settings (with manifest defaults) ---
  property var cfg: pluginApi?.pluginSettings || ({})
  property var defaults: pluginApi?.manifest?.metadata?.defaultSettings || ({})
  readonly property string boardUrl: cfg.boardUrl ?? defaults.boardUrl ?? "http://localhost:4111"
  readonly property string composeFile: cfg.composeFile ?? defaults.composeFile ?? ""
  readonly property string containerName: cfg.containerName ?? defaults.containerName ?? "agent-board"

  // whether the container is currently up
  property bool boardRunning: false

  implicitWidth: pill.width
  implicitHeight: pill.height

  // --- status polling -------------------------------------------------------
  Timer {
    id: statusTimer
    interval: 5000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: statusProcess.running = true
  }

  Process {
    id: statusProcess
    running: false
    command: ["sh", "-c", "docker ps --filter name=^" + root.containerName + "$ --filter status=running -q"]
    stdout: StdioCollector {
      onStreamFinished: root.boardRunning = (text.trim() !== "")
    }
  }

  // --- actions --------------------------------------------------------------
  Process {
    id: startProcess
    running: false
    command: ["sh", "-c", "docker compose -f '" + root.composeFile + "' up -d && xdg-open '" + root.boardUrl + "'"]
    onExited: statusProcess.running = true
  }
  Process {
    id: stopProcess
    running: false
    command: ["docker", "compose", "-f", root.composeFile, "down"]
    onExited: statusProcess.running = true
  }
  Process {
    id: restartProcess
    running: false
    command: ["docker", "compose", "-f", root.composeFile, "restart"]
    onExited: statusProcess.running = true
  }
  Process {
    id: openProcess
    running: false
    command: ["xdg-open", root.boardUrl]
  }

  // --- right-click menu -----------------------------------------------------
  NPopupContextMenu {
    id: contextMenu
    model: [
      { "label": "Open board", "action": "open", "icon": "external-link" },
      { "label": "Start", "action": "start", "icon": "player-play" },
      { "label": "Stop", "action": "stop", "icon": "player-stop" },
      { "label": "Restart", "action": "restart", "icon": "refresh" }
    ]
    onTriggered: function (action) {
      contextMenu.close();
      PanelService.closeContextMenu(screen);
      if (action === "open")
        openProcess.running = true;
      else if (action === "start")
        startProcess.running = true;
      else if (action === "stop")
        stopProcess.running = true;
      else if (action === "restart")
        restartProcess.running = true;
    }
  }

  // --- the bar pill ---------------------------------------------------------
  BarPill {
    id: pill
    autoHide: false
    icon: "layout-dashboard"
    screen: root.screen
    customIconColor: root.boardRunning ? Color.mPrimary : Color.mOnSurface
    tooltipText: root.boardRunning ? ("Agent Board — running\n" + root.boardUrl) : "Agent Board — stopped (click to start)"
    oppositeDirection: BarService.getPillDirection(root)

    onClicked: {
      if (root.boardRunning)
        openProcess.running = true;
      else
        startProcess.running = true;
    }
    onRightClicked: PanelService.showContextMenu(contextMenu, root, screen)
  }
}
