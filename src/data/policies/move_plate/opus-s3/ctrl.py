"""Shared control helpers: world<->pelvis transforms, IK wrappers, base hold."""
import numpy as np
import fk

LO = np.array([-3.0892, -1.5882, -2.618, -1.0472, -1.97222, -1.61443, -1.61443])
HI = np.array([2.6704, 2.2515, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])


def pelvis(obs):
    o = obs['low_dim_obs']
    return float(o[18]), float(o[19]), float(o[20]), float(o[21])


def world_to_pelvis(p, obs):
    x, y, z, yaw = pelvis(obs)
    c, s = np.cos(yaw), np.sin(yaw)
    d = np.asarray(p, float) - np.array([x, y, z])
    return np.array([c * d[0] + s * d[1], -s * d[0] + c * d[1], d[2]])


def pelvis_to_world(p, obs):
    x, y, z, yaw = pelvis(obs)
    c, s = np.cos(yaw), np.sin(yaw)
    p = np.asarray(p, float)
    return np.array([x + c * p[0] - s * p[1], y + s * p[0] + c * p[1], z + p[2]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def tilt_rot(ang, yaw=0.0):
    """Tool frame with x pointing forward and `ang` rad downward, y left (world yaw `yaw`)."""
    c, s = np.cos(ang), np.sin(ang)
    R = np.column_stack([[c, 0, -s], [0, 1, 0], [s, 0, c]])
    return rot_z(yaw) @ R


def ik_world(p_world, R_world, obs, q0, side='left', tool=(0, 0, 0), iters=60):
    """IK for a world-frame target given the current pelvis pose."""
    yaw = pelvis(obs)[3]
    p = world_to_pelvis(p_world, obs)
    R = rot_z(-yaw) @ R_world
    return fk.arm_ik(p, q0, side, tool, rot=R, w_rot=0.3, iters=iters, lo=LO, hi=HI)


def hand_world(obs, side='left', tool=(0, 0, 0)):
    o = obs['low_dim_obs']
    q = o[0:7] if side == 'left' else o[9:16]
    p, R = fk.arm_fk(q, side, tool)
    return pelvis_to_world(p, obs), rot_z(pelvis(obs)[3]) @ R


def yaw_hold(obs, yaw_ref=0.0, k=3.0, lim=0.5, wmin=0.1, dead=0.008):
    yaw = pelvis(obs)[3]
    e = (yaw_ref - yaw + np.pi) % (2 * np.pi) - np.pi
    if abs(e) < dead:
        return 0.0
    w = float(np.clip(k * e, -lim, lim))
    if abs(w) < wmin:
        w = wmin * np.sign(w)
    return w
