# Architecture

Each agent runs in one Node.js process. Game tools connect a Mineflayer bot to a pi model session.

```
bin/minecraft-agent.js ── src/cli.js ── src/config.js ── src/agent.js
                                                          │
          ┌───────────────────────────────────────────────┼─────────────────────────────────────┐
          ▼                                               ▼                                     ▼
   src/body/bot.js                                 src/tools/*.js                        src/model/session.js
   Mineflayer + pathfinder,                        tool definitions:                     pi createAgentSession,
   collectblock, pvp; tick                         game, workspace,                      scheduler, observation
   pacing, chat guard,                             messaging, shell,                     injection, compaction,
   damage and respawn                              shared machine                        session_history
          │                                               │
          ▼                                               ▼
   src/skills/*.js                                 src/sandbox/shell-sandbox.js
   pathing, digging, building,                     Docker, E2B or local shell with a tool relay
   crafting, line-of-sight perception
```

## The loop

`src/model/session.js` wraps a single `createAgentSession` from `@earendil-works/pi-coding-agent`.

- **Observation before every call.** pi's `transformContext` hook appends a fresh observation (visible blocks and
  entities, inventory, health, hunger, oxygen, unread messages, recent hits, optional image) to the outgoing request.
  It is not saved in the transcript.
- **Tools only.** The model acts only through tools. Assistant text stays private; speaking in game requires
  `post_chat` or `send_dm`.
- **Scheduling.** The runner is continuous. After a natural final answer it idles (10 s by default) and wakes on a
  timer or on an event. Events (chat, DMs, damage, low oxygen, respawn) are queued by key and coalesced; urgent ones
  wake the agent immediately and can interrupt the current body action. Model errors back off exponentially up to five
  minutes.
- **Persistence.** The session lives in `.agent-state/<name>/pi-sessions/` and is resumed with
  `SessionManager.continueRecent`, including the scheduler's next wake time. pi's automatic compaction keeps it inside
  the context window. `session_history` searches the full transcript, including compacted turns.

## The body

- **Action runner** (`createActionRunner` in `src/tools/game/runtime.js`). One body action at a time. Every body tool
  gets an `AbortSignal`; cancellation stops the pathfinder, clears control states and waits for the action to settle.
  An action that will not settle within 8 s marks the body unsafe and the process exits so it can be restarted
  cleanly. Writes that arrive after an action was cancelled are refused at the packet level.
- **Interruptions.** Damage interrupts most long actions so the model can react; `attack`, `flee`, `go_to` and the
  other keep-moving tools continue and report the hit afterwards. Hit alerts name the attacker, its position and its
  distance.
- **Perception** (`src/skills/perception.js`). Blocks and entities are visible only along an unobstructed line of
  sight within 64 blocks. Placement and digging check reach and face visibility the way a player would.
- **Tick pacing** (`src/body/tickpace.js`). Mineflayer's physics runs on a fixed 50 ms timer. When the server runs a
  slower `/tick rate`, the pacer steps physics at the server's rate so the bot does not move faster than the world.
- **Guards.** Outgoing chat packets that start with `/` are dropped (`src/body/chat-guard.js`), so the agent cannot
  run server commands even if it has operator status.

## Game tools

`src/tools/game-tools.js` is a small index. `createGameTools` builds a shared context (the bot, the action runner, the
`add` registration helper and the options it was given), then runs one builder per domain in `src/tools/game/`. Each
builder registers its tools and returns the helpers later builders need, which are merged into the context:

| File               | Contents                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `helpers.js`       | shared helpers: pathfinder loading, deadlines, stall watch, drop pickup, block lookups       |
| `core.js`          | `add` (validation, action runner, alerts), `call`, `blockAt`                                 |
| `perception.js`    | `observe_world`, `look`, `inspect_block`                                                     |
| `movement.js`      | `stop_action`, `go_to`, `fly_to`, `move`, `return_to_surface`, `door`, `go_through_door`     |
| `gathering.js`     | `gather`, `break_block`, `break_area`                                                        |
| `placement.js`     | placement planning, scaffolding and bridging used by `place`                                 |
| `building.js`      | `place`, `place_line`                                                                        |
| `items.js`         | `inventory`, `equip`, `eat`, `use_item`, `select_hotbar`, `drop_item`, `interact_*`, `sleep` |
| `combat.js`        | `attack`, `flee`                                                                             |
| `crafting.js`      | `craft`, `smelt`, `furnace`                                                                  |
| `containers.js`    | `view_window`, `click_slot`, `close_window`, `open_container`, `deposit`, `withdraw`         |
| `communication.js` | chat, DMs and the shared plan                                                                |

