import { REFLEX_PROTECTED_TOOLS } from '../tools/game/runtime.js';
import { failureFacts } from '../tools/game/failures.js';
import { defendArea } from './defense-combat.js';

const NEUTRAL = new Set(['enderman', 'piglin', 'zombified_piglin', 'spider', 'cave_spider']);
const mob = entity =>
    entity && !entity.username && entity.type !== 'player' && ['mob', 'hostile', 'animal'].includes(entity.type);

export function installDefense({
    bot,
    runner,
    perception,
    record = () => {},
    onOutcome = () => {},
    encounter = defendArea,
    now = Date.now,
    intervalMs = 300,
}) {
    const attackers = new Map(),
        skipped = new Map();
    let closed = false,
        armed = true,
        pending = null,
        controller = null,
        cooldown = 0,
        lastHandled = -Infinity,
        lastOutcome = null,
        origin = null,
        phase = null,
        engageUntil = 0,
        workRevision = runner.status.workRevision;
    let lastGrounded = null;
    const rememberGround = () => {
        if (!pending && bot.entity?.onGround) lastGrounded = bot.entity.position.offset(0, 0, 0);
    };
    bot.on('physicsTick', rememberGround);
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
        (skipped.get(e.id)?.until ?? 0) <= now() &&
        e.position.distanceTo(bot.entity.position) <= (attackers.has(e.id) ? 16 : e.name === 'phantom' ? 12 : 8) &&
        (attackers.has(e.id) || perception.isEntityVisible(bot, e, 16));
    const choose = preferred => {
        if (preferred && eligible(preferred)) return preferred;
        return Object.values(bot.entities ?? {})
            .filter(eligible)
            .sort(
                (a, b) =>
                    Number(attackers.has(b.id)) - Number(attackers.has(a.id)) ||
                    a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position),
            )[0];
    };
    function tick() {
        rememberGround();
        if (pending) return;
        if (runner.status.workRevision !== workRevision) {
            origin = null;
            workRevision = runner.status.workRevision;
        }
        if (!ready() || now() < cooldown || REFLEX_PROTECTED_TOOLS.has(runner.status.active)) return;
        for (const [id, until] of attackers) if (until <= now()) attackers.delete(id);
        for (const [id, entry] of skipped) if (entry.until <= now()) skipped.delete(id);
        const target = choose(null);
        if (!target) return;
        origin ??= bot.entity.onGround === false && lastGrounded ? lastGrounded : bot.entity.position.offset(0, 0, 0);
        controller = new AbortController();
        engageUntil = Infinity;
        phase = 'combat';
        const started = now();
        record('defense_start', { id: target.id, target: target.name, interrupted: runner.status.active, origin });
        pending = runner
            .run(
                'self_defense',
                async context => {
                    let progress;
                    try {
                        engageUntil = now() + 45000;
                        const result = await encounter(
                            {
                                ...context,
                                reportProgress: value => {
                                    progress = value;
                                    context.reportProgress(value);
                                },
                            },
                            {
                                origin,
                                choose,
                                ready,
                                now,
                                fightUntil: engageUntil,
                                skip: (id, why) => skipped.set(id, { until: now() + 30000, why }),
                                onEngage: entity => attackers.set(entity.id, now() + 60000),
                                onPhase: value => {
                                    phase = value;
                                },
                            },
                        );
                        if (!result.resumeAllowed) runner.vetoResume(result);
                        if (result.returned) origin = null;
                        return result;
                    } catch (error) {
                        runner.vetoResume({
                            ...progress,
                            returned: false,
                            reason: armed ? String(error.message) : 'death',
                            origin,
                        });
                        throw error;
                    }
                },
                { reflex: true, signal: controller.signal, timeoutMs: 65000 },
            )
            .then(
                result => {
                    lastOutcome = { ...result, elapsedMs: now() - started };
                    record('defense_end', lastOutcome);
                    onOutcome(lastOutcome);
                },
                error => {
                    lastOutcome = {
                        ...failureFacts.get(error)?.partial,
                        returned: false,
                        error: String(error.message),
                        elapsedMs: now() - started,
                    };
                    record('defense_end', lastOutcome);
                    if (!closed && armed && !runner.status.reflexHeld) onOutcome(lastOutcome);
                },
            )
            .finally(() => {
                pending = null;
                controller = null;
                phase = null;
                cooldown = now() + 1000;
            });
    }
    const die = () => {
        armed = false;
        controller?.abort();
        attackers.clear();
        skipped.clear();
        origin = null;
        lastGrounded = null;
        runner.vetoResume({ returned: false, reason: 'death' });
    };
    const spawn = () => {
        armed = true;
        attackers.clear();
        skipped.clear();
        origin = null;
        lastGrounded = null;
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
            if (!ready() || !live(source) || source.position.distanceTo(bot.entity.position) > 16) return false;
            attackers.set(source.id, now() + 60000);
            const blocked = skipped.get(source.id);
            if (
                !['leash', 'no_path', 'path_stopped', 'no_progress'].includes(blocked?.why) ||
                source.position.distanceTo(bot.entity.position) <= (bot.pvp.attackRange ?? 3.5) + 1
            )
                skipped.delete(source.id);
            tick();
            const handled =
                Boolean(pending) &&
                now() < engageUntil &&
                eligible(source) &&
                Boolean(origin) &&
                bot.entity.position.distanceTo(origin) <= 16;
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
            return {
                enabled: true,
                active: Boolean(pending),
                phase,
                origin,
                held: runner.status.reflexHeld,
                lastOutcome,
            };
        },
        async close() {
            closed = true;
            clearInterval(timer);
            bot.off('death', die);
            bot.off('spawn', spawn);
            bot.off('physicsTick', rememberGround);
            controller?.abort();
            await pending;
        },
    };
}
