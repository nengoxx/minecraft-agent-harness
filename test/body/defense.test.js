import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { createActionRunner, installSkillCompatibility } from '../../src/tools/game/runtime.js';
import { failureFacts } from '../../src/tools/game/failures.js';
import { installDefense } from '../../src/body/defense.js';
import { installDamageWake } from '../../src/body/damage.js';
import { fightEntity } from '../../src/tools/game/combat.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const latch = () => {
    let resolve;
    const promise = new Promise(r => {
        resolve = r;
    });
    return { promise, resolve };
};
const aborted = signal =>
    new Promise(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
    });
const eventually = async predicate => {
    for (let i = 0; i < 150 && !predicate(); i++) await delay(5);
    assert.ok(predicate());
};
function fixture() {
    const bot = Object.assign(new EventEmitter(), {
        username: 'test',
        health: 20,
        food: 20,
        game: { gameMode: 'survival' },
        entity: { id: 0, position: new Vec3(0, 64, 0), height: 1.62 },
        entities: {},
        inventory: { items: () => [], slots: [] },
        pathfinder: { setMovements() {}, setGoal() {}, stop() {} },
        pvp: { stop() {} },
        clearControlStates() {},
        stopDigging() {},
        deactivateItem() {},
        quit() {},
        lookAt: async () => {},
        attack() {},
    });
    installSkillCompatibility(bot);
    return { bot, runner: createActionRunner(bot, { settleTimeoutMs: 300 }) };
}
const enemy = (bot, id = 1, props = {}) =>
    (bot.entities[id] = { id, name: 'zombie', type: 'hostile', position: new Vec3(2, 64, 0), ...props });

test('reflex waits for cleanup, precedes queued tools, and leaves their entire execution deadline', async () => {
    const { bot, runner } = fixture();
    const cleanup = latch(),
        started = latch(),
        defense = latch(),
        order = [];
    let stopping = false;
    bot.stopDigging = () => (stopping ? cleanup.promise : undefined);
    const work = runner.run('place_line', async ({ signal, reportProgress }) => {
        reportProgress({ placedCount: 2 });
        started.resolve();
        await aborted(signal);
        order.push('old-aborted');
    });
    const checked = assert.rejects(
        work,
        e => e.preemptedBy === 'defense' && failureFacts.get(e).partial.placedCount === 2,
    );
    await started.promise;
    const queued = runner.run(
        'next',
        async ({ deadline }) => {
            order.push('next');
            assert.ok(deadline - Date.now() > 35);
        },
        { timeoutMs: 50 },
    );
    stopping = true;
    const reflex = runner.run(
        'self_defense',
        async () => {
            order.push('defense');
            defense.resolve();
            await delay(75);
        },
        { reflex: true },
    );
    await delay(25);
    assert.deepEqual(order, ['old-aborted']);
    cleanup.resolve();
    await defense.promise;
    runner.interrupt('hit or DM'); // Neither may abort the reflex owner.
    await Promise.all([checked, reflex, queued]);
    assert.deepEqual(order, ['old-aborted', 'defense', 'next']);
});

test('stop cancels active defense and queued work, holds reflexes until new work', async () => {
    const { runner } = fixture();
    const started = latch();
    let wrote = false;
    const reflex = runner.run(
        'self_defense',
        async ({ signal }) => {
            started.resolve();
            await aborted(signal);
        },
        { reflex: true },
    );
    const rejected = assert.rejects(reflex, /Stopped/);
    await started.promise;
    const queued = runner.run('place', async () => {
        wrote = true;
    });
    const queuedRejected = assert.rejects(queued, /cancelled by stop/);
    await runner.stop();
    await Promise.all([rejected, queuedRejected]);
    assert.equal(wrote, false);
    assert.equal(runner.status.reflexHeld, true);
    await assert.rejects(
        runner.run('self_defense', async () => {}, { reflex: true }),
        /deferred/,
    );
    await runner.run('new-task', async () => {});
    assert.equal(runner.status.reflexHeld, false);
});

