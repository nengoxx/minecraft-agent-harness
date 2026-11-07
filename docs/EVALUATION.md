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

- T04 exact Mindcraft house request, fresh transcript/mailbox/notes, retained
  world/inventory: four read-only message/plan calls, then 139.848 seconds of
  reasoning until operator stop, no gameplay. Raw response reasoning exactly
  matched the Pi transcript. Wire capture exposed the missing explicit
  `reasoning_budget_tokens: 2048`; medium effort alone was sent. A sequential,
  non-executing replay adding only that field returned tool calls in 74.751
  seconds. This is diagnostic evidence, not a controlled performance benchmark.
  See H06 and `.agent-state/evaluation/T04-exact-prompt/`.

T05 repeats the exact request with the explicit budget provided through Pi's
standard extension hook. It starts fresh again, retains world/inventory, and
reuses the same Docker container. No model-generated replay plan is injected.
Only the game session issues inference requests; passive wire capture forwards
them unchanged. Automatic defense remains absent, a confound documented in H07.

The 15-minute process deadline stopped T05 at 19:13:37 UTC, 891.004 seconds after
task delivery. It killed one zombie, walked about 14 blocks, recovered from an
oversized clearing request and cleared 31 natural blocks in three valid batches
(24.151 seconds including the shell wrapper). Four wall-row batches then placed
eight oak planks; most requested cells lacked support because the foundation
was not established first. Inventory confirms 79 to 71 oak planks; eight placement
events agree. No completed floor, roof, door installation, house verification or
completion report. The partial build remains around x=-2359..-2360, y=112,
z=-229..-223. Additional native preparation digging occurred during placement;
the complete telemetry contains 36 digging events, not only the clearing batch.

The deadline was chosen by the operator at launch, not a default turn limit,
daylight event or model-declared completion. It cut off continued daytime work.
Treat this as incomplete at the observation cutoff, not proof Qwen could never
finish. Future continuing evaluations should record time checkpoints without
automatically disconnecting at those checkpoints; report any intervention and
stop reason explicitly.

All 14 captured requests carry the explicit 2048 budget. There were 270 hurt
events, including 266 attributed to mobs, with health/food remaining 20. Ari
confirmed invincibility; this is not a survival qualification. Two SDK validation
errors (overlong DM and unsupported read-plan argument) are visible in the Pi
transcript rather than native tool telemetry. Placement results explicitly show
partial failures even where the tool/shell reports successful execution. No
operator gameplay, construction plan or mid-task coaching was provided.
Evidence: `.agent-state/evaluation/T05-explicit-budget/`.

Bot, separate proxy, passive HTTP relay and reused Docker container are stopped.
The models file is restored to the direct backend URL. Global Pi configuration
hashes still match the initial snapshot. Full code checks passed: 322 tests.
Do not blindly resume the interrupted plan. Address H07 and report partial world
changes before a further construction trial; preserve Qwen's ownership of plans.
Iron gathering/smelting and successful shelter completion remain unqualified.

## T06 — First native-defense qualification (stopped for policy revision)

Source ee373ec, 338 offline tests passing, real Opus code review with no remaining
blockers. Automatic defense enabled; fresh transcript/mailbox/notes and retained
world/inventory. Planned process limit was 45 minutes. The ordinary request asked
Qwen to continue and finish the existing small wooden house, preserving player
builds; no coordinates, construction code or mid-task coaching were supplied.

Task delivery 19:56:38.534 UTC; stopped at 20:01:49.437 UTC after Ari observed
stationary phantom combat and clarified the desired behavior. This was a policy
revision, not the process deadline. Five native defense encounters produced one
confirmed phantom kill while model inference continued. No construction or
movement occurred. Qwen made ten read/communication calls and was still planning.
The explicit short-range, no-chase/no-tower flying policy caused stationary combat;
this is a harness policy mismatch, not evidence Qwen refused to move. Phantom
backoff also allowed unhandled hits to restart one model cycle.

Ari wants Mindcraft-like active pursuit/scaffolding, clearing nearby hostiles and
engaged attackers, then returning to the interrupted work position and continuing.
The next revision must qualify both pursuit and return. Native kills alone do not
establish task completion. T06 evidence is archived under
`.agent-state/evaluation/T06-native-defense/`. The bot, proxy, wire relay and reused
container are stopped; models configuration is restored to the direct backend.
A shutdown EPIPE was recorded when the terminal output pipe closed on Ctrl+C;
there was no such error during the active trial.
