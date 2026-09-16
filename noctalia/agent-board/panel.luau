--!nonstrict
local status = noctalia.state.get("agent_board_status") or { running = false, busy = false, url = "" }

local render

local function send(action)
  noctalia.state.set("agent_board_command", {
    action = action,
    requestId = tostring(noctalia.nowMs()),
  })
end

local function actionButton(textKey, glyph, action, variant)
  return ui.button({
    text = noctalia.tr(textKey),
    glyph = glyph,
    variant = variant or "outline",
    contentAlign = "start",
    enabled = status.busy ~= true,
    onClick = function()
      send(action)
    end,
  })
end

render = function()
  local running = status.running == true
  local children = {
    ui.row({ gap = 8, align = "center" }, {
      ui.glyph({ name = "layout-dashboard", size = 18, color = running and "primary" or "on_surface_variant" }),
      ui.title({ text = noctalia.tr("panel.title") }),
    }),
    ui.label({
      text = running and noctalia.tr("panel.state.running") or noctalia.tr("panel.state.stopped"),
      color = running and "primary" or "on_surface_variant",
    }),
    ui.label({ text = tostring(status.url or ""), color = "on_surface_variant" }),
    ui.separator({}),
    actionButton("actions.open", "external-link", "open", running and "primary" or "outline"),
    actionButton("actions.start", "player-play", "start"),
    actionButton("actions.stop", "player-stop", "stop"),
    actionButton("actions.restart", "refresh", "restart"),
  }
  if noctalia.string.trim(tostring(status.error or "")) ~= "" then
    table.insert(children, ui.label({ text = tostring(status.error), color = "error" }))
  end
  panel.render(ui.column({ gap = 8 }, children))
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
