from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "ui-rebuild"
FRAME_SIZE = 384
FRAME_COUNT = 48
VERSION = "v2"


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    x = np.clip((value - edge0) / (edge1 - edge0), 0, 1)
    return x * x * (3 - 2 * x)


def value_noise(shape: tuple[int, int], grid: int, rng: np.random.Generator) -> np.ndarray:
    low = rng.random((grid + 1, grid + 1), dtype=np.float32)
    y = np.linspace(0, grid, shape[0], endpoint=False)
    x = np.linspace(0, grid, shape[1], endpoint=False)
    yi = np.floor(y).astype(np.int32)
    xi = np.floor(x).astype(np.int32)
    yf = smoothstep(0, 1, y - yi)[:, None]
    xf = smoothstep(0, 1, x - xi)[None, :]
    a = low[yi[:, None], xi[None, :]]
    b = low[yi[:, None], xi[None, :] + 1]
    c = low[yi[:, None] + 1, xi[None, :]]
    d = low[yi[:, None] + 1, xi[None, :] + 1]
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf


def fbm(shape: tuple[int, int], frame: int, seed_offset: int = 0) -> np.ndarray:
    noise = np.zeros(shape, dtype=np.float32)
    amplitude = 1.0
    total = 0.0
    for octave, grid in enumerate((4, 7, 13, 25, 43)):
        rng = np.random.default_rng(20260708 + seed_offset + octave * 997 + frame * 19)
        noise += value_noise(shape, grid, rng) * amplitude
        total += amplitude
        amplitude *= 0.55
    return noise / total


def render_frame(index: int) -> Image.Image:
    size = FRAME_SIZE
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (x - size * 0.5) / (size * 0.5)
    y = (y - size * 0.5) / (size * 0.5)
    phase = index / FRAME_COUNT
    spin = phase * math.tau

    coarse = fbm((size, size), index, 0)
    cellular = fbm((size, size), (index + 7) % FRAME_COUNT, 4000)
    wisps = fbm((size, size), (index + 17) % FRAME_COUNT, 9000)

    warp_strength = 0.06
    wx = (coarse - 0.5) * warp_strength
    wy = (cellular - 0.5) * warp_strength
    xw = x + wx
    yw = y + wy
    radius = np.sqrt(xw * xw + yw * yw)
    angle = np.arctan2(yw, xw)

    swirl = angle + radius * 7.8 - spin
    band_a = np.power((np.cos(swirl * 2.0 + wisps * 2.6) + 1.0) * 0.5, 5.7)
    band_b = np.power((np.cos(swirl * 4.0 - radius * 3.2 + spin * 0.35) + 1.0) * 0.5, 8.5)
    band_c = np.power((np.cos(swirl * 6.0 + cellular * 3.4) + 1.0) * 0.5, 12.0)

    outer_envelope = (1 - smoothstep(0.8, 1.07, radius)) * smoothstep(0.08, 0.16, radius)
    eyewall = np.exp(-((radius - 0.19) ** 2) / 0.0034)
    dense_comma = np.exp(-((radius - 0.36) ** 2) / 0.038) * band_a
    broken_outer = np.exp(-((radius - 0.62) ** 2) / 0.095) * (band_a * 0.65 + band_b * 0.5 + band_c * 0.2)
    tail = np.exp(-((radius - 0.78) ** 2) / 0.045) * band_b * smoothstep(-0.2, 0.75, np.cos(angle - spin * 0.5))

    convection = np.clip((coarse * 0.72 + cellular * 0.42 + wisps * 0.28) - 0.32, 0, 1)
    cloud_cells = np.power(convection, 1.35)
    density = eyewall * (0.85 + cloud_cells * 0.6)
    density += dense_comma * (0.5 + cloud_cells * 0.76)
    density += broken_outer * (0.34 + cloud_cells * 0.86)
    density += tail * (0.26 + wisps * 0.4)
    density *= outer_envelope

    # Break up the overly perfect spiral so it reads more like rendered cloud volume.
    erosion = smoothstep(0.24, 0.62, cellular) * 0.56 + smoothstep(0.58, 0.86, wisps) * 0.34
    density = np.clip(density * (0.64 + erosion), 0, 1)

    eye_cut = 1 - smoothstep(0.045, 0.13, radius)
    density *= 1 - eye_cut * 0.96

    visible_density = smoothstep(0.045, 0.62, density)
    top_light = np.clip((-(xw * 0.32 + yw * 0.68) + 0.42), 0, 1)
    occlusion = np.clip(1.2 - visible_density * 0.52 - radius * 0.2, 0.58, 1.2)
    highlight = np.clip(visible_density * (118 + top_light * 78) + eyewall * 82, 0, 190)
    shadow = np.clip((1 - top_light) * visible_density * 58 + (1 - coarse) * 14, 0, 82)

    alpha = np.clip(np.power(visible_density, 0.92) * 245, 0, 238).astype(np.uint8)
    red = np.clip((146 + highlight * 0.86 - shadow * 0.22) * occlusion, 0, 255).astype(np.uint8)
    green = np.clip((166 + highlight * 0.94 - shadow * 0.14) * occlusion, 0, 255).astype(np.uint8)
    blue = np.clip((190 + highlight * 1.04 + top_light * 18) * occlusion, 0, 255).astype(np.uint8)

    image = Image.fromarray(np.dstack([red, green, blue, alpha]), "RGBA")
    image = image.filter(ImageFilter.GaussianBlur(radius=0.32))

    # Carve a clean eye after blur so the live hot core can sit inside it.
    radius_clean = np.sqrt(x * x + y * y)
    arr = np.array(image)
    eye = radius_clean < 0.082
    arr[..., 3][eye] = (arr[..., 3][eye] * 0.18).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def make_atlas() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (FRAME_SIZE * FRAME_COUNT, FRAME_SIZE), (0, 0, 0, 0))
    for index in range(FRAME_COUNT):
        atlas.alpha_composite(render_frame(index), (index * FRAME_SIZE, 0))

    atlas_path = OUT_DIR / f"typhoon-flipbook-cloud-{VERSION}.png"
    atlas.save(atlas_path, optimize=True)

    preview = Image.new("RGBA", (FRAME_SIZE * 6, FRAME_SIZE * 2), (8, 12, 16, 255))
    for slot, frame in enumerate(range(0, FRAME_COUNT, 4)[:12]):
        x = slot % 6
        y = slot // 6
        preview.alpha_composite(render_frame(frame), (x * FRAME_SIZE, y * FRAME_SIZE))
    preview.convert("RGB").save(OUT_DIR / f"typhoon-flipbook-cloud-{VERSION}-preview.jpg", quality=92)


if __name__ == "__main__":
    make_atlas()
