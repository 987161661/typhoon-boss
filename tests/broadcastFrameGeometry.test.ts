import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAspectLockedFrameBox
} from "../lib/broadcastFrameGeometry";

const battleFrame = {
  sourceWidth: 1_672,
  sourceHeight: 941
};

test("battle frame keeps its exact source aspect ratio at 720p", () => {
  const aspectLock = { ...battleFrame, renderedWidth: 800 };
  const box = resolveAspectLockedFrameBox(aspectLock);

  assert.equal(box.scale, 800 / 1_672);
  assert.deepEqual({ width: box.width, height: box.height }, { width: 800, height: 450.239 });
  assert.ok(Math.abs(box.width / box.height - 1_672 / 941) < 0.000_01);
});

test("battle frame follows tower width without changing the full-frame ratio", () => {
  for (const renderedWidth of [800, 920, 1_100]) {
    const box = resolveAspectLockedFrameBox({ ...battleFrame, renderedWidth });
    assert.ok(Math.abs(box.width / box.height - 1_672 / 941) < 0.000_01);
  }
});
