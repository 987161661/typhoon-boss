from __future__ import annotations

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "ui-rebuild"
FRAME_DIR = ROOT / "tmp" / "typhoon-blender-frames"
FRAME_SIZE = 384
FRAME_COUNT = 48


def make_material(name: str, color: tuple[float, float, float, float], emission: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    mat.use_screen_refraction = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Alpha"].default_value = color[3]
    bsdf.inputs["Emission Color"].default_value = color
    bsdf.inputs["Emission Strength"].default_value = emission
    bsdf.inputs["Roughness"].default_value = 0.72
    return mat


def setup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 96
    scene.render.resolution_x = FRAME_SIZE
    scene.render.resolution_y = FRAME_SIZE
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    camera_data = bpy.data.cameras.new("camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 4.5
    camera = bpy.data.objects.new("camera", camera_data)
    camera.location = (0, 0, 7)
    camera.rotation_euler = (0, 0, 0)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    light_data = bpy.data.lights.new("softbox", "AREA")
    light_data.energy = 420
    light_data.size = 5.5
    light = bpy.data.objects.new("softbox", light_data)
    light.location = (-2.2, -3.0, 6.0)
    bpy.context.collection.objects.link(light)


def add_spiral_curve(name: str, radius: float, phase: float, turns: float, material: bpy.types.Material, width: float, z: float) -> None:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 3
    curve.bevel_depth = width
    curve.bevel_resolution = 6
    curve.materials.append(material)

    points_per_band = 72
    for arm in range(3):
        spline = curve.splines.new("POLY")
        spline.points.add(points_per_band - 1)
        arm_phase = phase + arm * math.tau / 3.0
        for index, point in enumerate(spline.points):
            t = index / (points_per_band - 1)
            r = radius * (0.2 + t * 0.86)
            angle = arm_phase + turns * math.tau * t + math.sin(t * 12.0 + phase) * 0.18
            flutter = math.sin(t * 29.0 + phase * 2.0 + arm) * 0.045
            x = math.cos(angle) * (r + flutter)
            y = math.sin(angle) * (r + flutter)
            point.co = (x, y, z + math.sin(t * 7.0 + arm) * 0.025, 1)

    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)


def add_cloud_cells(frame: int, phase: float, material: bpy.types.Material) -> None:
    rng = random.Random(9000 + frame)
    for index in range(90):
        arm = rng.randrange(3)
        t = rng.random()
        r = 0.34 + t * 1.55 + rng.uniform(-0.08, 0.08)
        angle = phase + arm * math.tau / 3.0 + t * math.tau * 1.65 + rng.uniform(-0.32, 0.32)
        scale = rng.uniform(0.035, 0.12) * (1.25 - t * 0.38)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=scale, location=(math.cos(angle) * r, math.sin(angle) * r, rng.uniform(-0.03, 0.06)))
        cell = bpy.context.object
        cell.name = f"cloud_cell_{index:03d}"
        cell.scale.y *= rng.uniform(0.5, 1.4)
        cell.scale.x *= rng.uniform(0.8, 1.8)
        cell.rotation_euler.z = angle + rng.uniform(-0.8, 0.8)
        cell.data.materials.append(material)


def add_eye(material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_torus_add(major_radius=0.34, minor_radius=0.045, major_segments=96, minor_segments=12, location=(0, 0, 0.08))
    eye = bpy.context.object
    eye.name = "eye_wall"
    eye.data.materials.append(material)


def render_frame(frame: int, materials: dict[str, bpy.types.Material]) -> None:
    setup_scene()
    phase = frame / FRAME_COUNT * math.tau

    add_spiral_curve("dense_eyewall_band", 1.14, phase * -1.05, 0.95, materials["bright"], 0.035, 0.06)
    add_spiral_curve("outer_cloud_band", 1.88, phase * -0.82 + 0.4, 1.18, materials["cloud"], 0.055, 0.0)
    add_spiral_curve("high_wisp_band", 2.0, phase * -1.24 + 1.1, 1.55, materials["wisp"], 0.02, 0.12)
    add_cloud_cells(frame, phase * -0.7, materials["cell"])
    add_eye(materials["bright"])

    bpy.context.scene.render.filepath = str(FRAME_DIR / f"frame_{frame:03d}.png")
    bpy.ops.render.render(write_still=True)


def pack_atlas() -> None:
    atlas = bpy.data.images.new("typhoon_flipbook_cloud_v2_blender", width=FRAME_SIZE * FRAME_COUNT, height=FRAME_SIZE, alpha=True)
    atlas_pixels = [0.0] * (FRAME_SIZE * FRAME_COUNT * FRAME_SIZE * 4)
    for frame in range(FRAME_COUNT):
        image = bpy.data.images.load(str(FRAME_DIR / f"frame_{frame:03d}.png"))
        pixels = list(image.pixels)
        for y in range(FRAME_SIZE):
            src_start = y * FRAME_SIZE * 4
            src_end = src_start + FRAME_SIZE * 4
            dst_start = (y * FRAME_SIZE * FRAME_COUNT + frame * FRAME_SIZE) * 4
            atlas_pixels[dst_start : dst_start + FRAME_SIZE * 4] = pixels[src_start:src_end]
        bpy.data.images.remove(image)

    atlas.pixels[:] = atlas_pixels
    atlas.filepath_raw = str(OUT_DIR / "typhoon-flipbook-cloud-v2.png")
    atlas.file_format = "PNG"
    atlas.save()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    setup_scene()
    materials = {
        "cloud": make_material("cloud_volume", (0.72, 0.82, 0.9, 0.52), 0.08),
        "bright": make_material("convective_highlight", (0.96, 0.98, 1.0, 0.74), 0.18),
        "wisp": make_material("upper_wisp", (0.56, 0.76, 0.95, 0.24), 0.12),
        "cell": make_material("broken_cell", (0.7, 0.82, 0.92, 0.36), 0.05),
    }
    for frame in range(FRAME_COUNT):
        render_frame(frame, materials)
    pack_atlas()


if __name__ == "__main__":
    main()
