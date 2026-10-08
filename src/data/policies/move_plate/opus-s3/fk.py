"""Hand-written forward kinematics of the Unitree G1 arms (pelvis frame).

Link offsets follow the published G1 URDF; waist joints are assumed locked at 0.
"""
import numpy as np


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


TORSO = np.array([-0.0039635, 0.0, 0.054])
# (origin xyz, origin rpy, axis) per joint, for the left arm; right arm mirrors y.
_LEFT = [
    ((0.0039563, 0.10022, 0.23778), (0.27931, 5.4949e-05, -0.00019159), 'y'),
    ((0.0, 0.038, -0.013831), (-0.27925, 0.0, 0.0), 'x'),
    ((0.0, 0.00624, -0.1032), (0, 0, 0), 'z'),
    ((0.015783, 0.0, -0.080518), (0, 0, 0), 'y'),
    ((0.100, 0.00188791, -0.010), (0, 0, 0), 'x'),
    ((0.038, 0.0, 0.0), (0, 0, 0), 'y'),
    ((0.046, 0.0, 0.0), (0, 0, 0), 'z'),
]
_AX = {'x': _rx, 'y': _ry, 'z': _rz}


def arm_fk(q, side='left', tool=(0.0, 0.0, 0.0)):
    """Return (position, rotation) of a point on the wrist-yaw link, pelvis frame.

    Args:
        q: 7 joint angles.
        side: 'left' or 'right'.
        tool: Offset of the point in the wrist-yaw link frame.
    """
    sgn = 1.0 if side == 'left' else -1.0
    p = TORSO.copy()
    R = np.eye(3)
    for (xyz, rpy, ax), a in zip(_LEFT, q):
        xyz = np.array([xyz[0], sgn * xyz[1], xyz[2]])
        rpy = (sgn * rpy[0], rpy[1], sgn * rpy[2])
        p = p + R @ xyz
        R = R @ _rpy(*rpy) @ _AX[ax](a)
    return p + R @ np.asarray(tool), R


def arm_ik(target, q0, side='left', tool=(0.0, 0.0, 0.0), rot=None, w_rot=0.3,
           iters=100, lo=None, hi=None, rot_axes=None):
    """Damped least-squares IK for position (and optionally orientation).

    Args:
        target: Desired tool point position (pelvis frame).
        q0: Initial joint guess.
        rot: Desired rotation matrix, or None.
        w_rot: Weight of orientation error.
        rot_axes: If given, list of (local_axis, world_dir) pairs to align
            instead of a full rotation.
    """
    q = np.array(q0, dtype=float)
    for _ in range(iters):
        p, R = arm_fk(q, side, tool)
        err = [np.asarray(target) - p]
        if rot is not None:
            Re = rot @ R.T
            ang = np.array([Re[2, 1] - Re[1, 2], Re[0, 2] - Re[2, 0], Re[1, 0] - Re[0, 1]]) * 0.5
            err.append(w_rot * ang)
        if rot_axes is not None:
            for la, wd in rot_axes:
                v = R @ np.asarray(la)
                err.append(w_rot * np.cross(v, np.asarray(wd)))
        e = np.concatenate(err)
        if np.linalg.norm(e) < 1e-4:
            break
        J = np.zeros((len(e), 7))
        eps = 1e-5
        for j in range(7):
            dq = q.copy()
            dq[j] += eps
            p2, R2 = arm_fk(dq, side, tool)
            col = [(p2 - p) / eps]
            if rot is not None:
                dR = R2 @ R.T
                col.append(w_rot * np.array([dR[2, 1] - dR[1, 2], dR[0, 2] - dR[2, 0], dR[1, 0] - dR[0, 1]]) * 0.5 / eps)
            if rot_axes is not None:
                for la, wd in rot_axes:
                    v1 = R @ np.asarray(la)
                    v2 = R2 @ np.asarray(la)
                    col.append(w_rot * (np.cross(v2, np.asarray(wd)) - np.cross(v1, np.asarray(wd))) / eps)
            J[:, j] = np.concatenate(col)
        lam = 0.02
        dq = J.T @ np.linalg.solve(J @ J.T + lam * np.eye(len(e)), e)
        n = np.linalg.norm(dq)
        if n > 0.3:
            dq *= 0.3 / n
        q = q + dq
        if lo is not None:
            q = np.clip(q, lo, hi)
    return q
