import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import pf from 'mineflayer-pathfinder';
const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));

// Run the actual pathfinder placement branch and Mineflayer acknowledgement
// handler, with only path search and server replies supplied by the fixture.
function fixture(accepted) {
    const bot = new EventEmitter();
    bot.registry = minecraftData('1.21.4');
    const item = { name: 'dirt', type: bot.registry.itemsByName.dirt.id, count: 12 };
    const cells = new Map();
    const block = (p, name) => ({ name, type: bot.registry.blocksByName[name].id, position: p.clone() });
    const ref = block(new Vec3(0, 63, 0), 'stone');
    const dest = ref.position.offset(1, 0, 0);
    cells.set(ref.position.toString(), ref);
    bot.entity = { position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), onGround: true };
    bot.inventory = { items: () => [item] };
    bot.blockAt = p => cells.get(p.toString()) ?? block(p, 'air');
    bot.world = {
        setBlockStateId() {
            throw new Error('Pathfinder must not fabricate server block state');
        },
    };
    bot.clearControlStates = () => {};
    bot.setControlState = () => {};
    bot.equip = async () => {
        bot.heldItem = item;
    };
    bot._genericPlace = async () => {
        setImmediate(() => {
            const old = bot.blockAt(dest);
            const next = block(dest, accepted ? 'dirt' : 'air');
            if (accepted) item.count--;
            cells.set(dest.toString(), next);
            bot.emit(`blockUpdate:${ref.position}`, ref, ref);
            bot.emit(`blockUpdate:${dest}`, old, next);
        });
    };
    require('mineflayer/lib/plugins/place_block.js')(bot);
    pf.pathfinder(bot);
    bot.pathfinder.LOSWhenPlacingBlocks = false;
    bot.pathfinder.getPathTo = () => ({
        status: 'success',
        path: [
            {
                x: 1,
                y: 64,
                z: 0,
                toBreak: [],
                toPlace: [{ x: 0, y: 63, z: 0, dx: 1, dy: 0, dz: 0 }],
            },
        ],
    });
    bot.pathfinder.setGoal(new pf.goals.GoalBlock(1, 64, 0));
    return { bot, item, dest };
}

for (const accepted of [false, true]) {
    test(`native scaffold placement reports ${accepted ? 'accepted dirt' : 'a refusal, never air success'}`, async () => {
        const { bot, item, dest } = fixture(accepted);
        const placed = [],
            resets = [];
        bot.on('blockPlaced', (_old, block) => placed.push(block));
        bot.on('path_reset', reason => resets.push(reason));
        bot.emit('physicsTick');
        for (let i = 0; i < 5; i++) await flush();
        assert.equal(bot.pathfinder.isBuilding(), false);
        assert.equal(item.count, accepted ? 11 : 12);
        assert.deepEqual(
            placed.map(b => b.name),
            accepted ? ['dirt'] : [],
        );
        assert.equal(bot.blockAt(dest).name, accepted ? 'dirt' : 'air');
        assert.equal(resets.includes('place_error'), !accepted);
    });
}
