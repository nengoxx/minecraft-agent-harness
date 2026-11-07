import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
const require = createRequire(import.meta.url);

for (const version of ['1.21.6', '1.20.4']) {
    test(`native physics preserves movement boundaries on ${version}`, async t => {
        const bot = new EventEmitter();
        bot.version = version;
        bot.isAlive = true;
        bot.registry = minecraftData(version);
        bot.supportFeature = feature => bot.registry.supportFeature(feature);
        bot.entity = { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: true };
        bot.blockAt = () => ({});
        bot._client = new EventEmitter();
        bot._client.state = 'play';
        const packets = [];
        bot._client.write = (name, data) => packets.push({ name, data: structuredClone(data) });
        require('mineflayer/lib/plugins/physics.js')(bot, { physicsEnabled: false });
        t.after(() => bot.emit('end'));
        bot.emit('login');
        bot._client.emit('position', {
            x: 0,
            y: 64,
            z: 0,
            yaw: 0,
            pitch: 0,
            flags: version === '1.21.6' ? {} : 0,
            teleportId: 1,
        });
        await delay(1250);
        const positions = packets.filter(p => ['position', 'position_look'].includes(p.name));
        assert.ok(positions.length >= 2, 'teleport response and later heartbeat both sent');
        for (const { data } of positions) assert.ok([data.x, data.y, data.z].every(Number.isFinite));
        if (version === '1.21.6') {
            assert.ok(packets.filter(p => p.name === 'tick_end').length >= 10);
            let moved = false;
            for (const { name } of packets) {
                if (name === 'tick_end') moved = false;
                if (['position', 'position_look'].includes(name)) {
                    assert.equal(moved, false, 'no second position before a tick boundary');
                    moved = true;
                }
            }
        } else {
            assert.equal(
                packets.some(p => p.name === 'tick_end'),
                false,
            );
        }
    });
}
