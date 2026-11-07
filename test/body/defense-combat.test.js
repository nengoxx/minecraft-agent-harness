import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { PVP } from 'mineflayer-pvp/lib/PVP.js';
import { createActionRunner, installSkillCompatibility } from '../../src/tools/game/runtime.js';
import { createCore } from '../../src/tools/game/core.js';
import { defendArea } from '../../src/body/defense-combat.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const latch = () => {
    let resolve;
    const promise = new Promise(r => {
        resolve = r;
    });
    return { promise, resolve };
};
class Movements {
    exclusionAreasPlace = [];
}
class GoalFollow {
    constructor(entity) {
        this.entity = entity;
    }
}
class GoalNear {
    constructor(x, y, z) {
        this.position = new Vec3(x, y, z);
    }
}
function fixture() {
    const writes = [],
        goals = [];
    const bot = Object.assign(new EventEmitter(), {
        version: '1.21.4',
        registry: minecraftData('1.21.4'),
        health: 20,
        food: 20,
        game: { gameMode: 'survival' },
        entity: { id: 0, position: new Vec3(0, 64, 0) },
        entities: {},
        inventory: { items: () => [{ name: 'dirt', count: 10 }], slots: Array(46).fill(null) },
        _client: { write: name => writes.push(name) },
        clearControlStates() {},
        stopDigging() {},
        deactivateItem() {},
        supportFeature: () => false,
        getEquipmentDestSlot: slot => (slot === 'hand' ? 36 : 45),
        lookAt: async () => {},
        equip: async () => {},
        blockAt: () => ({ name: 'dirt' }),
    });
    bot.attack = () => bot._client.write('attack');
    bot.pathfinder = {
        goal: null,
        sticky: false,
        setMovements(m) {
            this.movements = m;
        },
        setGoal(goal) {
            this.goal = goal;
            goals.push(goal);
            if (this.sticky) {
                this.sticky = false;
                bot.emit('path_stop');
            }
        },
        stop() {
            this.sticky = true;
        },
    };
    bot.pvp = {
        target: null,
        attackRange: 3.5,
        followRange: 2,
        async attack(e) {
            this.target = e;
            bot.pathfinder.setGoal(new GoalFollow(e));
        },
        forceStop() {
            this.target = null;
            bot.pathfinder.setGoal(null);
        },
    };
    installSkillCompatibility(bot);
    const runner = createActionRunner(bot, { settleTimeoutMs: 300 });
    return { bot, runner, writes, goals };
}
const enemy = (bot, id, name = 'zombie') =>
    (bot.entities[id] = { id, name, type: 'hostile', position: new Vec3(id + 3, 64, 0) });

async function encounter(
    f,
    { step, ready = () => true, pathfinderModule = async () => ({ Movements, goals: { GoalFollow, GoalNear } }) } = {},
) {
    let time = 0;
    const skipped = new Set(),
        engaged = [],
        phases = [],
        origin = f.bot.entity.position.clone();
    const result = await f.runner.run(
        'self_defense',
        ctx =>
            defendArea(ctx, {
                origin,
                ready,
                now: () => time,
                equip: async () => {},
                pathfinderModule,
                choose: preferred =>
                    preferred && f.bot.entities[preferred.id] && !skipped.has(preferred.id)
                        ? preferred
                        : Object.values(f.bot.entities).find(e => !skipped.has(e.id)),
                skip: id => skipped.add(id),
                onEngage: e => engaged.push(e.id),
                onPhase: p => phases.push(p),
                sleep: async () => {
                    time += 150;
                    await step?.(f, time, phases);
                },
            }),
        { reflex: true, timeoutMs: 65000 },
    );
    return { result, engaged, phases };
}
function killCurrent(f) {
    const target = f.bot.pvp.target;
    if (!target) return;
    f.bot.emit('attackedTarget');
    f.bot.emit('entityHurt', target, f.bot.entity);
    f.bot.emit('entityDead', target);
    delete f.bot.entities[target.id];
    f.bot.emit('entityGone', target);
}

test('owned plugin ticks allow combat and scaffold packets, but late callbacks retain the old owner', async () => {
    const f = fixture(),
        started = latch(),
        finish = latch(),
        later = latch();
    let late;
    f.bot.on('physicsTick', () => {
        for (const packet of ['use_entity', 'attack', 'block_place']) f.bot._client.write(packet);
        setTimeout(() => {
            try {
                f.bot._client.write('attack');
            } catch (error) {
                late = error;
            }
            later.resolve();
        }, 30);
    });
    assert.throws(() => f.bot.emit('physicsTick'), { code: 'LATE_MUTATION_REFUSED' });
    const action = f.runner.run('plugin', async ({ ownTicks }) => {
        ownTicks();
        started.resolve();
        await finish.promise;
    });
    await started.promise;
    f.bot.emit('physicsTick');
    finish.resolve();
    await action;
    await f.runner.run('next', async () => {
        await later.promise;
    });
    assert.equal(late?.code, 'LATE_MUTATION_REFUSED');
    assert.deepEqual(f.writes, ['use_entity', 'attack', 'block_place']);
    assert.throws(() => f.bot.emit('physicsTick'), { code: 'LATE_MUTATION_REFUSED' });
});

