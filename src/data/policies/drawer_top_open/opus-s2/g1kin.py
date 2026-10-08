"""Approximate G1 arm forward kinematics (from the public g1_29dof URDF), pelvis frame."""
import numpy as np


def rotx(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def roty(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rotz(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def rpy(r, p, y):
    return rotz(y) @ roty(p) @ rotx(r)


TORSO = np.array([-0.0039635, 0.0, 0.054])


def arm_chain(side):
    s = 1.0 if side == 'L' else -1.0
    return [
        # (xyz, rpy, axis)
        (np.array([0.0039563, s * 0.10022, 0.23778]), (s * 0.27931, 0, 0), 'y'),
        (np.array([0.0, s * 0.038, -0.013831]), (-s * 0.27925, 0, 0), 'x'),
        (np.array([0.0, s * 0.00624, -0.1032]), (0, 0, 0), 'z'),
        (np.array([0.015783, 0.0, -0.080518]), (0, 0, 0), 'y'),
        (np.array([0.100, s * 0.00188791, -0.010]), (0, 0, 0), 'x'),
        (np.array([0.038, 0.0, 0.0]), (0, 0, 0), 'y'),
        (np.array([0.046, 0.0, 0.0]), (0, 0, 0), 'z'),
    ]


AX = {'x': rotx, 'y': roty, 'z': rotz}


def fk(q, side='L', tool=np.array([0.12, 0.0, 0.0])):
    """Return (tool position, rotation) in pelvis frame, and the joint frames."""
    R = np.eye(3)
    p = TORSO.copy()
    frames = []
    for (xyz, r, ax), qi in zip(arm_chain(side), q):
        p = p + R @ xyz
        R = R @ rpy(*r) @ AX[ax](qi)
        frames.append((p.copy(), R.copy()))
    return p + R @ tool, R, frames


LO = np.array([-3.0892, -1.5882, -2.618, -1.0472, -1.97222, -1.61443, -1.61443])
HI = np.array([2.6704, 2.2515, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])


def limits(side):
    return LO, HI


def rot_err(R, Rd):
    E = Rd @ R.T
    w = np.array([E[2, 1] - E[1, 2], E[0, 2] - E[2, 0], E[1, 0] - E[0, 1]]) / 2
    return w


def ik(p_des, R_des, q0, side='L', tool=np.array([0.12, 0.0, 0.0]), w_rot=0.3, iters=300,
       q_rest=None, w_rest=1e-4):
    q = np.array(q0, dtype=float)
    lo, hi = limits(side)
    if q_rest is None:
        q_rest = np.zeros(7)
    for _ in range(iters):
        p, R, _ = fk(q, side, tool)
        e = np.concatenate([p_des - p, w_rot * rot_err(R, R_des)])
        if np.linalg.norm(e) < 1e-5:
            break
        J = np.zeros((6, 7))
        h = 1e-5
        for j in range(7):
            dq = q.copy(); dq[j] += h
            p2, R2, _ = fk(dq, side, tool)
            J[:3, j] = (p2 - p) / h
            J[3:, j] = w_rot * rot_err(R, R2) / h
        lam = 1e-3
        A = J.T @ J + lam * np.eye(7) + w_rest * np.eye(7)
        dq = np.linalg.solve(A, J.T @ e + w_rest * (q_rest - q))
        q = np.clip(q + dq, lo + 0.02, hi - 0.02)
    p, R, _ = fk(q, side, tool)
    return q, np.linalg.norm(p_des - p), np.linalg.norm(rot_err(R, R_des))
