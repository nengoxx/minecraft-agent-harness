import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import itemLoader from 'prismarine-item';
import blockLoader from 'prismarine-block';

const registry = minecraftData('1.21.6');
const Item = itemLoader(registry);
const Block = blockLoader(registry);

test('component enchantments reach digTime as named levels instead of throwing', () => {
    const axe = new Item(registry.itemsByName.diamond_axe.id, 1);
    axe.componentMap = new Map([
        [
            'enchantments',
            {
                data: { enchantments: [{ id: registry.enchantmentsByName.efficiency.id, level: 5 }] },
            },
        ],
    ]);
    assert.deepEqual(axe.enchants, [{ name: 'efficiency', lvl: 5 }]);
    const log = Block.fromStateId(registry.blocksByName.oak_log.defaultState, 0);
    const enchanted = log.digTime(axe.type, false, false, false, axe.enchants, {});
    const plain = log.digTime(axe.type, false, false, false, [], {});
    assert.ok(Number.isFinite(enchanted) && enchanted < plain);
});

test('already-normalized enchantment arrays remain supported', () => {
    const axe = new Item(registry.itemsByName.diamond_axe.id, 1);
    const data = [{ name: 'efficiency', lvl: 3 }];
    axe.componentMap = new Map([['enchantments', { data }]]);
    assert.deepEqual(axe.enchants, data);
});