test('real PvP plugin attacks on owned ticks and cannot swing after stop during lookAt', async () => {
    const f = fixture(),
        target = enemy(f.bot, 1),
        ready = latch(),
        finish = latch();
    target.position = new Vec3(1, 64, 0);
    f.bot.pvp = new PVP(f.bot);
    const action = f.runner.run('plugin', async ({ bot, ownTicks }) => {
        ownTicks();
        await bot.pvp.attack(target);
        ready.resolve();
        await finish.promise;
    });
    await ready.promise;
    f.bot.emit('physicsTick');
    await delay(5);
    assert.deepEqual(f.writes, ['attack']);
    const looked = latch(),
        releaseLook = latch();
    f.bot.lookAt = () => {
        looked.resolve();
        return releaseLook.promise;
    };
    f.bot.pvp.timeToNextAttack = 0;
    f.bot.emit('physicsTick');
    await looked.promise;
    const rejected = assert.rejects(action, /Stopped/);
    const stopping = f.runner.stop();
    releaseLook.resolve();
    finish.resolve();
    await stopping;
    await rejected;
    await delay(5);
    assert.deepEqual(f.writes, ['attack']);
    assert.equal(f.runner.status.blocked, false);
});

test('area defense pursues ground and flying targets, handles a new attacker on return, then returns once', async () => {
    const f = fixture();
    const prior = { unchanged: true };
    f.bot.pvp.movements = prior;
    enemy(f.bot, 1);
    enemy(f.bot, 2, 'phantom');
    let added = false,
        placed = false;
    const { result, engaged, phases } = await encounter(f, {
        step: async (f, _time, phases) => {
            if (f.bot.pvp.target) {
                assert.equal(f.bot.pvp.movements.canDig, false);
                assert.equal(f.bot.pvp.movements.allow1by1towers, true);
                assert.deepEqual(f.bot.pvp.movements.scafoldingBlocks, [f.bot.registry.itemsByName.dirt.id]);
                f.bot.entity.position.x = 5;
                if (!placed) {
                    placed = true;
                    f.bot.emit('blockPlaced', null, { name: 'dirt', position: new Vec3(5, 63, 0) });
                    f.bot.inventory.items = () => [{ name: 'dirt', count: 9 }];
                }
                killCurrent(f);
            } else if (phases.at(-1) === 'return') {
                if (!added) {
                    added = true;
                    enemy(f.bot, 3);
                } else f.bot.entity.position = new Vec3(0.5, 64, 0.5);
            }
        },
    });
    assert.deepEqual(engaged, [1, 2, 3]);
    assert.deepEqual(phases, ['combat', 'return', 'combat', 'return']);
    assert.equal(result.returned, true);
    assert.equal(result.resumeAllowed, true);
    assert.equal(result.confirmedDeaths, 3);
    assert.equal(f.bot.pvp.movements, prior);
    assert.equal(result.inventoryDelta.dirt, -1);
    assert.equal(result.scaffold.placed.length, 1);
    assert.equal(result.scaffold.left.length, 1);
    assert.deepEqual(result.origin, { x: 0, y: 64, z: 0 });
});

test('return failure is reported, and non-dirt inventory cannot create an undiggable tower', async () => {
    const f = fixture();
    enemy(f.bot, 1);
    f.bot.inventory.items = () => [{ name: 'cobblestone', count: 64 }];
    const { result } = await encounter(f, {
        step: async f => {
            if (f.bot.pvp.target) {
                assert.equal(f.bot.pvp.movements.allow1by1towers, false);
                f.bot.entity.position.x = 5;
                killCurrent(f);
            } else f.bot.emit('path_update', { status: 'noPath' });
        },
    });
    assert.equal(result.returned, false);
    assert.equal(result.resumeAllowed, false);
    assert.equal(result.reason, 'return_no_path');
    assert.equal(result.stoppedAt.x, 5);
});

test('unreachable targets and repeated edge stops yield instead of looping forever', async () => {
    const f = fixture();
    enemy(f.bot, 1, 'phantom');
    const { result, engaged } = await encounter(f, {
        step: async f => {
            if (f.bot.pvp.target) f.bot.pathfinder.setGoal(null);
        },
    });
    assert.deepEqual(engaged, [1]);
    assert.equal(result.returned, true);
    assert.equal(result.resumeAllowed, false);
    assert.equal(result.targets[0].stoppedBecause, 'path_stopped');
    assert.equal(result.unresolved, true);
});

test('player/environment danger exits combat without attempting a return', async () => {
    const f = fixture();
    enemy(f.bot, 1);
    const { result, phases } = await encounter(f, {
        step: async f => {
            f.bot.entity.position.x = 4;
            f.bot.pi_attackStop = 'environment_damage';
        },
    });
    assert.equal(result.returned, false);
    assert.equal(result.reason, 'environment_damage');
    assert.deepEqual(phases, ['combat']);
    assert.equal(f.bot.pvp.target, null);
});

