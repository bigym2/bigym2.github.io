"""Approximate G1 arm kinematics (pelvis frame: x forward, y left, z up)."""
import numpy as np
from scipy.optimize import least_squares


def _rx(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def _ry(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _rz(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _rpy(r, p, y):
    return _rz(y) @ _ry(p) @ _rx(r)


LO = np.array([-3.0892, -1.5882, -2.618, -1.0472, -1.97222, -1.61443, -1.61443])
HI = np.array([2.6704, 2.2515, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])
TORSO = np.array([-0.0039635, 0.0, 0.054])
HAND = 0.12  # wrist-yaw joint to grasp centre (guess)


def fk(q, side="left", hand=HAND):
    """Return (position, rotation) of the grasp point in the pelvis frame."""
    s = 1.0 if side == "left" else -1.0
    lo, hi = (LO, HI) if side == "left" else (np.array([LO[0], -HI[1], LO[2], LO[3], LO[4], LO[5], LO[6]]), None)
    p = TORSO.copy()
    R = np.eye(3)

    def step(t, Rj):
        nonlocal p, R
        p = p + R @ np.asarray(t)
        R = R @ Rj

    step([0.0039563, s * 0.10022, 0.23778], _rpy(s * 0.27931, 5.4949e-05, -s * 0.00019159) @ _ry(q[0]))
    step([0, s * 0.038, -0.013831], _rx(-s * 0.27925) @ _rx(q[1]))
    step([0, s * 0.00624, -0.1032], _rz(q[2]))
    step([0.015783, 0, -0.080518], _ry(q[3]))
    step([0.100, s * 0.00188791, -0.010], _rx(q[4]))
    step([0.038, 0, 0], _ry(q[5]))
    step([0.046, 0, 0], _rz(q[6]))
    return p + R @ np.array([hand, 0, 0]), R


def limits(side):
    # shoulder roll limited so the upper arm does not hit the torso
    if side == "left":
        lo = LO.copy()
        lo[1] = 0.02
        return lo, HI
    # right arm: roll/yaw limits mirrored
    lo = np.array([-3.0892, -2.2515, -2.618, -1.0472, -1.97222, -1.61443, -1.61443])
    hi = np.array([2.6704, -0.02, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])
    return lo, hi


def ik(target_p, target_R=None, side="left", q0=None, hand=HAND, w_rot=0.3, reg=0.01, q_ref=None):
    lo, hi = limits(side)
    q0 = np.zeros(7) if q0 is None else np.asarray(q0, float)
    q_ref = q0 if q_ref is None else q_ref

    def res(q):
        p, R = fk(q, side, hand)
        r = [p - target_p]
        if target_R is not None:
            r.append(w_rot * (R - target_R).ravel())
        r.append(reg * (q - q_ref))
        return np.concatenate(r)

    sol = least_squares(res, np.clip(q0, lo + 1e-3, hi - 1e-3), bounds=(lo, hi))
    return sol.x, sol
