"""Approximate Unitree G1 kinematics and a small IK for the policy (hand-written, no learning)."""
import numpy as np
from scipy.optimize import least_squares


def rx(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def T(R=np.eye(3), p=(0, 0, 0)):
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = p
    return M


AX = {'x': rx, 'y': ry, 'z': rz}
LO = np.array([-3.0892, -1.5882, -2.618, -1.0472, -1.97222, -1.61443, -1.61443])
HI = np.array([2.6704, 2.2515, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])
TOOL = (0.15, 0.0, 0.0)


def _chain(side):
    s = 1 if side == 'l' else -1
    return [
        ((0.0039563, s * 0.10022, 0.23778), rx(s * 0.27931), 'y'),
        ((0, s * 0.038, -0.013831), rx(-s * 0.27925), 'x'),
        ((0, s * 0.00624, -0.1032), np.eye(3), 'z'),
        ((0.015783, 0, -0.080518), np.eye(3), 'y'),
        ((0.100, s * 0.00188791, -0.010), np.eye(3), 'x'),
        ((0.038, 0, 0), np.eye(3), 'y'),
        ((0.046, 0, 0), np.eye(3), 'z'),
    ]


CHAIN = {'l': _chain('l'), 'r': _chain('r')}


def limits(side):
    if side == 'l':
        return LO, HI
    lo, hi = LO.copy(), HI.copy()
    lo[1], hi[1] = -HI[1], -LO[1]
    lo[2], hi[2] = -HI[2], -LO[2]
    lo[4], hi[4] = -HI[4], -LO[4]
    lo[6], hi[6] = -HI[6], -LO[6]
    return lo, hi


def torso_T(waist):
    M = T(rz(waist[0]))
    M = M @ T(rx(waist[1]), (-0.0039635, 0, 0.035))
    M = M @ T(ry(waist[2]), (0, 0, 0.019))
    return M


def arm_T(side, q, tool=TOOL):
    M = np.eye(4)
    for (p, R, ax), qi in zip(CHAIN[side], q):
        M = M @ T(R, p) @ T(AX[ax](qi))
    return M @ T(np.eye(3), tool)


def pelvis_T(ld):
    x, y, z, yaw = ld[21:25]
    return T(rz(yaw), (x, y, z))


def torso_world(ld):
    return pelvis_T(ld) @ torso_T(ld[0:3])


def arm_q(ld, side):
    return np.array(ld[3:10] if side == 'l' else ld[12:19], dtype=float)


def solve(side, pos, xdir, zdir, q0, tool=TOOL, wori=0.3, wreg=0.05, qnom=None, lock=None):
    """IK in torso frame: tool point at pos, tool x along xdir, tool z near zdir.

    lock: dict joint index -> fixed value.
    """
    lo, hi = limits(side)
    q0 = np.clip(np.asarray(q0, float), lo + 1e-4, hi - 1e-4)
    full = q0.copy()
    free = np.arange(7)
    if lock:
        for i, v in lock.items():
            full[i] = v
        free = np.array([i for i in range(7) if i not in lock])
    qn = full.copy() if qnom is None else np.asarray(qnom, float)
    pos = np.asarray(pos, float)
    xdir = np.asarray(xdir, float)
    zdir = None if zdir is None else np.asarray(zdir, float)

    def expand(v):
        q = full.copy()
        q[free] = v
        return q

    def r(v):
        q = expand(v)
        M = arm_T(side, q, tool)
        e = [M[:3, 3] - pos, wori * (M[:3, 0] - xdir)]
        if zdir is not None:
            e.append(wori * 0.5 * (M[:3, 2] - zdir))
        e.append(wreg * (q - qn)[free])
        return np.concatenate(e)

    s = least_squares(r, full[free], bounds=(lo[free], hi[free]), xtol=1e-6, ftol=1e-6)
    q = expand(s.x)
    M = arm_T(side, q, tool)
    return q, float(np.linalg.norm(M[:3, 3] - pos))


def world_to_torso(ld, p=None, d=None):
    Tw = torso_world(ld)
    R, t = Tw[:3, :3], Tw[:3, 3]
    if p is not None:
        return R.T @ (np.asarray(p) - t)
    return R.T @ np.asarray(d)
