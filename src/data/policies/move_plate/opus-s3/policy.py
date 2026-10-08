"""Move the plate from the left dish rack to the right dish rack (Unitree G1).

Hand-written phase machine:
  measure both racks in the first head image -> raise the left arm (tool pointing 45
  degrees down) -> walk left -> find the plate column in the head image -> walk so the
  plate is in front of the left shoulder -> measure the left rack's depth -> centre the
  plate between the fingers with the left wrist camera -> descend along the tool axis ->
  close -> lift -> back off -> walk right -> stand still and measure the right rack
  against a calibrated head-image model -> move the wrist to the reference placing point
  shifted by the measured rack offset -> lower until contact -> open -> retract.
Geometry comes from hand-written G1 arm kinematics (fk.py) and camera measurements
(vision.py); no learned components.
"""

import os
import sys

import numpy as np

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import ctrl  # noqa: E402
import fk  # noqa: E402
import vision  # noqa: E402

ANG = 0.8                      # tool tilt below horizontal for grasp/place
SEEDQ = np.array([-1.752, 0.206, 1.323, 1.412, 1.115, 1.094, -0.073])
TUCKR = np.array([0.3, -0.15, 0.0, 1.2, 0.0, 0.0, 0.0])
HAND_REL_Y = 0.138             # wrist y relative to pelvis at grasp/place
GRASP_BASE_X = 0.02            # pelvis x at grasp
# Head-image models of the racks' front bar (right end column `ur`, row `bar`) as a
# function of pelvis (x, y), measured on the reference layout (seed 87) by walking a
# 3x3 grid of base positions. Offsets of another layout follow from the pixel residuals.
RACK_MODEL = {
    'left': dict(ur=(23.30, -11.6, 126.2), bar=(23.85, 88.0, 13.2)),
    # right: intercepts re-measured while holding the plate at lift height (body lean)
    'right': dict(ur=(90.39, 0.77, 124.8), bar=(28.62, 84.9, 0.2)),
}
PX_PER_M_LAT = 125.5
PX_PER_M_DEPTH = 86.5
# Wrist x, y that seated the plate in the reference layout (seed 87), shifted one peg
# pitch (+y) away from the rack's right end so small lateral errors stay inside the rack.
PLACE_REF = (0.317, -0.331 + 0.04)
HAND_REL_X = 0.363
LOOK_R_X = -0.10               # pelvis x where the right rack is measured (grid centre)
CARRY_V = 0.15                 # walking speed limit while holding the plate
# Rack features in the first head image (identical robot pose in every episode) for
# the reference layout, and the pixel scales at that distance.
START_REF = dict(urL=23.0, barL=17.55, ulR=58.0, barR=23.06)
START_PX_LAT = 118.0
START_PX_DEPTH = 62.0
OBS_X = -0.02
BACK_X = -0.22                 # pelvis x while walking sideways with the plate
WRIST_U_STAR = 40.5            # wrist image column of a plate centred between fingers
CAM_DY = 0.0175                # head camera lateral offset from pelvis
PLATE_U_C = 41.5
PLATE_K = 0.0068               # metres per pixel for the plate column estimate
PLATE_C = 0.053                # plate y - pelvis y for a plate at the image centre
LIFT_Z = 1.22
GRASP_Z = 0.98                 # wrist height with the rim deep between the fingers
GRASP_X = 0.35                 # wrist x at grasp for the reference rack
APPROACH = 0.07                # pre-grasp distance back along the tool axis
AXIS = np.array([np.cos(ANG), 0.0, -np.sin(ANG)])


def rack_offset(which, f, x, y):
    """Rack displacement (dx, dy) from the reference layout given head features."""
    if f is None or f['touch_r']:
        return np.zeros(2)
    m = RACK_MODEL[which]
    ur = m['ur'][0] + m['ur'][1] * x + m['ur'][2] * y
    bar = m['bar'][0] + m['bar'][1] * x + m['bar'][2] * y
    return np.array([-(f['bar'] - bar) / PX_PER_M_DEPTH, -(f['ur'] - ur) / PX_PER_M_LAT])


def _base_cmd(obs, goal, vmax=0.2, tol=0.012):
    x, y, _, yaw = ctrl.pelvis(obs)
    ex, ey = goal[0] - x, goal[1] - y
    c, s = np.cos(yaw), np.sin(yaw)
    bx, by = c * ex + s * ey, -s * ex + c * ey
    vx, vy = np.clip(1.5 * bx, -vmax, vmax), np.clip(1.5 * by, -vmax, vmax)
    d = np.hypot(bx, by)
    sp = np.hypot(vx, vy)
    if d < tol:
        return 0.0, 0.0, d
    if sp < 0.07:
        vx, vy = vx / sp * 0.07, vy / sp * 0.07
    return float(vx), float(vy), d