test('only one reflex can be pending, including before the first action starts', async () => {
    const { runner } = fixture();
    const order = [];
    const normal = runner.run('place', async () => {
        order.push('place');
    });
    const reflex = runner.run(
        'self_defense',
        async () => {
            order.push('defense');
        },
        { reflex: true },
    );
    await assert.rejects(
        runner.run('self_defense', async () => {}, { reflex: true }),
        /deferred/,
    );
    await Promise.all([normal, reflex]);
    assert.deepEqual(order, ['defense', 'place']);
});

test('defense runs during pending inference, coalesces hits and does not trigger damage wakes', async () => {
    const { bot, runner } = fixture();
    const target = enemy(bot),
        model = latch(),
        fighting = latch(),
        release = latch();
    let modelFinished = false,
        fights = 0;
    const events = [];
    const modelResponse = model.promise.then(() => {
        modelFinished = true;
    });
    const defense = installDefense({
        bot,
        runner,
        perception: { isEntityVisible: () => true },
        intervalMs: 100000,
        equip: async () => {},
        fight: async () => {
            fights++;
            fighting.resolve();
            await release.promise;
            delete bot.entities[target.id];
            return { targetDied: true };
        },
        onOutcome: e => events.push(e),
    });
    installDamageWake(
        bot,
        () => ({
            enqueue: () => {
                throw new Error('handled hit woke model');
            },
        }),
        runner,
        () => defense.handlesDamage(),
    );
    try {
        defense.tick();
        await fighting.promise;
        assert.equal(modelFinished, false);
        for (let i = 0; i < 10; i++) assert.equal(defense.handleHit(target), true);
        bot.pi_recentDamage = { type: 'mob_attack', at: Date.now() };
        bot.health = 19;
        bot.emit('health');
        release.resolve();
        await eventually(() => events.length === 1);
        assert.equal(fights, 1);
        assert.equal(modelFinished, false);
        model.resolve();
        await modelResponse;
    } finally {
        release.resolve();
        model.resolve();
        await defense.close();
    }
});

test('target policy avoids passive/neutral/player/creeper and distant flying threats; retries are bounded', async () => {
    const { bot, runner } = fixture();
    let time = 100,
        fights = 0;
    const defense = installDefense({
        bot,
        runner,
        now: () => time,
        perception: { isEntityVisible: () => true },
        intervalMs: 100000,
        equip: async () => {},
        fight: async () => {
            fights++;
            return { stoppedBecause: 'lost_sight', swings: 0 };
        },
    });
    try {
        enemy(bot, 1, { type: 'player', username: 'owner' });
        enemy(bot, 2, { type: 'animal', name: 'cow' });
        enemy(bot, 3, { name: 'enderman' });
        enemy(bot, 4, { name: 'creeper' });
        enemy(bot, 5, { name: 'phantom', position: new Vec3(5, 64, 0) });
        defense.tick();
        await delay(10);
        assert.equal(fights, 0);
        assert.equal(defense.handleHit(bot.entities[1]), false);
        const attacker = bot.entities[3];
        assert.equal(defense.handleHit(attacker), true);
        await eventually(() => fights === 1 && !defense.snapshot().active);
        time += 2000;
        defense.tick();
        await delay(10);
        assert.equal(fights, 1);
        bot.health = 8;
        assert.equal(defense.handleHit(attacker), false);
        await runner.stop();
        bot.health = 20;
        assert.equal(defense.handleHit(attacker), false);
        bot.emit('spawn');
        assert.equal(runner.status.reflexHeld, false);
    } finally {
        await defense.close();
    }
});

test('bounded combat protects terrain for reflexes and does not count despawning as a kill', async () => {
    const { bot } = fixture();
    const target = enemy(bot);
    let movements,
        tools = 0;
    bot.on('pi_tool_result', () => tools++);
    bot.pathfinder.setMovements = m => {
        movements = m;
    };
    const helpers = {
        perception: { isEntityVisible: () => true },
        r2: x => x,
        pathfinderModule: async () => ({ Movements: class {}, goals: { GoalFollow: class {} } }),
        sleepAbortable: async () => {
            delete bot.entities[target.id];
        },
    };
    target.position.x = 5;
    const result = await fightEntity({ id: target.id }, { bot }, helpers, { protectTerrain: true });
    assert.equal(movements.canDig, false);
    assert.equal(movements.allow1by1towers, false);
    assert.equal(result.targetDied, false);
    assert.equal(result.stoppedBecause, 'gone');
    assert.equal(tools, 0);
});

