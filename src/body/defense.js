import { fightEntity } from '../tools/game/combat.js';
import { REFLEX_PROTECTED_TOOLS, untilAbort } from '../tools/game/runtime.js';
import { failureCode } from '../tools/game/failures.js';
import { equipHighestAttack } from '../skills/skills.js';

const NEUTRAL = new Set(['enderman', 'piglin', 'zombified_piglin', 'spider', 'cave_spider']);
const FLYING = new Set(['phantom', 'ghast', 'blaze', 'breeze', 'wither', 'ender_dragon']);
const mob = entity =>
    entity && !entity.username && entity.type !== 'player' && ['mob', 'hostile', 'animal'].includes(entity.type);

// Mindcraft's native defense policy, adapted to the harness's single body owner.
// Combat itself stays in the existing bounded routine, not a second PvP writer.
export function installDefense({
    bot,
    runner,
    perception,
    record = () => {},
    onOutcome = () => {},
    fight = fightEntity,
    equip = equipHighestAttack,
    now = Date.now,
    intervalMs = 300,
}) {
    const attackers = new Map(),
        skipped = new Map();
    let closed = false,
        armed = true,
        pending = null,
        controller = null,
        targetId = null,
        cooldown = 0,
        lastHandled = -Infinity,
        lastOutcome = null;
    const ready = () =>
        !closed &&
        armed &&
        bot.health > 8 &&
        !(bot.oxygenLevel < 10) &&
        !bot.entity?.isInLava &&
        !(Number(bot.entity?.metadata?.[0] ?? 0) & 1) &&
        !bot.isSleeping &&
        bot.entity?.position &&
        !runner.status.blocked &&
        !runner.status.reflexHeld;
    const live = e => mob(e) && e !== bot.entity && e.isValid !== false && e.position && bot.entities[e.id] === e;
    const threat = e =>
        live(e) &&
        ((attackers.get(e.id) ?? 0) > now() ||
            (!NEUTRAL.has(e.name) && (e.type === 'hostile' || e.kind === 'Hostile mobs' || e.name === 'phantom')));
    const eligible = e =>
        threat(e) &&
        e.name !== 'creeper' &&
        (skipped.get(e.id) ?? 0) <= now() &&
        e.position.distanceTo(bot.entity.position) <= (FLYING.has(e.name) ? 3 : 8) &&
        ((attackers.get(e.id) ?? 0) > now() || perception.isEntityVisible(bot, e, 8));
    const helpers = {
        perception,
        pathfinderModule: async () => {
            const p = await import('mineflayer-pathfinder');
            return p.default ?? p;
        },
        r2: v => Math.round(v * 100) / 100,
        sleepAbortable: (ms, signal) => untilAbort(new Promise(resolve => setTimeout(resolve, ms)), signal),
    };
    const pick = excluded =>
        Object.values(bot.entities ?? {})
            .filter(e => eligible(e) && !excluded.has(e.id))
            .sort(
                (a, b) =>
                    Number(attackers.has(b.id)) - Number(attackers.has(a.id)) ||
                    a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position),
            )[0];
    function tick() {
        if (!ready() || pending || now() < cooldown || REFLEX_PROTECTED_TOOLS.has(runner.status.active)) return;
        for (const map of [attackers, skipped]) for (const [id, until] of map) if (until <= now()) map.delete(id);
        const target = pick(new Set());
        if (!target) return;
        controller = new AbortController();
        targetId = target.id;
        const started = now(),
            results = [];
        record('defense_start', { id: target.id, target: target.name, interrupted: runner.status.active });
        pending = runner
            .run(
                'self_defense',
                async context => {
                    const origin = context.bot.entity.position.offset(0, 0, 0),
                        attempted = new Set(),
                        until = now() + 10000;
                    await equip(context.bot);
                    while (ready() && !context.signal.aborted && now() < until && attempted.size < 8) {
                        const next = pick(attempted);
                        if (!next) break;
                        targetId = next.id;
                        attempted.add(next.id);
                        const result = await fight(
                            {
                                id: next.id,
                                seconds: Math.min(4, (until - now()) / 1000),
                                max_distance: 4,
                                chase: !FLYING.has(next.name),
                            },
                            context,
                            helpers,
                            { minHealth: 8, protectTerrain: true, origin, shouldStop: () => !ready() },
                        );
                        results.push({ id: next.id, target: next.name, ...result });
                        if (
                            ['self_preservation', 'low_health', 'environment_damage'].includes(result.stoppedBecause) ||
                            result.stoppedBecause?.startsWith('hit_by_other')
                        )
                            break;
                        if (
                            !result.targetDied &&
                            result.stoppedBecause !== 'gone' &&
                            (result.swings === 0 ||
                                ['timeout', 'lost_sight', 'too_far'].includes(result.stoppedBecause))
                        )
                            skipped.set(next.id, now() + 30000);
                    }
                    return { targets: results };
                },
                { reflex: true, signal: controller.signal, timeoutMs: 12000 },
            )
            .then(
                result => {
                    lastOutcome = { ...result, elapsedMs: now() - started };
                    record('defense_end', lastOutcome);
                    onOutcome(lastOutcome);
                },
                error => {
                    if (error.name !== 'AbortError' || failureCode(error) === 'timeout')
                        skipped.set(targetId, now() + 30000);
                    lastOutcome = { targets: results, error: String(error.message), elapsedMs: now() - started };
                    record('defense_end', lastOutcome);
                    if (!closed && armed && !runner.status.reflexHeld) onOutcome(lastOutcome);
                },
            )
            .finally(() => {
                pending = null;
                controller = null;
                targetId = null;
                cooldown = now() + 1000;
            });
    }
    const die = () => {
        armed = false;
        controller?.abort();
        attackers.clear();
        skipped.clear();
    };
    const spawn = () => {
        armed = true;
        attackers.clear();
        skipped.clear();
        cooldown = 0;
        runner.resumeReflexes();
    };
    bot.on('death', die);
    bot.on('spawn', spawn);
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    return {
        tick,
        handleHit(source) {
            lastHandled = -Infinity;
            if (
                !ready() ||
                !live(source) ||
                source.name === 'creeper' ||
                source.position.distanceTo(bot.entity.position) > (FLYING.has(source.name) ? 3 : 8)
            )
                return false;
            attackers.set(source.id, now() + 30000);
            // Remember real attackers (including provoked neutral mobs), never players.
            tick();
            const handled = Boolean(pending) && targetId === source.id;
            if (handled) lastHandled = now();
            return handled;
        },
        handlesDamage() {
            return (
                ready() &&
                Boolean(pending) &&
                now() - lastHandled < 1500 &&
                ['mob_attack', 'mob_projectile', 'arrow', 'trident', 'sting'].includes(bot.pi_recentDamage?.type)
            );
        },
        snapshot() {
            return { enabled: true, active: Boolean(pending), held: runner.status.reflexHeld, lastOutcome };
        },
        async close() {
            closed = true;
            clearInterval(timer);
            bot.off('death', die);
            bot.off('spawn', spawn);
            controller?.abort();
            await pending;
        },
    };
}
