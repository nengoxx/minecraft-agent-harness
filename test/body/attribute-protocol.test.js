import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from 'minecraft-protocol';

test('1.21.6 decodes movement speed separately from mining efficiency and oxygen bonus', () => {
    // Wire IDs/values observed at join: mining efficiency 0, oxygen bonus 0,
    // movement speed 0.1. The old table mislabeled speed as scale and mining as speed.
    const properties = [
        [20, 0],
        [23, 0],
        [22, 0.10000000149011612],
    ];
    const buffer = Buffer.alloc(2 + properties.length * 10);
    buffer[0] = 1; // entity ID
    buffer[1] = properties.length;
    properties.forEach(([id, value], index) => {
        const offset = 2 + index * 10;
        buffer[offset] = id;
        buffer.writeDoubleBE(value, offset + 1);
        buffer[offset + 9] = 0; // no modifiers
    });
    const parser = protocol.createDeserializer({ state: 'play', version: '1.21.6', isServer: false });
    const { data } = parser.proto.parsePacketBuffer('packet_entity_update_attributes', buffer);
    assert.deepEqual(
        data.properties.map(property => [property.key, property.value]),
        [
            ['mining_efficiency', 0],
            ['oxygen_bonus', 0],
            ['generic.movement_speed', 0.10000000149011612],
        ],
    );
});
