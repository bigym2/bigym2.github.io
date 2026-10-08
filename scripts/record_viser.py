#!/usr/bin/env python3
"""Record one rollout as a .viser file for the page's 3D replay.

The scene is built exactly the way `bigym-demo-grid` builds it (same meshes,
lighting and dark floor as the page's videos), posed frame by frame from the
rollout's stored `full_qpos`, and serialised with viser's scene serializer.
The page plays the file back in viser's static client: free camera, no
simulation, no server.

Run it with the bigym environment, from anywhere:

    cd code/bigym && uv run --no-sync --with fast-simplification \\
        python ../BiGym2-page/scripts/record_viser.py REPLAY.npz TASK OUT.viser

    REPLAY.npz  an episode written by the evaluator or `bigym-agent replay`
                (needs `full_qpos` and `seed`)
    TASK        the BiGym task name, e.g. drawer_top_open
    OUT.viser   written under public/viser/ by convention
    --every N   keep one control step in N (0.02 s each); 2 → 25 fps
    --detail F  keep this fraction of triangles on high-poly meshes (0.15)
    --azimuth D swing the default camera D degrees around the robot (30)
    --distance F  scale the default camera distance (0.8)
                (together the oblique view the page's videos use)

Three things keep the file small without changing what is seen: the
robot's collision meshes (group 0, full-resolution duplicates of its visual
meshes) are left out, untextured meshes above 3,000 triangles are decimated,
and textures are capped at 512 px and stored as JPEG (the counter's wood
grain alone is a 1756 px PNG, 4.4 MB per counter, otherwise).
Decimation needs fast-simplification, which the command above layers in
for the run without touching the bigym environment.

Prints the camera pose to pass to the player (see CONTENT.md).
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
from pathlib import Path

import numpy as np


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("replay", type=Path)
    p.add_argument("task")
    p.add_argument("out", type=Path)
    p.add_argument("--every", type=int, default=2)
    p.add_argument("--detail", type=float, default=0.15)
    p.add_argument("--azimuth", type=float, default=30.0)
    p.add_argument("--distance", type=float, default=0.8)
    a = p.parse_args()

    import trimesh
    import mjviser.conversions as conversions
    import vr.viewer.demo_grid as grid
    from vr.viewer.demo_grid import GridDemo, build_grid, close_grid, pose_grid, scene_pose

    # 1. Drop the robot's collision copy: mjviser skips fully transparent geoms.
    build_task_env = grid.build_task_env

    def build_without_collision_copy(task):
        env = build_task_env(task)
        m = grid.inner_env(env)._mojo.model
        for g in range(m.ngeom):
            robot = m.body(m.geom_bodyid[g]).name.startswith("g1_")
            colliding = m.geom_contype[g] != 0 or m.geom_conaffinity[g] != 0
            if robot and colliding and int(m.geom_group[g]) == 0:
                m.geom_rgba[g][3] = 0.0
        return env

    grid.build_task_env = build_without_collision_copy

    # 2. Decimate untextured high-poly meshes (textured ones keep their UVs).
    to_trimesh = conversions.mujoco_mesh_to_trimesh

    def decimated(mj_model, geom_idx):
        mesh = to_trimesh(mj_model, geom_idx)
        textured = isinstance(mesh.visual, trimesh.visual.TextureVisuals)
        if not textured and len(mesh.faces) > 3000 and a.detail < 1:
            target = max(1500, int(len(mesh.faces) * a.detail))
            colour = mesh.visual.face_colors[0] if len(mesh.visual.face_colors) else None
            mesh = mesh.simplify_quadric_decimation(face_count=target)
            if colour is not None:
                mesh.visual.face_colors = colour
        return mesh

    conversions.mujoco_mesh_to_trimesh = decimated

    # 3. Textures: at most 512 px, JPEG (trimesh's glTF export keeps JPEGs).
    import io
    from PIL import Image
    import viser._scene_api as scene_api

    def jpeg(image):
        if image is None:
            return None
        image = image.convert("RGB")
        if max(image.size) > 512:
            image.thumbnail((512, 512), Image.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=82)
        buf.seek(0)
        return Image.open(buf)

    def shrink_textures(mesh):
        material = getattr(mesh.visual, "material", None)
        if material is None:
            return mesh
        if getattr(material, "baseColorTexture", None) is not None:
            material.baseColorTexture = jpeg(material.baseColorTexture)
        if getattr(material, "image", None) is not None:
            material.image = jpeg(material.image)
        return mesh

    for method in ("add_mesh_trimesh", "add_batched_meshes_trimesh"):
        original = getattr(scene_api.SceneApi, method)

        def wrapped(self, name, mesh, *args, _original=original, **kwargs):
            return _original(self, name, shrink_textures(mesh), *args, **kwargs)

        setattr(scene_api.SceneApi, method, wrapped)

    ep = np.load(a.replay)
    qpos = np.asarray(ep["full_qpos"], dtype=np.float64)[:: a.every]
    seed = int(np.asarray(ep["seed"]).reshape(-1)[0])
    dt = 0.02 * a.every
    demo = GridDemo(a.task, qpos, seed, source_file=str(a.replay), control_seconds=dt)

    built = build_grid([demo], columns=1, labels=False, tint=False, sky="black", port=free_port())
    server = built["server"]
    position, look_at = scene_pose(built, 0)
    # Swing the camera about the vertical through the look-at point.
    theta = -np.radians(a.azimuth)
    dx, dy = position[0] - look_at[0], position[1] - look_at[1]
    dz = position[2] - look_at[2]
    k = a.distance
    position = (look_at[0] + k * (dx * np.cos(theta) + dy * np.sin(theta)),
                look_at[1] + k * (-dx * np.sin(theta) + dy * np.cos(theta)),
                look_at[2] + k * dz)

    serializer = server.get_scene_serializer()
    for frame in range(qpos.shape[0]):
        pose_grid(built, frame)
        serializer.insert_sleep(dt)
    data = serializer.serialize()
    close_grid(built)

    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_bytes(data)
    camera = {"position": [round(float(v), 3) for v in position], "look_at": [round(float(v), 3) for v in look_at]}
    print(json.dumps({"out": str(a.out), "frames": int(qpos.shape[0]), "seconds": round(qpos.shape[0] * dt, 2),
                      "bytes": len(data), "camera": camera}), file=sys.stdout)


if __name__ == "__main__":
    main()