test('failed defense return vetoes the already queued placement retry and preserves its checkpoint', async () => {
    const f = fixture(),
        tools = [],
        started = latch();
    let calls = 0;
    const { add } = createCore({ bot: f.bot, runner: f.runner, tools });
    add(
        'place',
        'test',
        {},
        async (_args, { signal, reportProgress }) => {
            calls++;
            reportProgress({ placedCount: 1 });
            started.resolve();
            await new Promise(r => signal.addEventListener('abort', r, { once: true }));
            throw signal.reason;
        },
        { body: true },
    );
    const work = tools[0].execute('place', {});
    await started.promise;
    await f.runner.run(
        'self_defense',
        async () => {
            await delay(10);
            f.runner.vetoResume({ returned: false, stoppedAt: { x: 5, y: 64, z: 0 } });
        },
        { reflex: true },
    );
    const result = await work;
    assert.equal(calls, 1);
    assert.equal(result.isError, true);
    assert.equal(result.details.code, 'not_at_origin');
    assert.equal(result.details.facts.interruptedAttempts[0].partial.placedCount, 1);
    assert.equal(result.details.facts.returned, false);
});

test('real PvP entityGone stop is flushed before return and preserves path_stop listeners', async () => {
    const f = fixture();
    enemy(f.bot, 1);
    f.bot.pvp = new PVP(f.bot);
    const stops = [],
        originalStop = f.bot.pvp.stop.bind(f.bot.pvp);
    f.bot.pvp.stop = (...args) => {
        const p = originalStop(...args);
        stops.push(p);
        return p;
    };
    const listener = () => {};
    f.bot.on('path_stop', listener);
    const { result } = await encounter(f, {
        step: async f => {
            if (f.bot.pvp.target) {
                f.bot.entity.position.x = 5;
                killCurrent(f);
            } else f.bot.entity.position = new Vec3(0, 64, 0);
        },
    });
    await Promise.race([
        Promise.all(stops),
        delay(100).then(() => {
            throw new Error('PvP stop timer leaked into return');
        }),
    ]);
    assert.equal(result.returned, true);
    assert.equal(result.confirmedDeaths, 1);
    assert.ok(f.bot.listeners('path_stop').includes(listener));
    assert.equal(f.runner.status.blocked, false);
});

test('cancelled pursuit reports scaffold progress and does not start the return path', async () => {
    const f = fixture(),
        controller = new AbortController();
    enemy(f.bot, 1);
    const origin = f.bot.entity.position.clone();
    const task = f.runner.run(
        'self_defense',
        ctx =>
            defendArea(ctx, {
                origin,
                choose: () => f.bot.entities[1],
                ready: () => true,
                skip: () => {},
                onEngage: () => {},
                onPhase: () => {},
                equip: async () => {},
                pathfinderModule: async () => ({ Movements, goals: { GoalFollow, GoalNear } }),
                sleep: async () => {
                    for (let i = 0; i < 8; i++) {
                        if (i === 7) controller.abort();
                        f.bot.emit('blockPlaced', null, { name: 'dirt', position: new Vec3(i, 64, 0) });
                    }
                },
            }),
        { reflex: true, signal: controller.signal, timeoutMs: 65000 },
    );
    const { failureFacts } = await import('../../src/tools/game/failures.js');
    await assert.rejects(
        task,
        error => error.name === 'AbortError' && failureFacts.get(error).partial.scaffold.placed.length === 8,
    );
    assert.equal(
        f.goals.some(g => g instanceof GoalNear),
        false,
    );
    assert.equal(f.bot.pvp.target, null);
});

test('real pathfinder return goal excludes another level at a fractional origin', async () => {
    const f = fixture();
    f.bot.entity.position = new Vec3(-2360.34, 111, -224.44);
    const origin = f.bot.entity.position.clone();
    enemy(f.bot, 1);
    await encounter(f, {
        pathfinderModule: () => import('mineflayer-pathfinder'),
        step: async f => {
            if (f.bot.pvp.target) {
                f.bot.entity.position.x += 4;
                killCurrent(f);
            } else f.bot.entity.position = origin.clone();
        },
    });
    const home = f.goals.find(g => g?.constructor.name === 'GoalNear');
    assert.ok(home);
    assert.equal(home.isEnd(origin.floored()), true);
    assert.equal(home.isEnd(origin.floored().offset(0, 1, 0)), false);
    assert.equal(home.isEnd(origin.floored().offset(0, -1, 0)), false);
});

test('return interrupted by an edge guard retries only a bounded number of times', async () => {
    const f = fixture();
    enemy(f.bot, 1);
    let resets = 0;
    const { result } = await encounter(f, {
        step: async f => {
            if (f.bot.pvp.target) {
                f.bot.entity.position.x = 5;
                killCurrent(f);
            } else {
                resets++;
                f.bot.pathfinder.setGoal(null);
            }
        },
    });
    assert.equal(result.returned, false);
    assert.equal(result.reason, 'return_no_path');
    assert.equal(resets, 4);
});