Below those sit `runtime.js` (action runner, skill compatibility, body stop), `guards.js` (edge, swim and built-block
guards), `observation.js`, `schema.js` (argument schemas and validation) and `failures.js` (failure codes). The index
keeps the tools in a fixed order, and `test/tools/tool-definitions.test.js` checks every tool name, description and
schema against a committed snapshot, so moving code between files cannot change what the model sees.

## Automatic defense

`--auto-defense` (default off) enables a 300 ms native controller independently
of model inference. One action runner owns the body. The controller interrupts
conflicting work, waits for cleanup, clears nearby hostile mobs, returns to the
interrupted position and releases queued tools. Qwen retains task planning.

`src/body/defense.js` selects threats and handles lifecycle/events;
`src/body/defense-combat.js` wraps the existing `mineflayer-pvp` and pathfinder
plugins used by Mindcraft. The wrapper does not implement attack timing, aiming,
shields or path search. It reuses Mindcraft-derived weapon selection and existing
terrain guards. No new package, second planner, container or modes registry.
The model's explicit `attack` tool retains its existing bounded combat routine.

- **Pursuit:** nearby hostiles within eight blocks, phantoms within twelve, and
  actual/engaged attackers within sixteen. Players and passive/neutral mobs are
  not proactive targets; provoked neutral attackers are eligible. PvP follows
  moving targets, including phantoms. It can use dirt scaffolding, limited to
  eight placements per encounter. Combat does not dig. Existing built-block,
  fall and lava guards still apply. Creepers use the same PvP behavior; shield
  tactics depend on the plugin and an equipped shield, not a new controller.
- **Encounter and return:** one fixed work origin (last grounded position when
  interrupted mid-jump), sixteen-block pursuit leash,
  forty-five-second fight budget and up to sixty seconds for the whole encounter
  (sixty-five-second hard deadline). Targets with no progress/path back off;
  a fresh melee-range hit clears unreachable-target backoff. Ranged hits do
  not repeatedly restart a pursuit already known to have no path. Additional attackers can interrupt the return
  phase within that budget. Return pathfinding may dig natural terrain, including
  its own dirt pillar. Cobblestone towers are disabled because the terrain guard
  would prevent digging down through them. Return is verified within 1.5 blocks
  horizontally and less than one vertically. Unreachable mobs/return routes are
  reported rather than called cleared. Leftover scaffolding is reported, not
  silently deleted. The origin survives unsuccessful back-to-back encounters
  until a return succeeds, new body work runs, or the bot respawns.
- **Ownership and stopping:** the runner offers opt-in `ownTicks()` so existing
  PvP/pathfinder physics listeners inherit the active action's ownership.
  Asynchronous callbacks retain their originating owner and cannot send late
  mutation packets, including the modern `attack` packet. `forceStop` and an
  immediate path reset avoid PvP's delayed stop fallback cancelling later work.
  Model-selected `attack`, `flee` and `return_to_surface` retain control. Explicit
  stop cancels queued work and holds defense until new valid body work or respawn.
- **Preservation:** low health, low oxygen, lava, fire, player damage, death,
  explicit stop or shutdown end combat without a forced return through danger.
  Native fire/low-health escape is not implemented in this slice. A failed return,
  unresolved engagement or aborted encounter invalidates queued retries. Checks
  happen after the defense gate, so a placement cannot resume before its outcome.
- **Progress and attribution:** `place_line`/`break_area` checkpoint completed and
  uncertain in-flight work. Interrupted actions report inventory changes and
  position. Placement and `go_to` retry at most twice after successful defense,
  checking current state; crafting, gathering, containers and scripts never
  automatically replay. Remaining placement scaffold prevents blind retry.
  Routine accepted mob hits do not restart inference. Players/environment and
  threats outside the controller's scope still wake Qwen. `defense_start/end`,
  phase/origin in observations, and `origin` on placement/dig telemetry distinguish
  native combat scaffolding from Qwen's construction. Results include targets,
  confirmed deaths, return outcome, inventory deltas and remaining scaffold.

