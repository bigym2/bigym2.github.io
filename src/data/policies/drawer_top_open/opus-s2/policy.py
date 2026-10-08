"""Open the top drawer of the kitchen cabinet.

Pipeline: look at the drawer front with the left wrist camera, localise the top
handle in 3D (calibrated wrist camera + arm forward kinematics + known handle
height), walk to a standing spot, re-localise from close by, grasp the handle
with the left gripper rolled 90 degrees (fingers above/below the bar) and pull.
"""

import numpy as np
from scipy.spatial.transform import Rotation

from g1kin import fk, ik, rotx, roty, rotz
from handles import find_handles

# Left wrist camera, in the wrist_yaw link frame: offset, rotation (rotvec), focal (px).
CAM_OFF = np.array([0.136654, 0.007828, 0.035661])
CAM_R = Rotation.from_rotvec([-1.72328, 1.756228, -0.776116]).as_matrix()
CAM_F = 68.061685
HZ = (0.7365, 0.6008, 0.4956)  # world heights of the three stacked handle bars
HHALF = (0.0403, 0.0516, 0.0495)  # their half lengths
Z_TOP = HZ[0]

TOOL = np.array([0.16, 0.0, 0.0])  # grasp point between the fingertips, wrist_yaw frame
QR_SAFE = np.array([0.3, -0.2, 0.0, 1.2, 0.0, 0.0, 0.0])

STAND = np.array([0.30, 0.12])  # handle position in the pelvis frame when grasping
ROLL = np.pi / 2
GRASP_DX = 0.02 # final grasp point beyond the bar (handle frame, m): bar deep between the fingers
GRASP_DY = -0.02  # lateral correction so the fingers close near the middle of the bar
V_STAR = 30.0  # bar row (rotated wrist image) seen just before good grasps


def cam_world(q, pel):
    _, _, fr = fk(q, "L")
    p, R = fr[6]
    Ry = rotz(pel[3])
    C = np.array([pel[0], pel[1], pel[2]]) + Ry @ (p + R @ CAM_OFF)
    return C, Ry @ R @ CAM_R


def ray_plane(C, R, uv, z):
    d = R @ np.array([(uv[0] - 41.5) / CAM_F, (uv[1] - 41.5) / CAM_F, 1.0])
    if d[2] > -1e-3:
        return None
    return C + (z - C[2]) / d[2] * d


def _bar_center(C, R, h, z, half):
    """Centre (x, y) and yaw of a bar of known height and half length, or None."""
    p1 = ray_plane(C, R, h["e1"], z)
    p2 = ray_plane(C, R, h["e2"], z)
    if p1 is None or p2 is None:
        return None
    L = np.linalg.norm(p1 - p2)
    if h["trunc"]:
        if not (0.015 < L < 2 * half + 0.02):
            return None
        e1_in = 1.5 < h["e1"][0] < 81.5 and 1.5 < h["e1"][1] < 81.5
        d = (p2 - p1) / (L + 1e-9)
        if e1_in:
            p2 = p1 + d * 2 * half
        else:
            p1 = p2 - d * 2 * half
    elif abs(L - 2 * half) > 0.025:
        return None
    d = p1 - p2
    yaw = np.arctan2(-d[0], d[1])
    return np.array([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]), float(yaw), bool(h["trunc"])


def localize_top(img, q, pel, prior=None):
    """World position (x, y) and yaw of the top handle, or None.

    Every bar seen is tried as each of the three stacked handles (known heights);
    the labelling under which the bars agree on one position wins.
    """
    C, R = cam_world(q, pel)
    hs = [h for h in find_handles(img) if abs(h["angle"]) < 40 and h["length"] > 8 and h["width"] > 1.6]
    hs.sort(key=lambda h: h["c"][1])
    hyp = []  # (det index, k, centre, yaw, trunc)
    for i, h in enumerate(hs):
        for k in range(3):
            r = _bar_center(C, R, h, HZ[k], HHALF[k])
            if r is not None:
                hyp.append((i, k, r[0], r[1], r[2]))
    if not hyp:
        return None
    best, best_score = None, -1e9
    for a in hyp:
        members = [a]
        for b in hyp:
            if b[0] == a[0]:
                continue
            if (b[0] < a[0]) != (b[1] < a[1]) or b[1] == a[1]:
                continue
            if np.linalg.norm(b[2] - a[2]) < 0.03 and all(m[0] != b[0] for m in members):
                members.append(b)
        score = len(members) - 0.3 * sum(m[4] for m in members)
        if prior is not None:
            score -= 3.0 * np.linalg.norm(a[2] - prior)
        if score > best_score:
            best, best_score = members, score
    w = np.array([0.3 if m[4] else 1.0 for m in best])
    c = sum(wi * m[2] for wi, m in zip(w, best)) / w.sum()
    yaws = [m[3] for m in best if not m[4]] or [m[3] for m in best]
    return c, float(np.median(yaws)), len(best)


