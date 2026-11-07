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
Ari confirms Strata maps medium to a 2048-token reasoning budget internally.
No independent backend-internal enforcement measurement is claimed.

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
