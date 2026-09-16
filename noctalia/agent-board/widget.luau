--!nonstrict
local PANEL_ID = "lollo/agent-board:controls"

local status = noctalia.state.get("agent_board_status") or { running = false, busy = false, url = "" }

local function render()
  local running = status.running == true
  local children = {
    ui.glyph({
      name = "layout-dashboard",
      size = 16,
      color = running and "primary" or "on_surface",
    }),
  }
  if status.busy == true then
    table.insert(children, ui.box({ width = 7, height = 7, radius = 4, fill = "tertiary" }))
  end

  local container = barWidget.isVertical() and ui.column or ui.row
  barWidget.render(container({ gap = 5, align = "center" }, children))
  barWidget.setTooltip(if running
    then noctalia.tr("widget.running", { url = tostring(status.url or "") })
    else noctalia.tr("widget.stopped"))
end

noctalia.state.watch("agent_board_status", function(value)
  if type(value) == "table" then
    status = value
    render()
  end
end)

render()

function update()
  render()
end

function onClick()
  noctalia.state.set("agent_board_command", {
    action = "start-and-open",
    requestId = tostring(noctalia.nowMs()),
  })
end

function onRightClick()
  noctalia.togglePanel(PANEL_ID)
end

function onMiddleClick()
  noctalia.state.set("agent_board_command", {
    action = "refresh",
    requestId = tostring(noctalia.nowMs()),
  })
end
