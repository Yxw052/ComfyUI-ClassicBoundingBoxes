import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsva, hsvaToHex, normalizeHex, hexToRgb } from '../web/color-utils.js';

test('official picker preserves primary and neutral colors through HSV conversion', () => {
    for (const color of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080']) {
        assert.equal(hsvaToHex(hexToHsva(color)), color);
    }
});

test('hex drafts accept official short and full formats and reject invalid input', () => {
    assert.equal(normalizeHex(' abc '), '#abc');
    assert.equal(normalizeHex('#8C1010'), '#8C1010');
    assert.equal(normalizeHex('not-a-color'), null);
    assert.deepEqual(hexToRgb('#abc'), { r: 170, g: 187, b: 204 });
});
