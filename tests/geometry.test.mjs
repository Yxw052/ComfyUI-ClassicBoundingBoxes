import test from "node:test";
import assert from "node:assert/strict";
import { applyDrag, boxesAt, fromBoundingBoxes, toBoundingBoxes } from "../web/geometry.js";

const region = { x: .2, y: .3, w: .4, h: .2, type: "text", text: "你好", desc: "a sign", palette: ["#ff0000"] };

test("pixel round trip retains text, palette and official metadata", () => {
    assert.deepEqual(fromBoundingBoxes(toBoundingBoxes([region], 1024, 512), 1024, 512), [{
        ...region, x: 205 / 1024, y: 154 / 512, w: 410 / 1024, h: 102 / 512,
    }]);
});

test("dragging any corner changes both width and height", () => {
    for (const mode of ["resize-tl", "resize-tr", "resize-bl", "resize-br"]) {
        const result = applyDrag(mode, region, .05, .04);
        assert.notEqual(result.w, region.w, mode);
        assert.notEqual(result.h, region.h, mode);
        assert.equal(result.text, region.text);
    }
});

test("reverse drawing and moving outside the canvas stay bounded", () => {
    const result = applyDrag("draw", { ...region, w: 0, h: 0 }, -.1, -.2);
    assert.ok(Math.abs(result.x - .1) < 1e-9);
    assert.ok(Math.abs(result.y - .1) < 1e-9);
    const moved = applyDrag("move", region, 5, -5);
    assert.equal(moved.x, .6);
    assert.equal(moved.y, 0);
});

test("hit-testing follows screen-space handle size and selects overlapping regions", () => {
    assert.equal(boxesAt([region], .2, .3, 7, 400, 200, 0)[0].mode, "resize-tl");
    assert.equal(boxesAt([region], .4, .3, 7, 400, 200, 0)[0].mode, "resize-t");
    assert.equal(boxesAt([region, region], .4, .4, 7, 400, 200, 1)[0].index, 1);
});
