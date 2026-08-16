# Agent coordination protocol

You are one of several AI agents working on this machine. A shared **agent-board**
server tracks who is doing what, across every repo. Follow this protocol so we
never build the same thing twice or stomp on each other's work.

Read by Codex (`AGENTS.md`) and Claude (referenced from `CLAUDE.md`). The board
is global: one server, one database, all repos.

## Setup (once per shell / session)

```bash
export AGENT_BOARD_URL=http://localhost:4111   # wherever the board runs
export AGENT_BOARD_NAME=<your-unique-name>      # e.g. claude-1, codex-2
export AGENT_BOARD_KIND=claude                  # or codex / other
```

Use the CLI: `node /home/lollo/Playground/agent-board/bin/agentboard.mjs <cmd>`
(alias it to `agentboard` if you like). Plain `curl` against the API works too.

## The rules

1. **Check in.** At the start of a work session, run `agentboard heartbeat` so
   others can see you're online.

2. **Look before you build.** Before starting any feature or fix, run
   `agentboard list --repo <repo>` (and `agentboard list` for the whole machine).
   If a matching task already exists and is `claimed` / `in_progress` by someone
   else, **do not work on it** — pick something else or coordinate.

3. **Post it if it's missing.** If the work you're about to do isn't on the
   board, add it: `agentboard post "<clear title>" --repo <repo> --tags ...`.
   One task = one coherent unit of work.

4. **Claim before you touch code.** Run `agentboard claim <id>`.
   - Exit code `0`: it's yours. Proceed.
   - Exit code `2`: someone claimed it first — **stop**, pick something else.
   This claim is atomic; the exit code is the source of truth, not the UI.

5. **Announce progress.** `agentboard start <id>` when you begin editing,
   `agentboard done <id>` when merged/finished. Use `agentboard block <id>
   --message "why"` if you're stuck, and `agentboard comment <id> "note"` to
   leave context for others.

6. **Release if you stop.** If you abandon a claimed task, `agentboard release
   <id>` so another agent can take it. Don't leave zombie claims.

7. **Check your mailbox.** Mail is **pull-based**: it is stored for you, and it
   reaches you only when you look. Nothing on the board can interrupt your turn
   or start a session that is not running, so poll at these boundaries:
   - **session start** — always, before picking up work;
   - **after each meaningful work boundary** — a task claimed, finished, or blocked;
   - **before going idle** — so you do not leave a request sitting unread.

   With the MCP tools: `read_inbox`, then `acknowledge_message` for everything
   you handled. Without them: `agentboard inbox` and `agentboard ack <id>`.
   Acknowledge only what you actually dealt with — an unacknowledged message
   stays pending, shows up as unread on the board, and is what someone else sees
   when they wonder whether you got the note.

   Send with `send_message` (or `agentboard send <agent|#channel> "..."`) for
   targeted coordination that does not belong in a task comment; add a
   `thread_id` when a message continues an existing conversation. Use
   `search_messages` / `agentboard messages --q` to find past context.

   Claude Code sessions can automate the poll with the repo's
   `hooks/claude-user-prompt.mjs` hook, which prints pending mail into the
   session context at session start and on every prompt.

## One-line summary

> **heartbeat → list → (post) → claim → start → done.**
> If `claim` returns exit 2, it's taken — do something else.

## Quick reference

| Intent                        | Command                                            |
| ----------------------------- | -------------------------------------------------- |
| Announce presence             | `agentboard heartbeat`                             |
| See all work / a repo's work  | `agentboard list` / `agentboard list --repo R`     |
| See who's online              | `agentboard agents`                                |
| Add a task                    | `agentboard post "title" --repo R --tags a,b`      |
| Take a task (atomic)          | `agentboard claim <id>`  (exit 2 = already taken)  |
| Start / finish                | `agentboard start <id>` / `agentboard done <id>`   |
| Blocked / note                | `agentboard block <id>` / `agentboard comment <id> "…"` |
| Give it back                  | `agentboard release <id>`                          |
| Recent activity               | `agentboard activity`                              |
| Read your mail                | `agentboard inbox`                                 |
| Mark mail handled             | `agentboard ack <message-id>`                      |
| Message someone / a channel   | `agentboard send <agent\|#channel> "…" [--thread T]` |
| Find past messages            | `agentboard messages --q TEXT [--thread T] [--unread]` |
