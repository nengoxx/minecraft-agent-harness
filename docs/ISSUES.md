# Local evaluation issues

## H01 — Connection rejected before gameplay

Observed three 1.21.6 joins through ViaProxy to server 26.3 that ended with
`multiplayer.disconnect.invalid_player_movement` on the second unsolicited
position packet. Qwen executed zero tools. A separate model-free connection probe
reproduced the rejection with finite position/rotation values.

The old Mineflayer emits no `tick_end`. Server 26.3 requires a tick boundary
between position packets; see the [upstream report](https://github.com/PrismarineJS/mineflayer/issues/4189).
The harness buffers movement, so boundaries must accompany actual sends, including
flushes. Updated `throttleMovementPackets` to send the boundary on protocols that
define it. A failing regression reproduces the buffered violation and now passes;
legacy protocols receive no new packet. A 15-second model-free retest stayed
connected until its planned shutdown, followed by the task session staying joined.
Historical suite after this change: 320 passed. Superseded by the dependency upgrade:
removed the wrapper and now use native upstream tick boundaries (see DEPENDENCIES.md).

## H02 — Movement speed decoded as scale

Join packets decoded the player's movement speed (0.1) as `generic.scale` and
mining efficiency (0) as `generic.movement_speed`. The pinned minecraft-data
1.21.6 attribute mapping omits four entries and shifts later IDs. This would
prevent normal walking independently of Qwen's decisions.

Added a narrow patch to the installed 3.116.0 protocol table using the corrected
[upstream mapping](https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.21.6/proto.yml),
also present in Mindcraft's newer locked data package. No dependency upgrade.
Regression decodes actual wire IDs/values through minecraft-protocol: it failed
before correction and passes afterward. T02 walked/gathered successfully. The
3.119.0 upgrade now supplies this correction; the temporary patch was removed.

## H03 — Enchanted tools cannot gather

T01 chose native `gather(oak_log, count: 4)` twice; both attempts failed with
`enchantments is not iterable`. The bot walked toward the tree, but logs/planks
remained 10/63. Stopped after the repeated mechanical failure, with no rescue.

The pinned prismarine-item returns the modern component wrapper object from
`item.enchants`, while dig-time calculation expects an array of named levels.
Reproduced through the installed item getter and block dig-time API. A narrow
prismarine-item patch normalizes the component to that existing contract, retaining
already-normalized arrays. This is the same specific correction present in the
Mindcraft fork, applied only after independent reproduction here. Both regressions
pass; `patch-package` applies all seven patches. Live retest follows with a fresh
Pi transcript, retained inventory/world and the same Docker workspace/container.
T02 completed the task; reconnect confirmed all output persisted. The item
normalization remains necessary on the newer Mineflayer stack.

## Qualification limits

Protocol/model smoke success is not construction or resource-task competence.
Recorded model requests use medium reasoning and 8192 maximum output tokens;
Earlier configuration assumed medium mapped to a 2048-token budget. H06 records
why the launcher now sends the explicit budget field too. No independent
backend-internal token enforcement measurement is claimed.

## H04 — Completed request replay and restart pressure (observed; unresolved)

After T02 reported completion, the same previously received request appeared in
another turn's event list although the mailbox contained no new player request.
Qwen recognized the ambiguity, then was stopped during that deliberation. At the
next launch, `resumePrompt` urged it to continue immediately; it gathered four
more logs before consuming the new shelter request. The logs support unintended
repeat work, not a new user order. T03 therefore has retained-history confounds.

Candidate cause: a message can be presented inside an in-flight tool result and
remain queued for a later turn. Restart wording adds pressure to execute an old
plan. Diagnose receipt/event consumption with a focused regression before making
changes. Prefer explicit message identity/acknowledgment and checking current
requests on restart; do not add another planner or a house-specific controller.
No correction or successful retest is claimed yet.

## H05 — Shelter planning and recovery costs (observed; unresolved)

On 26.1, the first shelter run searched for unavailable coal ore, then spent a
26-second attack action with `chase:false` while the target stayed about eight
blocks away: zero swings, no kill. It subsequently equipped a sword and fled
successfully in 8.3 seconds. Client health stayed 20 despite repeated hit events.
The tool accurately reported the unsuccessful attack; transport-level success is
not task success. No shelter completion is established by these actions.

The persisted model output also contains inconsistent inventory arithmetic and
one unrelated arithmetic reasoning snippet. Its provenance is unresolved; do not
attribute that to Mineflayer or claim backend cross-request contamination without
capturing and comparing the actual request/response. Preserve the transcript for
follow-up. Ordinary current inventory and tool outcomes must remain the evidence
for evaluation, rather than the model's narration.

T03 ended after 390.954 seconds without a shelter. The final 159.639 seconds
produced no completed action; stopping preserved 12,804 characters of unfinished
planning that repeatedly changed dimensions, site and resource estimates.
This establishes prolonged generation, not a hung Mineflayer action. Next steps:
verify actual backend reasoning-budget enforcement, reproduce message replay,
and inspect the observation/prompt load before adjusting general planning
instructions. Do not replace Qwen with an operator-authored shelter script.

T05 with the explicit budget made more progress: one zombie killed, movement,
31 natural blocks cleared in three valid batches, then eight planks placed.
It attempted wall rows before establishing support/foundation, producing partial
`no_support` failures. The 15-minute deadline ended the unfinished task. This is
evidence of working batch mechanics and an observed sequencing error, not proof
that request configuration or combat automation alone will solve construction.

## H06 — Explicit Strata reasoning budget missing (request correction validated)

T04 used the exact Mindcraft house prompt with a fresh Pi transcript, mailbox and
workspace notes (old state archived; world/inventory retained). No game actions
were executed: after four message/plan reads, the next backend response continued
reasoning for 139.848 seconds until terminal stop. The raw HTTP response and Pi's
saved aborted message match exactly (8,565 reasoning characters). This rules out
SDK duplication of that passage and a Mineflayer action waiting underneath it.

Wire capture confirms `reasoning_effort: medium`, `max_tokens: 8192`, but no
`reasoning_budget_tokens`. Mindcraft's qualification record explicitly sent 2048.
A direct, non-executing replay of the captured request with only that field added
returned `send_dm` and `observe_world` calls in 74.751 seconds: 2,213 total output
tokens reported by the backend, 6,265 reasoning characters, 2,064 nonempty
reasoning deltas. Delta count is not an independently verified token count.
No replayed game tool was executed and no generated plan was fed into the trial.
The user confirmed no other workload was expected on the single-request backend.

Correction: load the small local `strata-budget` extension through Pi's existing
request hook; do not patch Pi or change backend-wide defaults. Explicit extension
paths are supported through the SDK loader; automatic discovery stays off.
A real-SDK/mock-HTTP regression verifies the actual outgoing budget, unaffected
other providers, upstream todo loading, missing-extension rejection and absence
of built-in host tools. Full checks: 322 passed. T05's live wire capture also
confirms the explicit field. Task-level success remains to be evaluated.

Evidence: `.agent-state/evaluation/T04-exact-prompt/` (raw requests/SSE, exact
wire-versus-Pi comparison, budget replay) and `T05-explicit-budget/`.

## H07 — No automatic defense controller (implemented; live qualification pending)

Mindcraft's `src/agent/modes.js` has a tick-driven `self_defense` mode that calls
`skills.defendSelf`, arbitrates against other actions, and resumes or reprompts
after interruption. This is application behavior above Mineflayer, not a
Mineflayer setting. The harness loads `mineflayer-pvp` and retains `defendSelf`,
but `installSkillCompatibility` explicitly replaces the modes controller with
`isOn: () => false`; no autonomous caller activates that skill.

The current harness sends hit events and grouped hit alerts to the model. Hits
can restart a model cycle and interrupt gathering, crafting and placement;
walking/fleeing continue. The bounded `attack` tool handles individual swings
without model calls, but Qwen must choose each fight. In T05 it killed a zombie
and walked to another site, while repeated phantom/zombie hits continued and a
later tool response included 40 grouped hits. Ari confirmed the bot is invincible
in this test. Constant health therefore does not refute these attacks or prove
a health/protocol bug. No automatic defense was enabled during T05.

This is a confound for construction evaluation, not proof that every planning
error comes from combat. For example, T05 also requested a 343-block clear when
`break_area` explicitly caps each call at 96 blocks.

Recommended next change: an optional native defense controller using existing
bounded combat actions and the same serialized action runner. Retain the task,
react without inference, limit pursuit and duration, exclude players/passive
animals, aggregate routine combat into one summary, and surface unresolved danger.
Stop/death/disconnection must cancel it. Interrupted world edits must preserve
and report partial progress; never blindly replay a whole crafting/build batch.
First verify defense latency, cancellation and task continuation, then repeat
the exact house request. No operator-authored construction plan should be added.

Do not transplant Mindcraft's entire modes system or simply enable the PvP
plugin alongside current movement. Both need exclusive control of the body;
the copied `isHostile` helper also classifies most `mob` entities broadly. Pi's
request/planning extensions do not replace a native real-time controller.

Implementation update: optional `--auto-defense` reuses the existing bounded
combat routine and Mindcraft-derived weapon selection under one runner priority
gate. It suppresses handled hit restarts, records reflex origins, preserves batch
checkpoints, limits safe retries and holds after explicit stop. Native deadlines
now measure execution, not time waiting for another action. Synthetic checks
cover concurrent inference, arbitration, cancellation, bounded targets and
placement continuation. See architecture.md for the exact policy and remaining
limits; this does not yet establish successful shelter construction.

## H08 — Stationary flying-threat policy and no return-to-work phase

T06 confirmed native swings and one phantom kill while inference continued, but
Ari observed no movement or scaffolding. The controller explicitly used
`chase: false` for flying mobs, a three-block trigger and no towers. This was our
policy mismatch, not a Qwen or Mineflayer compatibility failure. Phantom timeout
backoff also left subsequent hits to restart inference. No construction occurred.
Ari clarified: clear nearby hostile/engaged mobs, return to the interrupted work
position, then continue. The prior Mindcraft controller did not guarantee return.

Revision uses the existing Mindcraft PvP/pathfinder plugins for pursuit, attacks
and dirt climbing, with one native encounter/return wrapper. It retains the work
origin across target changes, accepts secondary attackers, verifies the return,
reports remaining scaffold and vetoes queued retries on failed return or danger.
Forty-five-second combat and sixty-second encounter budgets bound unreachable
threats; the whole-session trial remains forty-five minutes. Source and limits
are documented in architecture.md. Offline validation: 351 tests, lint and formatting passed. Opus closed all three
code-review blockers; the last grounded-origin and cancelled placement callback
regressions also pass. Revised live qualification pending.

## H09 — Plugin physics ticks lacked action ownership; PvP stop could affect later work

A local fake-bot probe reproduced `LATE_MUTATION_REFUSED` for an attack from a
physics listener during an active action. Listener registration predates the
runner's AsyncLocalStorage context. Pathfinder scaffold writes have the same
integration issue. Enabling plugin pursuit alone would therefore be incomplete.
Opus also identified PvP's five-second path-stop fallback, longer than runner
cleanup grace, and the modern `attack` packet missing from mutation guards.

The runner now offers opt-in `ownTicks()`, preserving old ownership for delayed
callbacks, guards the modern attack packet, and force-stops PvP during cleanup.
The encounter flushes pathfinder stop state after target loss before beginning
return or another pursuit. Tests use the actual installed PvP plugin to verify
attacks during ownership, no swing after cancellation during aiming, prompt
entityGone settlement and preservation of unrelated path-stop listeners.
No dependency patch or second movement controller was needed.

## H10 — Combat kept the scaffold block equipped (T07 integration regression)

T07 (ebd395f) moved, scaffolded and returned, but Ari observed swings with dirt.
Mindcraft's `defendSelf` re-equips on each loop; our adapter only equipped once.
This was an incomplete adaptation, not a Qwen planning or Pi issue. Simply
copying the timer also races pathfinder's equipment and placement operations.
Its `isBuilding` flag can clear on a path reset while a placement is in flight.

The correction reuses the weapon helper when placement/mining is idle and the
held item has changed. Encounter-local equipment/placement tracking survives path resets. The helper
returns its selected weapon so a competing hand change cannot redefine it as dirt.
A small optional PvP readiness hook checks before aiming and again before the
actual swing, including its delayed shield/aim queue. Deferred swings retry on
the next tick. Pursuit, cooldowns and shield mechanics remain in the PvP plugin.
Hooks restore their original descriptors, not action-bound proxy functions, and
pending placements settle before controller handoff. Regression tests exercise
actual PvP, delayed aim, reset during placement, restoration and cancellation.

## H11 — Fake scaffold state corrupted placement acknowledgements and limits

The retained pathfinder patch wrote fake stone into the local destination before
sending placement. Mineflayer's native acknowledgement logic then mistook a
server refusal returning air for a successful stone-to-air change. T07 emitted
63 air placement events. One encounter spent 17 net dirt while reporting only
eight placements; the whole run consumed the starting 27 dirt. These events are
not reliable world-edit counts, and the previous cap was not enforced correctly.

Remove the fake write and keep native server-confirmed placement. Actual plugin
regressions distinguish accepted dirt from refused air. Each encounter reserves
capacity for in-flight placements before calling Mineflayer, so stale paths
cannot overspend the eight-block limit. Unacknowledged attempts retain capacity
and are reported as uncertain; only an explicit server refusal refunds capacity. The existing Movements count hook also
restricts path search. Reports include confirmed cells and net dirt spent; these
can differ when return digging recovers dirt. No world blocks are secretly erased.

## H12 — Departing engaged targets were reported cleared

T07 sometimes returned while a tracked phantom was still alive but outside the
selection radius. With no explicit stop reason, the old summary called this
cleared and allowed an automatic retry. Outcomes now retain unconfirmed targets
as disengaged/lost/timeout and report unresolved danger. Only confirmed deaths
count as kills. Conservative retry veto does not prevent a new model-selected
body action. This avoids silently treating loss of view as combat success.

T07 correction validation: clean `npm ci` applied all seven patches; 361 tests,
lint and formatting passed. Actual Opus reviewed the incremental changes and
found no concrete blockers. Its final synchronous-abort note was addressed by
keeping cancellation inside the tracked Promise, preserving native async APIs.
Live qualification is separate and pending T08.

## H13 — Full inventory disguised as missed drops; mined counts treated as collected

T08 inherited 36 occupied storage slots and no dirt stack. Three gather calls
reported 78 mined blocks total but no inventory gain. The generic warning suggested
looking for drops or gathering again. Qwen did both, then falsely recorded 46 dirt
as collected. This combines insufficient native feedback with a model grounding
failure; no combat interruption explains the daylight recovery loop.

Expose Mineflayer's existing `emptySlotCount()` in inventory observations. After a
failed pickup with zero free slots, stop the batch instead of mining more blocks.
Existing stacks can still accept loot at zero empty slots, so successful merges
continue. Report collected item deltas separately from mined counts. Zero inventory
gain is a tool error with partial mining facts; full inventory gets the explicit
`inventory_full` code and asks the model to make room. The model still decides
what to store/discard. No loot predictor or automatic inventory manager is added.

## H14 — Return could complete while airborne near the saved position

T08 return summaries sometimes recorded fractional jump heights near the origin,
with subsequent landings a level lower. Require ground contact before completing
a ground return (water remains allowed). A regression verifies that passing the
origin mid-jump does not release the interrupted task; it waits for landing.

H13/H14 validation: 365 tests plus lint/format pass. Actual Opus review found no
hard blockers; the pickup timing note is covered by waiting for inventory updates
only when a full-slot pickup initially appears empty. Tests cover zero gain,
existing-stack merges, delayed pickup and landing before return. The error
explicitly warns against retrying without making room. Live recovery remains to
be qualified; these changes do not make Qwen's prior invented state trustworthy.