The first T06 version swung at phantoms without pursuing or towering. Ari rejected
that policy; the revised implementation above reuses the actual PvP plugin.
Offline tests and Opus review qualify integration, not live house completion or
survival. See EVALUATION.md and ISSUES.md for observed outcomes.

### Other Mindcraft behavior considered

| Behavior                                      | Decision                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Swimming/drowning and fall protection         | Keep the existing harness swim/edge guards and oxygen wakes; avoid duplicate controllers.                                   |
| Getting unstuck                               | Keep existing movement stall/progress watchers; Mindcraft's generic stationary timer also interrupted combat in prior logs. |
| Collecting drops                              | Reuse current gathering/clearing pickup behavior; avoid unrelated idle detours.                                             |
| Low-health/fire escape                        | Useful follow-up using existing flee mechanics after defense qualification; not silently claimed implemented.               |
| Torch placement                               | Candidate once gathering/building works; consumes resources and needs task-aware choices.                                   |
| Hunting, idle staring and elbow-room movement | Leave out: unnecessary autonomous movement/targets can compete with the requested task.                                     |
| Catalog construction                          | Separate possible tool improvement; do not replace this Qwen-led planning trial with a prewritten house routine.            |

Opus reviewed the design and implementation via the installed Claude CLI, with
read-only tools. Local review evidence is under
`.agent-state/evaluation/defense-review/`; see ISSUES/EVALUATION for outcomes and
qualification limits.

## The sandbox

`run_shell` executes commands in a per-agent persistent machine (`src/sandbox/shell-sandbox.js`, `src/sandbox/docker.js`):

- `docker`: a persistent container per agent with the agent's state directory mounted as home.
- `e2b`: a cloud VM per agent, paused when idle and resumed on demand.
- `local`: `bash` in a directory under the agent's state.

All of them start a small HTTP relay (`src/sandbox/assets/relay.cjs`) and install a `tool` command. A script in the sandbox
can call `tool go_to '{"x":0,"y":64,"z":0}'`; the agent process long-polls the relay, runs the call through the same
session wrapper as a model tool call (validation, budgets, telemetry) and returns the JSON result.

## Messaging

`src/comms/mailbox-store.js` is a SQLite mailbox shared by all agents that use the same state directory. It stores
private DMs and the public chat each agent heard, with per-reader cursors. Unread counts appear in every observation.
In single-agent mode a shared `plan.md` noticeboard is available through `read_plan` and `append_plan`.

## Team mode

With `minecraft-agent team`, agents share a state directory (so the mailbox is common), get each other's names, and
share one machine through `shared_exec` (`src/shared-machine/`). Public chat tools and the noticeboard are removed;
coordination happens over DMs and the shared machine. See [multi-agent.md](multi-agent.md).

## Patches

`patches/` holds fixes to Mineflayer and its plugins, applied by `patch-package` on `npm install`: digging tool
materials, inventory and block placement handling, entity velocity updates, collectblock pickup cancellation,
pathfinder lava avoidance and stop behaviour, pvp updates on physics ticks, and suppression of protodef packet dumps.
Dig-time calculations omit the water penalty because the bot's water-state calculation is unreliable.
`src/vision/patches/` holds the renderer patch used by `npm run vision:install`.

## Process model and reconnects

`minecraft-agent run` starts a small supervisor that checks the model and key, then runs the agent in a child process.
When the child exits because the server kicked it or the connection dropped, the supervisor starts a new child after a
backoff (5s, 10s, 20s, 40s, then 60s; at most 8 tries in a row). The new child resumes the same pi session, sandbox and
mailbox, and keeps the original `--duration` deadline. Bans, whitelist kicks and duplicate logins exit for good, as do
startup errors on the first attempt. Errors print as one line on stderr and the process exits non-zero.

## Movement packets

The pinned upstream Mineflayer revision owns physics pacing, teleport replies and client tick boundaries.
The harness does not buffer movement packets: delaying them separately can break their ordering with `tick_end`.
