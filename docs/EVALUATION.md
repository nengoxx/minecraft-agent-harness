# Local Qwen evaluation

Capability comes first: complete ordinary requests, retain useful output, recover
from interruptions, preserve player builds, and report the result truthfully.
Performance comes second: use native batches and scripts effectively, avoid
needless model calls, repeated observations, per-block planning and wasted travel.

Qwen is the only gameplay planner. The operator supplies a natural-language task,
observes the outcome and may stop a critical failure or demonstrated stall.
No supplied coordinates, build code, material plan or mid-task rescue. Source
changes happen between trials and require evidence of a particular failure.
Use the smallest correction and relevant regressions; retest before claiming a
capability improvement. Do not add another planner or import Mindcraft's patches
wholesale.

Trials cover gathering/crafting, resource processing (including iron), construction
and recovery. Start with small tasks that give clear inventory evidence, then
progress to larger tasks. Functional shelters need floor, protective walls/roof,
usable entrance and standing room; exact geometry and furniture are not required.

For each trial record the exact request/delivery time, source and model settings,
starting inventory/location/health/weather, actual tool calls/results, retained
output, world modifications, final report, duration and interventions. Distinguish
observed failure, reproduced cause, proposed fix, regression result and live retest.
Claims of completion require inventory or world evidence. Report uncertain causes
as uncertain. Reused inventory/world/history makes these exploratory comparisons,
not controlled A/B results.

## Instrumentation and delivery

The ignored `.agent-state/local/observer.mjs` loads through the existing
`--tools-module` interface and returns no additional tools. It snapshots the
client's observed state and accepts ordinary task text on stdin, delivering it to
the same native whisper receiver used by player messages. Requests are explicitly
marked `local input into native whisper receiver`; they are not claimed to have
arrived over the network. Qwen can reply to the online owner through normal game
whispers. Actual incoming game-chat delivery is qualified separately.

Evidence: `.agent-state/evaluation/observer.jsonl`, `latest-state.json`, the agent's
`telemetry.jsonl`, `diagnostics.jsonl` and `pi-sessions/` under
`.agent-state/game/amaia/`. The terminal and telemetry summaries are abbreviated;
inspect saved tool results and independent state when diagnosing outcomes.

One Docker container is reused for this identity/state directory. Only Qwen's
shell runs there; host files retain the notes and transcripts. The separate local
ViaProxy process owns its files under `.agent-state/proxy/`. Mindcraft stays stopped.

## Historical comparison

Reviewed Mindcraft's public/private handoffs, issue register and the Maia vault's
Minecraft supervision SPEC. Prior outcomes include small crafting successes,
unstable gather/craft accounting, and four incomplete shelter trials. Relevant
failure classes: incorrect observation, incomplete action feedback, loss of work
context, design drift on retry, misleading completion reports, and poor batch
selection. Those classes guide observation, not assumptions about this harness.
Mindcraft's final C17 correction has no subsequent house trial.

## Trial record

- Connection qualification: 26.1 unsupported by this pinned Mineflayer. Switched
  to its supported 1.21.6 protocol through ViaProxy to server 26.3. Immediate
  movement rejection reproduced without any model gameplay; see H01/H02 in ISSUES.
- T01 gather/craft: request 16 additional oak planks from newly gathered natural
  wood, preserving existing supplies/builds/containers. Baseline oak planks 63,
  oak logs 10; health/food 20. Two native four-log batches failed on H03. Terminal
  operator stop after about 62 seconds; no inventory output, no mid-task coaching.
  Evidence archived under `.agent-state/evaluation/T01-gather-craft/`.
- T02 repeats that request after H03 with fresh Pi history, retained world,
  inventory and workspace notes. The Docker container is reused.

  Completed in 118.786 seconds: five fresh logs gathered in 9.149 seconds and
  16 planks crafted in about 1.9 seconds. Final inventory 79 planks / 11 logs;
  report matched observation, no coaching. A model-free reconnect after upgrading
  dependencies confirmed the same counts on the server. Most elapsed time was
  model turns/notes/reporting rather than native mechanics. This is one small
  success, not proof of better construction or mining performance. The mailbox
  also retained the previous identical request; record that comparison confound.
  Evidence: `.agent-state/evaluation/T02-gather-craft/` and
  `upgrade-connection-probe.jsonl`.

## Dependency upgrade

See DEPENDENCIES.md for selection and patch provenance. The latest upstream
Mineflayer commit and minecraft-data release match Mindcraft's pinned stack.
Removed superseded movement and oxygen wrappers and attribute patch. A clean
install applies the remaining seven patches; native regressions cover the
behavior replacing those wrappers. Live 1.21.6 reconnect remained connected until
its planned 15-second shutdown, with inventory intact. The 26.1 probe also
passed, and the subsequent full session remained connected until operator stop.
Final offline validation: lint/format and 320 tests passed, none skipped.

- T03 shelter on the upgraded 26.1 stack: stopped after 390.954 seconds with no
  shelter placed. Qwen gathered four logs during resumed prior deliberation,
  read the shelter request, failed to find coal ore, attempted an out-of-reach
  attack, equipped a sword and fled successfully. The last completed action was
  followed by 159.639 seconds of generation without another completed action;
  terminal stop preserved 12,804 characters of unfinished reasoning repeatedly
  revising the site, dimensions and materials. Character count is not a measured
  token count. No coaching, construction code or rescue was supplied. Health
  remained 20; there was no connection kick. This is a failed exploratory shelter
  trial, not a controlled comparison or evidence that the harness is superior.
  Evidence: `.agent-state/evaluation/T03-shelter-upgraded/`.

The candidate bot and its separate proxy were stopped after T03. The one reused
Docker container is stopped, retained for the next trial. Do not launch blindly
into the interrupted T03 plan; diagnose H04/H05 before resuming construction.
Iron gathering/smelting and successful shelter completion remain unqualified.