def bar_row_rotated(img):
    """Row at which the handle bar crosses the finger axis, in the wrist image rotated so
    that world-up is image-up (gripper rolled 90 degrees). Returns (row, width) or None."""
    rot = np.ascontiguousarray(np.rot90(img, k=-1))
    best = None
    for h in find_handles(rot):
        if abs(h["angle"]) > 30 or h["width"] < 3.5 or h["length"] < 12:
            continue
        cu, cv = h["c"]
        e1, e2 = h["e1"], h["e2"]
        slope = (e2[1] - e1[1]) / (e2[0] - e1[0] + 1e-9)
        row = cv + slope * (43 - cu)
        if best is None or h["area"] > best[2]:
            best = (row, h["width"], h["area"])
    return None if best is None else best[:2]


class Policy:
    def reset(self, obs, tools):
        o = np.asarray(obs["low_dim_obs"], float)
        self.x0, self.y0, self.yaw0 = o[18], o[19], o[21]
        self.t = 0
        self.phase = "look0"
        self.pt = 0
        self.base_goal = None
        self.yaw_goal = self.yaw0
        self.ql = np.zeros(7)
        self.qr = np.zeros(7)
        self.grip = 0.0
        self.handle = None
        self.hyaw = 0.0
        self.dz = 0.0
        self.dbg = None
        self.debug = getattr(self, "debug", False)

    # ---------------------------------------------------------------- base
    def base_cmd(self, o):
        if self.base_goal is None:
            return 0.0, 0.0, 0.0, 0.0
        ex, ey = self.base_goal[0] - o[18], self.base_goal[1] - o[19]
        c, s = np.cos(o[21]), np.sin(o[21])
        bx, by = c * ex + s * ey, -s * ex + c * ey
        vx, vy = np.clip(1.5 * bx, -0.2, 0.2), np.clip(1.5 * by, -0.2, 0.2)
        sp = np.hypot(vx, vy)
        dist = np.hypot(bx, by)
        if sp < 0.06:
            if dist > 0.02:
                vx, vy = vx / (sp + 1e-9) * 0.06, vy / (sp + 1e-9) * 0.06
            else:
                vx = vy = 0.0
        eyaw = (self.yaw_goal - o[21] + np.pi) % (2 * np.pi) - np.pi
        wz = np.clip(2.0 * eyaw, -0.4, 0.4)
        if abs(wz) < 0.03:
            wz = 0.0
        return vx, vy, wz, dist

    def handle_rel(self, o):
        """Top handle in the current pelvis frame (x, y, z) and relative yaw."""
        d = self.handle - o[18:20]
        c, s = np.cos(o[21]), np.sin(o[21])
        return np.array([c * d[0] + s * d[1], -s * d[0] + c * d[1], Z_TOP - o[20]]), self.hyaw - o[21]

    def grasp_R(self, ryaw):
        return rotz(ryaw) @ rotx(ROLL)

    def set_stand_goal(self):
        c, s = np.cos(self.hyaw), np.sin(self.hyaw)
        off = np.array([c * STAND[0] - s * STAND[1], s * STAND[0] + c * STAND[1]])
        self.base_goal = self.handle - off
        self.yaw_goal = self.hyaw

    def look(self, o, tools):
        img = tools.image("left_wrist")
        r = localize_top(img, o[0:7], o[18:22], prior=self.handle)
        if r is None:
            self.dbg = dict(look="fail")
            return False
        self.handle, self.hyaw = r[0], float(np.clip(r[1], -0.15, 0.15))
        self.dbg = dict(h=np.round(self.handle, 3).tolist(), yaw=round(self.hyaw, 3), n=r[2])
        return True

    # ---------------------------------------------------------------- act
    def act(self, obs, tools):
        o = np.asarray(obs["low_dim_obs"], float)
        self.t += 1
        self.pt += 1
        qcur = o[0:7]

        if self.phase == "look0":
            self.ql = np.zeros(7)
            self.qr = np.zeros(7)
            self.grip = 0.0
            if self.pt >= 25:
                ok = self.look(o, tools)
                if not ok:
                    self.handle = np.array([self.x0 + 0.54, self.y0])
                    self.hyaw = 0.0
                self.set_stand_goal()
                self.phase, self.pt = "walk", 0
                # arm pose for walking / second look: camera above and behind the handle
                self.q_look, _, _ = ik(np.array([0.22, 0.12, 0.12]), roty(0.25), np.zeros(7), tool=TOOL)
        elif self.phase == "walk":
            s = min(1.0, self.pt / 30)
            self.ql = s * self.q_look
            self.qr = s * QR_SAFE
            _, _, _, dist = self.base_cmd(o)
            eyaw = abs(self.yaw_goal - o[21])
            if (dist < 0.02 and eyaw < 0.05 and self.pt > 40) or self.pt > 250:
                self.phase, self.pt = "settle", 0
        elif self.phase == "settle":
            if self.pt >= 20:
                self.look(o, tools)
                self.set_stand_goal()
                hr, ryaw = self.handle_rel(o)
                self.q_from = qcur.copy()
                self.q_pre, _, _ = ik(hr + rotz(ryaw) @ np.array([-0.12, GRASP_DY, 0]), self.grasp_R(ryaw),
                                      self.ql, tool=TOOL)
                self.phase, self.pt = "pre", 0
        elif self.phase == "pre":
            s = min(1.0, self.pt / 40)
            self.ql = self.q_from + s * (self.q_pre - self.q_from)
            if self.pt >= 55:
                self.phase, self.pt = "approach", 0
        elif self.phase == "approach":
            # -0.12 -> -0.05 (steps 0-40), dwell (40-70), -> GRASP_DX (70-100)
            if self.pt < 40:
                dx = -0.12 + 0.07 * self.pt / 40
            elif self.pt < 70:
                dx = -0.05
            else:
                dx = -0.05 + (0.05 + GRASP_DX) * min(1.0, (self.pt - 70) / 30)
            if self.pt % 5 == 1:
                if self.pt < 95:
                    r = bar_row_rotated(tools.image("left_wrist"))
                    if r is not None:
                        depth = max(0.03, -dx + 0.03)
                        err = r[0] - V_STAR
                        self.dz = float(np.clip(self.dz - 0.5 * err * depth / CAM_F, -0.05, 0.05))
                    self.dbg = dict(bar=None if r is None else [round(float(r[0]), 1), round(float(r[1]), 1)],
                                    dz=round(self.dz, 4))
                hr, ryaw = self.handle_rel(o)
                self.ql, _, _ = ik(hr + rotz(ryaw) @ np.array([dx, GRASP_DY, 0]) + np.array([0, 0, self.dz]),
                                   self.grasp_R(ryaw), self.ql, tool=TOOL, iters=40)
            if self.pt >= 110:
                self.phase, self.pt = "grasp", 0
        elif self.phase == "grasp":
            self.grip = min(1.0, self.pt / 15)
            if self.pt >= 40:
                self.phase, self.pt = "pull", 0
                hr, ryaw = self.handle_rel(o)
                self.pull_from = hr + rotz(ryaw) @ np.array([GRASP_DX, GRASP_DY, 0]) + np.array([0, 0, self.dz])
                self.pull_ryaw = ryaw
                c, s_ = np.cos(self.hyaw), np.sin(self.hyaw)
                self.base_goal = self.base_goal - 0.35 * np.array([c, s_])
                self.base_hold = True
        elif self.phase == "pull":
            s = min(1.0, self.pt / 80)
            if self.pt % 4 == 1:
                tgt = self.pull_from + rotz(self.pull_ryaw) @ np.array([-0.18 * s, 0, 0])
                self.ql, _, _ = ik(tgt, self.grasp_R(self.pull_ryaw), self.ql, tool=TOOL, iters=40)

        raw = np.zeros(20)
        raw[2] = 0.74
        if self.phase in ("look0", "settle", "pre", "approach", "grasp") or (self.phase == "pull" and self.pt < 60):
            vx = vy = wz = 0.0
        else:
            vx, vy, wz, _ = self.base_cmd(o)
        raw[0], raw[1], raw[3] = vx, vy, wz
        raw[4:11] = self.ql
        raw[11:18] = self.qr
        raw[18] = self.grip
        raw[19] = 0.0
        return raw