test('reflex low-health floor stops combat without another swing', async () => {
    const { bot } = fixture();
    const target = enemy(bot);
    bot.health = 8;
    bot.attack = () => {
        throw new Error('Must not swing below floor');
    };
    const result = await fightEntity(
        { id: target.id },
        { bot },
        {
            perception: { isEntityVisible: () => true },
            r2: x => x,
            pathfinderModule: async () => ({ Movements: class {}, goals: {} }),
            sleepAbortable: async () => {},
        },
        { minHealth: 8 },
    );
    assert.equal(result.stoppedBecause, 'low_health');
    assert.equal(result.swings, 0);
});

test('nearby mobs share one bounded encounter and one pursuit origin', async () => {
    const { bot, runner } = fixture();
    let time = 100;
    for (let id = 1; id <= 5; id++) enemy(bot, id);
    const starts = [],
        fights = [],
        outcomes = [];
    const defense = installDefense({
        bot,
        runner,
        now: () => time,
        intervalMs: 100000,
        perception: { isEntityVisible: () => true },
        equip: async () => {},
        record: name => starts.push(name),
        onOutcome: result => outcomes.push(result),
        fight: async (args, context, helpers, options) => {
            fights.push({ seconds: args.seconds, origin: options.origin });
            time += args.seconds * 1000;
            delete bot.entities[args.id];
            bot.entity.position.x++;
            return { targetDied: true, swings: 1, stoppedBecause: 'killed' };
        },
    });
    try {
        defense.tick();
        await eventually(() => !defense.snapshot().active);
        assert.deepEqual(starts, ['defense_start', 'defense_end']);
        assert.deepEqual(
            fights.map(f => f.seconds),
            [4, 4, 2],
        );
        assert.ok(fights.every(f => f.origin.x === 0));
        assert.equal(outcomes[0].targets.length, 3);
        assert.equal(Object.keys(bot.entities).length, 2);
    } finally {
        await defense.close();
    }
});

test('preempted crafting reports inventory progress and is never automatically replayed', async () => {
    const { createCore } = await import('../../src/tools/game/core.js');
    const { bot, runner } = fixture();
    const tools = [],
        started = latch();
    let crafted = 0;
    bot.inventory.items = () => (crafted ? [{ name: 'oak_planks', count: 4 }] : []);
    const { add } = createCore({ bot, runner, tools });
    add(
        'craft',
        'synthetic resource-consuming action',
        {},
        async (_args, { signal }) => {
            crafted++;
            started.resolve();
            await aborted(signal);
            throw signal.reason;
        },
        { body: true },
    );
    const task = tools[0].execute('craft', {});
    await started.promise;
    await runner.run('self_defense', async () => {}, { reflex: true });
    const result = await task;
    assert.equal(crafted, 1);
    assert.equal(result.isError, true);
    assert.equal(result.details.facts.interruptedBy, 'defense');
    assert.deepEqual(result.details.facts.inventoryDelta, { oak_planks: 4 });
});

test('stop after preemption invalidates automatic retries even after a later spawn', async () => {
    const { runner } = fixture(),
        started = latch();
    const work = runner.run('place', async ({ signal }) => {
        started.resolve();
        await aborted(signal);
    });
    const outcome = work.catch(error => error);
    await started.promise;
    await runner.run('self_defense', async () => {}, { reflex: true });
    const error = await outcome;
    assert.equal(runner.canResume(error), true);
    await runner.stop();
    runner.resumeReflexes();
    assert.equal(runner.canResume(error), false);
    const cancelled = new AbortController();
    cancelled.abort();
    await runner.stop();
    await assert.rejects(runner.run('cancelled new action', async () => {}, { signal: cancelled.signal }));
    assert.equal(runner.status.reflexHeld, true);
});

