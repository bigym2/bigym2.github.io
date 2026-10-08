"""Camera, floor and arm geometry for the G1 reach policy (hand-written models)."""

import numpy as np

# ---------------------------------------------------------------- head camera
# Fitted from the floor checkerboard (0.2 m squares) in the head images.
F_PX = 68.51          # focal length in pixels (84x84 image)
K1 = -0.0225          # radial term (undistorted = distorted * (1 + K1 r^2))
CAM_PITCH = 1.104     # rad, pitched down
CAM_ROLL = -0.012
CAM_YAW = -0.005      # relative to the pelvis yaw
CAM_H_ABOVE_PELVIS = 0.349   # camera height above the pelvis z (world)
# camera position in the arm-FK frame (fitted against hand observations)
CAM_FK = np.array([0.146, 0.0, 0.382])
NADIR = None


def _rot(th, ph, ps):
    cy, sy = np.cos(ps), np.sin(ps)
    cp, sp = np.cos(th), np.sin(th)
    cr, sr = np.cos(ph), np.sin(ph)
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    Ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    Rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    return Rz @ Ry @ Rx


R_CAM = _rot(CAM_PITCH, CAM_ROLL, CAM_YAW)   # camera -> yaw-aligned body frame


def pixel_ray(u, v):
    """Unit ray (body frame, yaw-aligned, z up) through pixel (u, v)."""
    xd = (u - 42.0) / F_PX
    yd = (v - 42.0) / F_PX
    rr = xd * xd + yd * yd
    xu = xd * (1 + K1 * rr)
    yu = yd * (1 + K1 * rr)
    d = R_CAM @ np.array([1.0, -xu, -yu])
    return d / np.linalg.norm(d)


def project(p_cam):
    """Pixel of point p (body frame, relative to the camera)."""
    d = R_CAM.T @ p_cam
    if d[0] <= 1e-6:
        return None
    xu, yu = -d[1] / d[0], -d[2] / d[0]
    rr = xu * xu + yu * yu
    xd, yd = xu / (1 + K1 * rr), yu / (1 + K1 * rr)
    return 42.0 + F_PX * xd, 42.0 + F_PX * yd


def floor_point(u, v, cam_h):
    """Floor point (relative to camera, body frame) seen at pixel (u, v)."""
    d = pixel_ray(u, v)
    if d[2] >= -1e-3:
        return None
    return d * (cam_h / -d[2])


# ---------------------------------------------------------------- wrist cameras
# Fitted from the floor checkerboard in the wrist images at the default arm pose:
# the camera looks 0.744 rad below the wrist-yaw link x axis.
WR_F = 73.0
SPHERE_R = 0.05


def _ry_(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


R_LC = _ry_(0.744)     # wrist camera (fwd, left, up) -> wrist-yaw link frame


def wrist_dir(u, v):
    d = np.array([1.0, -(u - 42.0) / WR_F, -(v - 42.0) / WR_F])
    return d / np.linalg.norm(d)


def wrist_sphere_cam(u, v, r):
    """Sphere centre in wrist camera coordinates from its image circle."""
    D = SPHERE_R / np.sin(np.arctan(max(r, 1.0) / WR_F))
    return D * wrist_dir(u, v)


# ---------------------------------------------------------------- arm FK
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


_TORSO = np.array([-0.0039635, 0.0, 0.054])
_AX = {'x': _rx, 'y': _ry, 'z': _rz}
_AXV = {'x': np.array([1.0, 0, 0]), 'y': np.array([0, 1.0, 0]), 'z': np.array([0, 0, 1.0])}


def _chain(side):
    s = 1.0 if side == 'L' else -1.0
    return [
        ((0.0039563, s * 0.10022, 0.23778), _rpy(s * 0.27931, 5.4949e-05, -s * 0.00019159), 'y'),
        ((0.0, s * 0.038, -0.013831), _rpy(-s * 0.27925, 0, 0), 'x'),
        ((0.0, s * 0.00624, -0.1032), np.eye(3), 'z'),
        ((0.015783, 0, -0.080518), np.eye(3), 'y'),
        ((0.100, s * 0.00188791, -0.010), np.eye(3), 'x'),
        ((0.038, 0, 0), np.eye(3), 'y'),
        ((0.046, 0, 0), np.eye(3), 'z'),
    ]


CHAINS = {'L': _chain('L'), 'R': _chain('R')}
TOOL = np.array([0.153, -0.017, 0.020])   # fingertip midpoint in the wrist-yaw frame (left)

JL = {
    'L': (np.array([-3.0892, -1.5882, -2.618, -1.0472, -1.97222, -1.61443, -1.61443]),
          np.array([2.6704, 2.2515, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])),
    'R': (np.array([-3.0892, -1.5882, -2.618, -1.0472, -1.97222, -1.61443, -1.61443]),
          np.array([2.6704, 2.2515, 2.618, 2.0944, 1.97222, 1.61443, 1.61443])),
}


def tool_of(side):
    t = TOOL.copy()
    if side == 'R':
        t[1] = -t[1]
    return t


def fk(q, side, tool=None):
    """Tool position, wrist-yaw rotation, and joint (pos, axis) list in the FK frame."""
    tool = tool_of(side) if tool is None else tool
    p = _TORSO.copy()
    R = np.eye(3)
    joints = []
    for (xyz, R0, ax), qi in zip(CHAINS[side], q):
        p = p + R @ np.array(xyz)
        R = R @ R0
        joints.append((p.copy(), R @ _AXV[ax]))
        R = R @ _AX[ax](qi)
    return p + R @ tool, R, joints


def jacobian(q, side, tool=None):
    pt, R, joints = fk(q, side, tool)
    J = np.zeros((3, 7))
    for i, (pj, a) in enumerate(joints):
        J[:, i] = np.cross(a, pt - pj)
    return pt, R, J


Q_REST = np.array([0.0, 0.1, 0.0, 0.3, 0.0, 0.0, 0.0])


def ik(target, q0, side, n_iter=40, active=(0, 1, 2, 3), q_rest=None, w_rest=3e-4, tool=None):
    """Position IK: min |p(q) - target|^2 + w_rest |q - q_rest|^2 (Levenberg-Marquardt)."""
    q = np.array(q0, dtype=float).copy()
    lo, hi = JL[side]
    act = list(active)
    if q_rest is None:
        q_rest = Q_REST.copy()
        if side == 'R':
            q_rest[[1, 2, 4, 6]] *= -1
    q_rest = np.asarray(q_rest, dtype=float)
    lam = 1e-4
    for _ in range(n_iter):
        p, _, J = jacobian(q, side, tool)
        e = target - p
        Ja = J[:, act]
        A = Ja.T @ Ja + (lam + w_rest) * np.eye(len(act))
        b = Ja.T @ e + w_rest * (q_rest[act] - q[act])
        dq = np.linalg.solve(A, b)
        n = np.linalg.norm(dq)
        if n > 0.2:
            dq *= 0.2 / n
        q[act] = np.clip(q[act] + dq, lo[act] + 0.02, hi[act] - 0.02)
        if n < 1e-5:
            break
    p, _, _ = fk(q, side, tool)
    return q, float(np.linalg.norm(target - p))
