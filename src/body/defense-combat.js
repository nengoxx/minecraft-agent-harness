import { untilAbort } from '../tools/game/runtime.js';
import { equipHighestAttack } from '../skills/skills.js';

const position = p => ({ x: p.x, y: p.y, z: p.z });
const counts = bot => {
    const result = {};
    for (const item of bot.inventory.items()) result[item.name] = (result[item.name] ?? 0) + item.count;
    return result;
};

// Mindcraft's PvP/pathfinder plugins own pursuit, climbing, cooldowns and shields.
// This wrapper coordinates equipment, encounter limits and the trip back to work.
export async function defendArea(
    { bot, signal, ownTicks, deadline, reportProgress = () => {} },
    {
        origin,
        choose,
        ready,
        skip,
        onEngage,
        onPhase,
        now = Date.now,
        fightUntil: requestedFightUntil = now() + 45000,
        equip = equipHighestAttack,
        pathfinderModule = () => import('mineflayer-pathfinder'),
        sleep = (ms, s) => untilAbort(new Promise(resolve => setTimeout(resolve, ms)), s),
    },
) {
    ownTicks();
    const module = await pathfinderModule(),
        { Movements, goals } = module.default ?? module;
    const inventoryBefore = counts(bot),
        stats = new Map(),
        scaffold = [],
        uncertain = [],
        placements = new Set(),
        equipment = new Set();
    let equipping = false,
        weaponType;
    // isBuilding alone becomes false when pathfinder resets a path, even if
    // its last placement is still awaiting the server. Keep those calls busy.
    const busy = () =>
        equipment.size > 0 || placements.size > 0 || bot.pathfinder.isBuilding?.() || bot.pathfinder.isMining?.();
    const track = (pending, operation) => {
        const job = Promise.resolve()
            .then(() => {
                signal.throwIfAborted();
                return operation();
            })
            .finally(() => pending.delete(job));
        pending.add(job);
        return job;
    };
    const drain = async () => {
        // An equip completion can start a placement. Keep draining until both
        // settle, including work that pathfinder's reset flags no longer expose.
        while (equipment.size || placements.size) await Promise.allSettled([...equipment, ...placements]);
    };
    const remaining = () => Math.max(0, 8 - scaffold.length - uncertain.length - placements.size);
    const equipWeapon = async () => {
        equipping = true;
        try {
            const weapon = await equip(bot);
            // Record the selected weapon, not a hand another plugin may have
            // changed while the inventory operation awaited acknowledgement.
            weaponType = weapon?.type;
        } finally {
            equipping = false;
        }
    };
    const dirt = bot.registry.itemsByName.dirt.id;
    const pursuit = new Movements(bot),
        returning = new Movements(bot);
    pursuit.canDig = false;
    returning.canDig = true;
    for (const movement of [pursuit, returning]) {
        movement.scafoldingBlocks = [dirt];
        movement.allow1by1towers = (inventoryBefore.dirt ?? 0) > 0;
        movement.exclusionAreasPlace.push(block => (block.position?.distanceTo(origin) > 16 ? 100 : 0));
        const count = movement.countScaffoldingItems;
        movement.countScaffoldingItems = () => Math.min(count.call(movement), remaining());
    }
    // Save descriptors, not actionBot's signal-bound method wrappers: those
    // wrappers must never escape this encounter into a later action.
    const placeDescriptor = Object.getOwnPropertyDescriptor(bot, 'placeBlock');
    const equipDescriptor = Object.getOwnPropertyDescriptor(bot, 'equip');
    const attackDescriptor = Object.getOwnPropertyDescriptor(bot.pvp, 'canAttack');
    const restoreHooks = () => {
        if (placeDescriptor) Object.defineProperty(bot, 'placeBlock', placeDescriptor);
        else delete bot.placeBlock;
        Object.defineProperty(bot, 'equip', equipDescriptor);
        if (attackDescriptor) Object.defineProperty(bot.pvp, 'canAttack', attackDescriptor);
        else delete bot.pvp.canAttack;
    };
    bot.placeBlock = function (...args) {
        // Reserve before starting: even a stale path or a concurrent reset
        // cannot spend a ninth block. Fail through pathfinder's normal replan.
        if (!remaining()) return Promise.reject(new Error('Defense scaffold limit reached'));
        return track(placements, async () => {
            try {
                return await placeDescriptor.value.apply(this, args);
            } catch (error) {
                // Only an explicit server refusal proves no block was placed.
                // A timeout may still land later; do not refund that capacity.
                if (!String(error.message).startsWith('Server refused to place')) {
                    const at = args[0]?.position?.plus(args[1]);
                    uncertain.push({ ...(at ? position(at) : {}), reason: String(error.message) });
                }
                throw error;
            }
        });
    };
    bot.equip = function (...args) {
        return track(equipment, () => equipDescriptor.value.apply(this, args));
    };
    bot.pvp.canAttack = () =>
        !signal.aborted && !equipping && !busy() && (weaponType === undefined || bot.heldItem?.type === weaponType);
    const priorMovements = bot.pvp.movements;
    bot.pvp.movements = pursuit;
    // GoalNear floors coordinates. A radius below one keeps its destination on
    // the original feet cell, rather than accepting a level above/below it.
    const home = new goals.GoalNear(origin.x, origin.y, origin.z, 0.5);
    let current = null,
        phase = null,
        changedAt = now(),
        bestDistance = Infinity,
        lastProgress = now(),
        retries = 0,
        returnRetries = 0,
        returned = false,
        reason = 'cleared',
        pendingStop = null;
    const fightUntil = Math.min(requestedFightUntil, deadline - 16000);
    const end = Math.min(now() + 60000, deadline - 1000);
    const entry = entity => {
        if (!stats.has(entity.id))
            stats.set(entity.id, { id: entity.id, target: entity.name, swings: 0, landed: 0, targetDied: false });
        return stats.get(entity.id);
    };
    const stopPvp = () => {
        bot.pvp.forceStop();
        // Flush pathfinder's sticky stop flag and resolve PvP's entityGone stop
        // immediately, so its five-second fallback cannot cancel a later path.
        if (!signal.aborted) bot.pathfinder.setGoal(null);
        current = null;
    };
    const onGone = entity => {
        if (!signal.aborted && entity.id === current?.id) bot.pathfinder.setGoal(null);
    };
    const onDead = entity => {
        if (stats.has(entity.id)) entry(entity).targetDied = true;
    };
    const onHurt = (entity, source) => {
        if (stats.has(entity.id) && source?.id === bot.entity.id) {
            entry(entity).landed++;
            lastProgress = now();
        }
    };
    const onSwing = () => {
        if (current) {
            entry(current).swings++;
            lastProgress = now();
        }
    };
    const onPlace = (_old, block) => {
        if (block?.name === 'dirt') scaffold.push({ ...position(block.position), block: block.name });
    };
    const onPath = result => {
        if (result.status === 'noPath') pendingStop = 'no_path';
    };
    const summary = () => {
        const after = counts(bot),
            inventoryDelta = {};
        for (const name of new Set([...Object.keys(inventoryBefore), ...Object.keys(after)])) {
            const delta = (after[name] ?? 0) - (inventoryBefore[name] ?? 0);
            if (delta) inventoryDelta[name] = delta;
        }
        const targets = [...stats.values()];
        for (const target of targets) {
            if (target.targetDied) target.stoppedBecause = 'killed';
            else
                target.stoppedBecause ??= bot.entities[target.id]
                    ? now() >= fightUntil
                        ? 'combat_timeout'
                        : 'disengaged'
                    : 'lost';
        }
        // Leaving view/range is not a confirmed kill. Preserve that uncertainty
        // instead of silently resuming an interrupted edit as though we cleared it.
        const unresolved = Boolean(choose(null)) || targets.some(t => !t.targetDied);
        return {
            origin: position(origin),
            stoppedAt: position(bot.entity.position),
            returned,
            resumeAllowed: returned && ready() && !unresolved && !uncertain.length && reason === 'cleared',
            reason:
                reason !== 'cleared'
                    ? reason
                    : unresolved
                      ? 'threats_unresolved'
                      : uncertain.length
                        ? 'placement_uncertain'
                        : reason,
            unresolved,
            distanceFromOrigin: bot.entity.position.distanceTo(origin),
            targets,
            confirmedDeaths: targets.filter(t => t.targetDied).length,
            inventoryDelta,
            scaffold: {
                placed: scaffold,
                uncertain,
                netDirtSpent: -(inventoryDelta.dirt ?? 0),
                left: scaffold.filter(
                    p => bot.blockAt(origin.offset(p.x - origin.x, p.y - origin.y, p.z - origin.z))?.name === p.block,
                ),
            },
        };
    };
    const listeners = {
        entityGone: onGone,
        entityDead: onDead,
        entityHurt: onHurt,
        attackedTarget: onSwing,
        blockPlaced: onPlace,
        path_update: onPath,
    };
    for (const [event, listener] of Object.entries(listeners)) bot.on(event, listener);
    bot.pi_attackStop = null;
    try {
        await equipWeapon();
        while (!signal.aborted && now() < end) {
            if (!ready() || bot.pi_attackStop) {
                reason = bot.pi_attackStop ?? 'self_preservation';
                break;
            }
            if (current && stats.get(current.id)?.targetDied) {
                skip(current.id, 'killed');
                stopPvp();
            }
            const next = now() < fightUntil ? choose(current) : null;
            if (next && bot.entity.position.distanceTo(origin) <= 16) {
                // Mindcraft restores its weapon throughout combat. Wait until
                // pathfinder has finished using the hand, then reuse its helper.
                if (!busy() && weaponType !== undefined && bot.heldItem?.type !== weaponType) await equipWeapon();
                if (next.id !== current?.id || phase !== 'combat') {
                    stopPvp();
                    await drain();
                    signal.throwIfAborted();
                    if (phase !== 'combat') onPhase('combat');
                    phase = 'combat';
                    current = next;
                    onEngage(next);
                    entry(next);
                    changedAt = lastProgress = now();
                    bestDistance = Infinity;
                    retries = 0;
                    pendingStop = null;
                    bot.pi_attackTargetId = next.id;
                    await bot.pvp.attack(next);
                }
                const distance = current.position.distanceTo(bot.entity.position);
                if (distance < bestDistance - 0.4) {
                    bestDistance = distance;
                    lastProgress = now();
                }
                if (!bot.pathfinder.goal && distance > bot.pvp.attackRange) {
                    if (++retries > 3) pendingStop = 'path_stopped';
                    else bot.pathfinder.setGoal(new goals.GoalFollow(current, bot.pvp.followRange), true);
                }
                if (pendingStop || now() - lastProgress > 5000 || now() - changedAt > 20000) {
                    const why = pendingStop ?? (now() - lastProgress > 5000 ? 'no_progress' : 'target_timeout');
                    entry(current).stoppedBecause = why;
                    skip(current.id, why);
                    stopPvp();
                }
            } else {
                if (next) {
                    skip(next.id, 'leash');
                    reason = 'leash';
                }
                if (phase !== 'return') {
                    stopPvp();
                    await drain();
                    signal.throwIfAborted();
                    phase = 'return';
                    onPhase(phase);
                    pendingStop = null;
                    bot.pi_attackTargetId = null;
                    bot.pathfinder.setMovements(returning);
                    returnRetries = 0;
                    bot.pathfinder.setGoal(home);
                }
                const p = bot.entity.position;
                if (
                    (bot.entity.onGround !== false || bot.entity.isInWater) &&
                    Math.hypot(p.x - origin.x, p.z - origin.z) <= 1.5 &&
                    Math.abs(p.y - origin.y) < 1
                ) {
                    returned = true;
                    break;
                }
                if (pendingStop) {
                    reason = 'return_no_path';
                    break;
                }
                if (!bot.pathfinder.goal) {
                    if (++returnRetries > 3) {
                        reason = 'return_no_path';
                        break;
                    }
                    bot.pathfinder.setGoal(home);
                }
            }
            await sleep(150, signal);
        }
        signal.throwIfAborted();
        if (!returned && reason === 'cleared') reason = 'return_timeout';
    } finally {
        stopPvp();
        await drain();
        restoreHooks();
        bot.pvp.movements = priorMovements;
        bot.pi_attackTargetId = null;
        bot.pi_attackStop = null;
        for (const [event, listener] of Object.entries(listeners)) bot.off(event, listener);
        if (signal.aborted) reason = 'cancelled';
        reportProgress(summary());
    }
    return summary();
}
