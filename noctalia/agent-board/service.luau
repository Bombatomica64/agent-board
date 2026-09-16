--!nonstrict
-- Owns every docker subprocess for Agent Board. The widget and panel only
-- read `agent_board_status` and post intents to `agent_board_command`.

local status = { running = false, busy = false, error = "", checkedAt = 0 }
local checkPending = false

local function cfg(key, fallback)
  local value = noctalia.getConfig(key)
  if type(value) == "string" and noctalia.string.trim(value) ~= "" then return value end
  if type(value) == "number" then return value end
  return fallback
end

local function boardUrl() return cfg("board_url", "http://localhost:4111") end
local function composeFile() return cfg("compose_file", "") end
local function containerName() return cfg("container_name", "agent-board") end

local function shellQuote(value)
  return "'" .. tostring(value or ""):gsub("'", "'\\''") .. "'"
end

local function publish()
  status.checkedAt = noctalia.nowMs()
  noctalia.state.set("agent_board_status", {
    running = status.running,
    busy = status.busy,
    error = status.error,
    url = boardUrl(),
    checkedAt = status.checkedAt,
  })
end

local function checkStatus()
  if checkPending then return end
  checkPending = true
  local nameFilter = `name=^{containerName()}$`
  local command = `docker ps --filter {shellQuote(nameFilter)} --filter status=running -q`
  noctalia.runAsync(command, function(result)
    checkPending = false
    if result and result.exitCode == 0 then
      status.running = noctalia.string.trim(result.stdout or "") ~= ""
      status.error = ""
    else
      status.running = false
      status.error = noctalia.string.trim((result and result.stderr) or "docker unavailable")
    end
    publish()
  end, 10000)
end

local function openBoard()
  noctalia.runAsync(`xdg-open {shellQuote(boardUrl())}`, function() end, 10000)
end

local function runCompose(args, successKey)
  local file = composeFile()
  if file == "" then
    noctalia.notifyError(noctalia.tr("title"), noctalia.tr("error.no_compose"))
    return
  end
  status.busy = true
  status.error = ""
  publish()
  local command = `docker compose -f {shellQuote(file)} {args}`
  noctalia.runAsync(command, function(result)
    status.busy = false
    if result and result.exitCode == 0 then
      noctalia.notify(noctalia.tr("title"), noctalia.tr(successKey))
    else
      status.error = noctalia.string.trim((result and result.stderr) or "")
      noctalia.notifyError(noctalia.tr("title"), noctalia.tr("result.failed", { error = status.error }))
    end
    publish()
    checkStatus()
  end, 120000)
end

local function executeCommand(command)
  if type(command) ~= "table" then return end
  local action = tostring(command.action or "")
  if action == "open" then
    openBoard()
  elseif action == "start" then
    runCompose("up -d", "result.started")
  elseif action == "start-and-open" then
    if status.running then
      openBoard()
    else
      local file = composeFile()
      if file == "" then
        noctalia.notifyError(noctalia.tr("title"), noctalia.tr("error.no_compose"))
        return
      end
      status.busy = true
      publish()
      noctalia.runAsync(`docker compose -f {shellQuote(file)} up -d`, function(result)
        status.busy = false
        if result and result.exitCode == 0 then
          openBoard()
        else
          status.error = noctalia.string.trim((result and result.stderr) or "")
          noctalia.notifyError(noctalia.tr("title"), noctalia.tr("result.failed", { error = status.error }))
        end
        publish()
        checkStatus()
      end, 120000)
    end
  elseif action == "stop" then
    runCompose("down", "result.stopped")
  elseif action == "restart" then
    runCompose("restart", "result.restarted")
  elseif action == "refresh" then
    checkStatus()
  end
end

noctalia.state.watch("agent_board_command", executeCommand)

publish()
checkStatus()

noctalia.setUpdateInterval(math.max(2, tonumber(cfg("refresh_interval", 5)) or 5) * 1000)

function update()
  checkStatus()
end