class Policy:
    """The control policy that is scored on the hidden seeds."""

    def reset(self, obs, tools):
        self.phase = 'raise'
        self.k = 0
        self.t = 0
        self.log = []
        o = obs['low_dim_obs']
        self.ql = o[0:7].astype(float).copy()
        self.qr = o[9:16].astype(float).copy()
        self.grip = 0.6
        self.qhigh = fk.arm_ik((0.25, 0.12, 0.45), SEEDQ, 'left', rot=ctrl.tilt_rot(ANG),
                               w_rot=0.3, iters=400, lo=ctrl.LO, hi=ctrl.HI)
        self.q_from = self.ql.copy()
        self.qr_from = self.qr.copy()
        self.goal = (OBS_X, 0.12)
        self.settle = 0
        self.Rw = ctrl.tilt_rot(ANG)
        self.hand_t = None
        self.corr = np.zeros(3)
        self.tries = 0
        self.looks = []
        self.plate_y = None
        self.place_t = None
        sf = vision.start_features(tools.image('head'))
        self.dL0 = np.zeros(2)
        self.dR0 = np.zeros(2)
        if sf is not None:
            r = START_REF
            self.dL0 = np.array([-(sf['barL'] - r['barL']) / START_PX_DEPTH, -(sf['urL'] - r['urL']) / START_PX_LAT])
            self.dR0 = np.array([-(sf['barR'] - r['barR']) / START_PX_DEPTH, -(sf['ulR'] - r['ulR']) / START_PX_LAT])
        self.looks.append(('start', sf, self.dL0, self.dR0))

    # ---- helpers
    def _set_phase(self, p):
        self.log.append((p, self.t))
        self.phase = p
        self.k = 0
        self.settle = 0

    def _hand_to(self, obs, target, rate=0.004, integrate=True):
        """Move the IK target smoothly toward `target` (world wrist point)."""
        hw = ctrl.hand_world(obs)[0]
        if self.hand_t is None:
            self.hand_t = hw.copy()
        d = np.asarray(target, float) - self.hand_t
        n = np.linalg.norm(d)
        if n > rate:
            d *= rate / n
        self.hand_t = self.hand_t + d
        if integrate:
            self.corr = np.clip(self.corr + 0.03 * (self.hand_t - hw), -0.04, 0.04)
        self.ql = ctrl.ik_world(self.hand_t + self.corr, self.Rw, obs, self.ql, iters=15)
        return n

    def _walk(self, obs, a, tol=0.02, n_settle=8, max_k=150, vmax=0.2):
        vx, vy, d = _base_cmd(obs, self.goal, vmax=vmax)
        a[0], a[1] = vx, vy
        self.settle = self.settle + 1 if d < tol else 0
        return self.settle > n_settle or self.k > max_k

    def _joint_interp(self, target, n):
        s = min(1.0, self.k / n)
        self.ql = self.q_from + (target - self.q_from) * s
        return self.k >= n

    def _rack(self, tools, which):
        im = tools.image('head')
        blobs = [b for b in vision.rack_blobs(im) if b['n'] > 60]
        if not blobs:
            return None, im
        b = min(blobs, key=lambda b: b['uc']) if which == 'left' else max(blobs, key=lambda b: b['uc'])
        return b, im

    def act(self, obs, tools):
        self.t = int(obs['t'])
        a = np.asarray(tools.hold_action(), dtype=np.float64).copy()
        a[3] = ctrl.yaw_hold(obs)
        self.k += 1
        ph = self.phase
        x, y, _, yaw = ctrl.pelvis(obs)

        if ph == 'raise':
            s = min(1.0, self.k / 40)
            self.ql = self.q_from + (self.qhigh - self.q_from) * s
            self.qr = self.qr_from + (TUCKR - self.qr_from) * s
            if self.k >= 45:
                self._set_phase('walk_obs')

        elif ph == 'walk_obs':
            if self._walk(obs, a):
                self._set_phase('find_plate')

        elif ph == 'find_plate':
            if self.k >= 5:
                b, im = self._rack(tools, 'left')
                up = vision.plate_column(im, b) if b is not None else None
                self.looks.append(('plate', x, y, up))
                if up is None:
                    self.goal = (OBS_X, y + 0.08)
                    self._set_phase('walk_obs')
                else:
                    self.plate_y = y + PLATE_C - (up - PLATE_U_C) * PLATE_K
                    self.goal = (GRASP_BASE_X, self.plate_y - HAND_REL_Y)
                    self._set_phase('walk_grasp')

        elif ph == 'walk_grasp':
            if self._walk(obs, a):
                self._set_phase('look_L')

        elif ph == 'look_L':
            if self.k >= 5:
                f = vision.rack_features(tools.image('head'), 'left')
                self.poseL = np.array([x, y])
                self.dL = rack_offset('left', f, x, y)
                self.looks.append(('L', x, y, yaw, None if f is None else (f['ur'], f['bar']), self.dL))
                self.hand_t = None
                self.grasp_pt = np.array([GRASP_X + self.dL[0], self.plate_y, GRASP_Z])
                self.pre = self.grasp_pt + np.array([0.01, 0.0, 0.10])
                self._set_phase('pregrasp')

        elif ph == 'pregrasp':
            n = self._hand_to(obs, self.pre, 0.005)
            if n < 1e-3 and self.k > 30:
                self._set_phase('wrist_servo')

        elif ph == 'wrist_servo':
            self._hand_to(obs, self.pre, 0.003)
            if self.k % 12 == 0:
                uw = vision.wrist_plate_column(tools.image('left_wrist'))
                self.looks.append(('wrist', self.pre[1], uw))
                done = uw is None or abs(uw - WRIST_U_STAR) < 1.5 or self.k > 150
                if not done:
                    self.pre[1] -= np.clip((uw - WRIST_U_STAR) * 0.0009, -0.01, 0.01)
                else:
                    self.grasp_pt[1] = self.pre[1]
                    self._set_phase('descend')

        elif ph == 'descend':
            tgt = self.grasp_pt + AXIS * 0.03
            n = self._hand_to(obs, tgt, 0.002, integrate=False)
            if n < 1e-3:
                self.settle += 1
            if self.settle > 15:
                self.grasp_hand = ctrl.hand_world(obs)[0]
                self._set_phase('close')

        elif ph == 'close':
            self.grip = 1.0
            if self.k > 30:
                self.hand_t = None
                self.place_t = np.array([PLACE_REF[0] + self.dR0[0], PLACE_REF[1] + self.dR0[1], LIFT_Z])
                self.looks.append(('place0', self.place_t.copy(), self.dL0, self.dR0))
                self._set_phase('lift')

        elif ph == 'lift':
            n = self._hand_to(obs, [self.grasp_hand[0] - 0.05, self.grasp_hand[1], LIFT_Z], 0.005)
            if n < 1e-3 or self.k > 100:
                self.goal = (BACK_X, y)
                self._set_phase('back_off')

        elif ph == 'back_off':
            if self._walk(obs, a, tol=0.04, n_settle=2, vmax=CARRY_V):
                self.goal = (BACK_X, self.place_t[1] - HAND_REL_Y)
                self._set_phase('walk_side')

        elif ph == 'walk_side':
            if self._walk(obs, a, tol=0.03, n_settle=3, max_k=350, vmax=CARRY_V):
                # stand so the right rack appears where it did during calibration
                self.goal = (LOOK_R_X + float(np.clip(self.dR0[0], -0.06, 0.1)), self.place_t[1] - HAND_REL_Y)
                self._set_phase('approach_R')

        elif ph == 'approach_R':
            if self._walk(obs, a, tol=0.015, n_settle=25, max_k=250, vmax=CARRY_V):
                self.feats = []
                self._set_phase('look_R')

        elif ph == 'look_R':
            # let the walking transient decay, then take the median over ~0.7 s
            f = vision.rack_features(tools.image('head'), 'right') if self.k >= 15 else None
            if f is not None and not f['touch_r']:
                self.feats.append(rack_offset('right', f, x, y))
            if self.k >= 50:
                if self.feats:
                    self.dR = np.median(np.array(self.feats), axis=0)
                    if np.all(np.abs(self.dR - self.dR0) < 0.08):
                        self.place_t = np.array([PLACE_REF[0] + self.dR[0], PLACE_REF[1] + self.dR[1], LIFT_Z])
                self.looks.append(('place', self.place_t.copy(), self.feats[-1] if self.feats else None))
                self.rel_x = ctrl.hand_world(obs)[0][0] - x
                self.hand_t = None
                self.goal = (self.place_t[0] - HAND_REL_X, self.place_t[1] - HAND_REL_Y)
                self._set_phase('insert')

        elif ph == 'insert':
            done = self._walk(obs, a, max_k=200, vmax=CARRY_V)
            tgt = self.place_t.copy()
            tgt[0] = min(x + self.rel_x, self.place_t[0])
            self._hand_to(obs, tgt, 0.004)
            if done:
                self._set_phase('reach_place')

        elif ph == 'reach_place':
            n = self._hand_to(obs, self.place_t, 0.003)
            hw = ctrl.hand_world(obs)[0]
            if n < 1e-3 and self.k > 15 and (np.linalg.norm(hw[:2] - self.place_t[:2]) < 0.008 or self.k > 90):
                self._set_phase('lower_place')

        elif ph == 'lower_place':
            tgt = np.array([self.place_t[0], self.place_t[1], self.grasp_hand[2] - 0.04])
            self._hand_to(obs, tgt, 0.002, integrate=False)
            hw = ctrl.hand_world(obs)[0]
            if self.hand_t[2] < hw[2] - 0.02 or self.k > 200:
                self.release_z = hw[2]
                self._set_phase('release')

        elif ph == 'release':
            self.grip = 0.0
            if self.k > 20:
                self.hand_t = None
                self._set_phase('retract')

        elif ph == 'retract':
            hw = self.place_t
            if self.k < 30:
                self._hand_to(obs, [hw[0] - 0.02, hw[1], self.release_z + 0.08], 0.003)
            else:
                self._hand_to(obs, [hw[0] - 0.12, hw[1], LIFT_Z], 0.004)
            if self.k > 60:
                self._set_phase('done')

        return self._finish(a)

    def _finish(self, a):
        a[4:11] = self.ql
        a[11:18] = self.qr
        a[18] = self.grip
        a[19] = 0.6
        return a.astype(np.float32)
