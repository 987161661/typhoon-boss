import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import sharp from "sharp";

const assets = [
  "public/live/city-broadcast/battle-frame.png",
  "public/live/city-broadcast/official-lab-frame.png"
] as const;

test("both broadcast frame skins keep the shared RGBA canvas and a clear content aperture", async () => {
  for (const asset of assets) {
    const image = sharp(resolve(process.cwd(), asset));
    const metadata = await image.metadata();
    assert.equal(metadata.width, 1_672, `${asset} width`);
    assert.equal(metadata.height, 941, `${asset} height`);
    assert.equal(metadata.channels, 4, `${asset} alpha channel`);

    const { data, info } = await image
      .extract({ left: 360, top: 220, width: 960, height: 515 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let offset = 3; offset < data.length; offset += info.channels) {
      if (data[offset] <= 4) transparent += 1;
    }
    assert.ok(transparent / (info.width * info.height) > 0.98, `${asset} center must remain clear`);
  }
});

test("official laboratory frame has transparent corners and no visible magenta key residue", async () => {
  const { data, info } = await sharp(resolve(process.cwd(), assets[1]))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const corners = [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]];
  for (const [x, y] of corners) assert.equal(data[(y * info.width + x) * info.channels + 3], 0);
  let magenta = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha > 8 && data[offset] > 235 && data[offset + 1] < 35 && data[offset + 2] > 235) magenta += 1;
  }
  assert.equal(magenta, 0);
});