test('completed mutation retains success when defense arrives during inventory settlement', async () => {
    const { bot, runner } = fixture();
    bot.inventory = Object.assign(new EventEmitter(), { items: () => [] });
    const mutated = latch();
    const task = runner.run('place', async () => {
        bot.inventory.emit('updateSlot');
        mutated.resolve();
        return { placed: true };
    });
    await mutated.promise;
    await delay(10);
    const defense = runner.run('self_defense', async () => {}, { reflex: true });
    assert.deepEqual(await task, { placed: true });
    await defense;
});

test('failed mutation retains its real error when defense arrives during inventory settlement', async () => {
    const { bot, runner } = fixture();
    bot.inventory = Object.assign(new EventEmitter(), { items: () => [] });
    const mutated = latch(),
        failure = new Error('placement rejected by server');
    const task = runner.run('place', async () => {
        bot.inventory.emit('updateSlot');
        mutated.resolve();
        throw failure;
    });
    const checked = assert.rejects(task, error => error === failure && !runner.canResume(error));
    await mutated.promise;
    await delay(10);
    await runner.run('self_defense', async () => {}, { reflex: true });
    await checked;
});

test('unhandled, backed-off and other attackers are not hidden; surfacing and environment take priority', async () => {
    const { bot, runner } = fixture();
    let time = 100;
    const target = enemy(bot),
        far = enemy(bot, 2, { position: new Vec3(20, 64, 0) });
    const defense = installDefense({
        bot,
        runner,
        now: () => time,
        perception: { isEntityVisible: () => true },
        intervalMs: 100000,
        equip: async () => {},
        fight: async () => ({ stoppedBecause: 'lost_sight', swings: 0 }),
    });
    try {
        assert.equal(defense.handleHit(far), false);
        defense.tick();
        await eventually(() => !defense.snapshot().active);
        time += 2000;
        assert.equal(defense.handleHit(target), false);
        bot.emit('death');
        assert.equal(defense.handleHit(target), false);
        bot.emit('spawn');
        bot.oxygenLevel = 5;
        assert.equal(defense.handleHit(target), false);
        bot.oxygenLevel = 20;
        bot.entity.isInLava = true;
        assert.equal(defense.handleHit(target), false);
        bot.entity.isInLava = false;
        bot.entity.metadata = { 0: 1 };
        assert.equal(defense.handleHit(target), false);
        bot.entity.metadata[0] = 0;
        const start = latch(),
            end = latch();
        const surface = runner.run('return_to_surface', async () => {
            start.resolve();
            await end.promise;
        });
        await start.promise;
        assert.equal(defense.handleHit(target), false);
        await assert.rejects(
            runner.run('self_defense', async () => {}, { reflex: true }),
            /deferred/,
        );
        end.resolve();
        await surface;
    } finally {
        await defense.close();
    }
});

test('environmental and player danger stops native defense; routine other mobs do not', async () => {
    const { combatStopReason } = await import('../../src/body/hurt-cause.js');
    assert.equal(combatStopReason('self_defense', null, 'lava', 1), 'environment_damage');
    assert.match(
        combatStopReason('self_defense', { id: 2, type: 'player', username: 'someone' }, 'player_attack', 1),
        /hit_by_other/,
    );
    assert.equal(combatStopReason('self_defense', { id: 2, type: 'hostile', name: 'zombie' }, 'mob_attack', 1), null);
    assert.match(combatStopReason('attack', { id: 2, type: 'hostile' }, 'mob_attack', 1), /hit_by_other/);
    const { bot } = fixture();
    const target = enemy(bot);
    let checks = 0;
    const result = await fightEntity(
        { id: target.id },
        { bot },
        {
            perception: { isEntityVisible: () => true },
            r2: x => x,
            pathfinderModule: async () => ({ Movements: class {}, goals: {} }),
            sleepAbortable: async () => {},
        },
        {
            shouldStop: () => {
                checks++;
                return true;
            },
        },
    );
    assert.equal(checks, 1);
    assert.equal(result.stoppedBecause, 'self_preservation');
    assert.equal(result.swings, 0);
});
