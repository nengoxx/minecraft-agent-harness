# Local compatibility baseline

Checked 2026-11-07. Mineflayer is a library imported by this harness; changing it
requires a local dependency install, not another service or another agent planner.
The system Pi installation is unrelated and remains isolated by the launcher.

## Selection

Pin Mineflayer to upstream commit
[`5a252e6d258882b042e60e21c37d552cdf3b3380`](https://github.com/PrismarineJS/mineflayer/commit/5a252e6d258882b042e60e21c37d552cdf3b3380).
This was the current upstream head when checked and is also the revision pinned
by the local Mindcraft fork. Its package version is 4.39.0, but the npm 4.39.0
release predates several important commits. Do not replace the commit URL with
that release number or an unpinned master URL.

Use minecraft-data 3.119.0, the current release and Mindcraft's version. Preserve
the lockfile. The existing collectblock/pathfinder/PvP APIs remain usable; no
adapter, new planner or rewritten movement system is needed.

## Removed compatibility code

- Harness movement buffering and the interim added tick-end shim. Upstream now
  owns physics timing, teleport replies and client tick boundaries
  ([merged fix](https://github.com/PrismarineJS/mineflayer/pull/4137)).
- Local entity velocity and item-use rotation hunks: supplied by newer upstream.
- Old minecraft-data attribute mapping patch: supplied by 3.119.0.
- Oxygen property/event wrapper: native metadata handling now isolates own air.
- Old blanket underwater dig penalty bypass and 500ms placement timeout: keep
  upstream behavior instead of carrying these unqualified shortcuts forward.

## Remaining patches

The existing patch-package mechanism applies these on `npm ci`:

| Package                                 | Reason and provenance                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mineflayer 4.39.0                       | Existing harness per-window inventory state IDs; Mindcraft's narrow mining-material correction; the crafting-result consumption and 2x2 synchronization fixes from upstream [PR 4195](https://github.com/PrismarineJS/mineflayer/pull/4195) and [PR 4196](https://github.com/PrismarineJS/mineflayer/pull/4196), already carried by Mindcraft. |
| minecraft-data 3.119.0                  | Mindcraft's 1.21.6 unsigned chat checksum correction.                                                                                                                                                                                                                                                                                          |
| prismarine-item 1.18.0                  | Normalize modern enchantment components to the existing named-array API; independently reproduced by failed harness gathering and fixed in Mindcraft too.                                                                                                                                                                                      |
| collectblock, pathfinder, PvP, protodef | Retained harness patches; unrelated Mindcraft behavior was not imported.                                                                                                                                                                                                                                                                       |

Remove each carry when the pinned upstream includes its fix. Review source and
run the regression suite before changing versions; package version alone does
not identify the pinned Mineflayer source.

## Validation and limitations

A clean local `npm ci` applied all seven patches. Regressions exercise native
movement tick ordering, velocity/physics, decoded attribute IDs, enchantments,
inventory window IDs, oxygen metadata and game-tool compatibility. The suite
also exercises the actual Docker shell backend. See EVALUATION.md for live
results; passing offline tests alone does not establish task competence.

Keep one reused Docker shell container. ViaProxy remains a separate process,
using its own project-local state. A repository fork is a maintenance destination,
not an extra runtime component. No custom Mineflayer fork is required: pin the
upstream source and keep the small reviewed patch set in this harness.

T07 corrections remove pathfinder's fake local stone placement and add a narrow,
optional PvP attack-readiness hook. Defense checks it before aiming and immediately
before swinging so asynchronous equipment/placement work cannot produce dirt
attacks. The existing plugin still owns pursuit, cooldowns and shield behavior.
