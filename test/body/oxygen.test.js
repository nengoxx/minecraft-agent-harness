import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const injectEntities = require('mineflayer/lib/plugins/entities.js');
const injectBreath = require('mineflayer/lib/plugins/breath.js');
const registry = require('minecraft-data')('1.21.6');
const Entity = require('prismarine-entity')('1.21.6');
function fixture() {
    const bot = Object.assign(new EventEmitter(), {
        version: '1.21.6',
        registry,
        supportFeature: name => registry.supportFeature(name),
        _client: new EventEmitter(),
        oxygenLevel: 20,
        health: 20,
    });
    injectEntities(bot);
    injectBreath(bot);
    for (const [id, name] of [
        [1, 'player'],
        [2, 'zombie'],
        [3, 'squid'],
    ]) {
        bot.entities[id] = Object.assign(new Entity(id), { name });
    }
    bot.entity = bot.entities[1];
    const breaths = [],
        updates = [],
        crouches = [];
    bot.on('breath', () => breaths.push(bot.oxygenLevel));
    bot.on('entityUpdate', entity => updates.push(entity.id));
    bot.on('entityCrouch', entity => crouches.push(entity.id));
    const key = (id, name) => registry.entitiesByName[bot.entities[id].name].metadataKeys.indexOf(name);
    const send = (id, air, extra = []) =>
        bot._client.emit('entity_metadata', {
            entityId: id,
            metadata: [...(air == null ? [] : [{ key: key(id, 'air_supply'), type: 'int', value: air }]), ...extra],
        });
    return { bot, breaths, updates, crouches, key, send };
}

test('installed entities plugin already isolates player oxygen from foreign metadata', () => {
    const { bot, breaths, send } = fixture();
    assert.equal(bot.supportFeature('mcDataHasEntityMetadata'), true);
    send(2, 165);
    assert.equal(bot.oxygenLevel, 20);
    send(3, 6000);
    assert.equal(bot.oxygenLevel, 20);
    send(1, 285);
    assert.equal(bot.oxygenLevel, 19);
    assert.deepEqual(breaths, [19]);
});

test('actual plugin preserves foreign metadata but only reports own oxygen, including genuinely low/zero air', () => {
    {
        const { bot, breaths, updates, crouches, key, send } = fixture();
        send(2, 165, [{ key: key(2, 'shared_flags'), type: 'byte', value: 2 }]);
        send(3, 6000);
        assert.equal(bot.oxygenLevel, 20);
        assert.deepEqual(breaths, []);
        assert.equal(bot.entities[2].metadata[key(2, 'air_supply')], 165);
        assert.equal(bot.entities[3].metadata[key(3, 'air_supply')], 6000);
        assert.equal(bot.entities[2].crouching, true);
        assert.deepEqual(crouches, [2]);
        assert.deepEqual(updates, [2, 3]);
        for (const air of [285, 15, 0, 300]) {
            send(1, air);
            assert.equal(bot.oxygenLevel, Math.round(air / 15));
            assert.equal(bot.entity.metadata[key(1, 'air_supply')], air);
        }
        assert.deepEqual(breaths, [19, 1, 0, 20]);
        assert.equal(bot.health, 20);
        send(1, null, [{ key: key(1, 'shared_flags'), type: 'byte', value: 2 }]);
        assert.equal(bot.entity.crouching, true);
        assert.equal(bot.oxygenLevel, 20);
        assert.deepEqual(crouches, [2, 1]);
        assert.deepEqual(breaths, [19, 1, 0, 20]);
    }
});

test('nested own metadata inside foreign dispatch remains authoritative, never restored away', () => {
    const { bot, breaths, send } = fixture();
    let nested = false;
    bot.on('entityUpdate', entity => {
        if (entity.id === 2 && !nested) {
            nested = true;
            send(1, 15);
            send(3, 6000);
        }
    });
    send(2, 165);
    assert.equal(bot.oxygenLevel, 1);
    assert.deepEqual(breaths, [1]);
    send(1, 300);
    assert.equal(bot.oxygenLevel, 20);
    assert.deepEqual(breaths, [1, 20]);
});

test('nested foreign metadata inside own dispatch cannot suppress genuine own breath', () => {
    const { bot, breaths, send } = fixture();
    bot.on('entityUpdate', entity => {
        if (entity.id === 1) send(2, 165);
    });
    send(1, 0);
    assert.equal(bot.oxygenLevel, 0);
    assert.deepEqual(breaths, [0]);
});

test('pre-login foreign metadata cannot initialize oxygen; entity id is resolved anew after replacement', () => {
    const { bot, breaths, send } = fixture();
    bot.entity = undefined;
    bot.oxygenLevel = undefined;
    send(2, 165);
    assert.equal(bot.oxygenLevel, undefined);
    assert.deepEqual(breaths, []);
    bot.entity = bot.entities[2];
    send(2, 30);
    assert.equal(bot.oxygenLevel, 2);
    assert.deepEqual(breaths, [2]);
    send(1, 300);
    assert.equal(bot.oxygenLevel, 2);
    assert.deepEqual(breaths, [2]);
});
