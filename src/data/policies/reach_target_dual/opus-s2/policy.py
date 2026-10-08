"""Dual reach: touch the red sphere with the left hand and the green one with the right.

Hand-written pipeline:
  1. Stand still for a few steps and locate both spheres with the head camera: the
     sphere disc gives a viewing ray, its floor shadow (light from straight above)
     gives the horizontal position; together they give the 3D centre (world frame).
  2. Walk so that the spheres sit at a comfortable reach in front of the shoulders,
     then look again from there.
  3. Move each hand (position IK) to the estimate. Once the sphere shows up in the
     wrist camera, servo the hand so the sphere sits at a fixed place in that view.
  4. A sphere lights up while it is touched. A hand whose sphere is neither lit nor
     seen by its wrist camera searches small offsets around the estimate.
"""

import numpy as np

import g1reach_geom as geom
from g1reach_vision import find_sphere, find_shadows

Q_DEFAULT = np.array([0.018, 0.0, 0.0, 0.028, 0.0, 0.038, 0.0])
OBS_STEPS = 10
X_REACH = 0.30          # desired sphere x in the arm frame after walking
WALK_TOL = 0.02
MOVE_STEPS = 40
SETTLE = 20
PROBE_STEPS = 12
TARGET_BIAS = np.array([0.01, 0.01, 0.035])   # (x, outward, z) on the head estimate
DEFAULT_Z = 0.115       # sphere height (arm frame) when it is not seen in the head view
WR_TARGET = (42.0, 38.0, 56.0)   # where the touched sphere sits in the wrist view
PRESS = 0.01           # extra push along the wrist view axis on first contact
OFF_RATE = 0.004        # m per step at which search offsets are approached
MAX_DEV = 0.10
# typical sphere centres in the arm frame at the start pose (fallback only)
TYPICAL = {'red': np.array([0.46, 0.17, 0.10]), 'green': np.array([0.47, -0.20, 0.08])}         # servo may move the hand target this far from the head estimate
SERVO_GAIN = 0.35
SERVO_STEP = 0.02
DEBUG = False


def _search_offsets():
    # the wrist camera looks down and forward: going up first brings a sphere that is
    # higher than estimated into view; y is outward for either hand
    offs = [(0, 0, 0), (0, 0, 0.03), (-0.01, 0, 0.06), (-0.02, 0, 0.09), (0.02, 0, -0.02),
            (0.03, 0, -0.05), (-0.01, 0.03, 0.04), (-0.01, -0.03, 0.04), (0.03, 0, 0.02),
            (-0.02, 0.04, 0.08), (-0.02, -0.04, 0.08), (0.02, 0.03, -0.03), (0.02, -0.03, -0.03),
            (-0.03, 0, 0.12), (0.04, 0, -0.08)]
    return [np.array(o, dtype=float) for o in offs]


SEARCH = _search_offsets()
SIDES = (('L', 'red'), ('R', 'green'))


def _rz2(yaw):
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([[c, -s], [s, c]])


def _rz3(yaw):
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def lit_in(img, color):
    im = img.astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    if color == 'red':
        m = (r >= 235) & (g < 90) & (b < 90)
    else:
        m = (g >= 235) & (r < 120) & (b < 120)
    return int(m.sum())


def _wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


class Policy:
    """The control policy that is scored on the hidden seeds."""

    def reset(self, obs, tools):
        self.hold = np.asarray(tools.hold_action(), dtype=np.float32)
        self.t = 0
        self.phase = 'observe'
        self.phase_t = 0
        self.samples = {'red': [], 'green': []}
        self.shadow_only = {'red': [], 'green': []}
        self.world = {}
        self.quality = {}
        self.q_cmd = {'L': Q_DEFAULT.copy(), 'R': Q_DEFAULT.copy()}
        self.q_out = {'L': Q_DEFAULT.copy(), 'R': Q_DEFAULT.copy()}
        self.integ = {'L': np.zeros(7), 'R': np.zeros(7)}
        self.hand = {}
        self.yaw0 = float(obs['low_dim_obs'][21])
        self.debug = []

    # ------------------------------------------------------------ geometry
    def _to_world(self, p_fk, pel, yaw):
        wxy = pel[:2] + _rz2(yaw) @ p_fk[:2]
        return np.array([wxy[0], wxy[1], p_fk[2] - (pel[2] - 0.746)])

    def _to_fk(self, w, pel, yaw):
        xy = _rz2(yaw).T @ (w[:2] - pel[:2])
        return np.array([xy[0], xy[1], w[2] + (pel[2] - 0.746)])

    def _estimate(self, img, pel, yaw):
        cam_h = pel[2] + geom.CAM_H_ABOVE_PELVIS
        shadows = [s for s in find_shadows(img) if s['area'] <= 90 and max(s['w'], s['h']) <= 12]
        for s in shadows:
            s['fp'] = geom.floor_point(s['u'], s['v'], cam_h)
        shadows = [s for s in shadows if s['fp'] is not None]
        used = set()
        for color in ('red', 'green'):
            sp = find_sphere(img, color)
            if sp is None or sp['area'] < 6:
                continue
            d = geom.pixel_ray(sp['u'], sp['v'])
            best = None
            for i, s in enumerate(shadows):
                S = s['fp']
                t = (S[:2] @ d[:2]) / (d[:2] @ d[:2])
                if t <= 0:
                    continue
                err = np.linalg.norm(t * d[:2] - S[:2])
                # height from the ray elevation at the shadow's horizontal distance
                z_rel = np.linalg.norm(S[:2]) * d[2] / np.linalg.norm(d[:2])
                P = np.array([S[0], S[1], z_rel])
                z_world = cam_h + P[2]
                if not (0.5 < z_world < 1.3):
                    continue
                if best is None or err < best[0]:
                    best = (err, P, i)
            if best is None or best[0] > (0.07 if sp['border'] else 0.045):
                continue
            used.add(best[2])
            self.samples[color].append(self._to_world(geom.CAM_FK + best[1], pel, yaw))
        # shadows that belong to no visible sphere: candidates for a sphere out of view
        rest = [s for i, s in enumerate(shadows)
                if i not in used and 12 <= s['area'] <= 60
                and 0.18 < s['fp'][0] < 0.6 and abs(s['fp'][1]) < 0.45]
        if rest:
            ys = [s['fp'][1] for s in rest]
            for color, pick in (('red', int(np.argmax(ys))), ('green', int(np.argmin(ys)))):
                s = rest[pick]
                P = s['fp'].copy()
                fk = geom.CAM_FK + P
                fk[2] = self._hidden_height(P, cam_h)
                self.shadow_only[color].append(self._to_world(fk, pel, yaw))

    @staticmethod
    def _hidden_height(P, cam_h):
        """Arm-frame height guess for a sphere whose shadow is seen but the sphere is not."""
        for z_fk in np.arange(-0.05, 0.35, 0.01):
            p = np.array([P[0], P[1], z_fk - geom.CAM_FK[2]])
            uv = geom.project(p)
            if uv is None:
                break
            if 0 <= uv[0] < 84 and uv[1] < -4:
                return min(z_fk + 0.03, 0.25)
        return DEFAULT_Z

    def _fuse(self, prior=None):
        for c in ('red', 'green'):
            est, qual = None, None
            if len(self.samples[c]) >= 2:
                est, qual = np.median(np.array(self.samples[c]), axis=0), 'full'
            elif prior is None or c not in prior or self.quality.get(c) == 'guess':
                if len(self.shadow_only[c]) >= 2:
                    est, qual = np.median(np.array(self.shadow_only[c]), axis=0), 'shadow'
            if prior is not None and c in prior:
                keep_prior = est is None or (np.linalg.norm(est - prior[c]) > 0.08
                                             and self.quality.get(c) == 'full')
                if keep_prior:
                    est, qual = prior[c], self.quality.get(c)
            if est is not None:
                self.world[c] = est
                self.quality[c] = qual
        # a shadow-only guess must not duplicate the other sphere
        if 'red' in self.world and 'green' in self.world:
            if np.linalg.norm(self.world['red'][:2] - self.world['green'][:2]) < 0.08:
                for c in ('red', 'green'):
                    if len(self.samples[c]) < 2 and (prior is None or c not in prior):
                        del self.world[c]
        self.samples = {'red': [], 'green': []}
        # nothing seen at all: fall back to the typical placement
        for c in ('red', 'green'):
            if c not in self.world:
                self.world[c] = self._to_world(TYPICAL[c], self.pel_now, self.yaw_now)
                self.quality[c] = 'guess'
        self.shadow_only = {'red': [], 'green': []}

    def _walk_goal(self):
        pts = [self.world[c][:2] for c in ('red', 'green') if c in self.world]
        if len(pts) < 2:
            return None
        m = np.mean(pts, axis=0)
        return m - _rz2(self.yaw0) @ np.array([X_REACH, 0.0])

    # ------------------------------------------------------------ control
    def _arm_out(self, raw):
        raw[4:11] = self.q_out['L']
        raw[11:18] = self.q_out['R']

    def act(self, obs, tools):
        raw = self.hold.copy()
        lo = obs['low_dim_obs']
        pel, yaw = lo[18:21].astype(float), float(lo[21])
        self.pel_now, self.yaw_now = pel, yaw
        t = self.t
        self.t += 1
        self.phase_t += 1
        pt = self.phase_t

        if self.phase == 'observe':
            if pt >= 3:
                self._estimate(tools.image('head'), pel, yaw)
            if pt >= OBS_STEPS:
                self._fuse()
                self.goal = self._walk_goal()
                self.phase, self.phase_t = ('walk' if self.goal is not None else 'settle'), 0
            self._arm_out(raw)
            return raw

        if self.phase == 'walk':
            e_b = _rz2(yaw).T @ (self.goal - pel[:2])
            v = np.clip(1.5 * e_b, -0.3, 0.3)
            if np.linalg.norm(e_b) < WALK_TOL or pt > 250:
                self.phase, self.phase_t = 'settle', 0
                v = np.zeros(2)
            else:
                sp = np.linalg.norm(v)
                if sp < 0.07:
                    v = v / max(sp, 1e-6) * 0.07
            raw[0], raw[1] = v[0], v[1]
            raw[3] = np.clip(-1.5 * _wrap(yaw - self.yaw0), -0.3, 0.3)
            self._arm_out(raw)
            return raw

        if self.phase == 'settle':
            if pt >= 25:
                self._estimate(tools.image('head'), pel, yaw)
            if pt >= 35:
                self._fuse(prior=dict(self.world))
                self.phase, self.phase_t = 'reach', 0
            self._arm_out(raw)
            return raw

        # ---- reach / servo / search
        if not self.hand:
            for side, c in SIDES:
                if c not in self.world:
                    continue
                b = TARGET_BIAS * np.array([1, 1 if side == 'L' else -1, 1])
                tgt0 = self.world[c] + _rz3(yaw) @ b
                self.hand[side] = dict(color=c, k=0, lit=False, unlit=0, seen=-100, wr=None,
                                       tgt=tgt0.copy(), tgt0=tgt0, pressed=False, off=np.zeros(3))
        imgs = None
        if pt % 2 == 0:
            imgs = {cam: tools.image(cam) for cam in ('head', 'left_wrist', 'right_wrist')}
        for side, c in SIDES:
            if side not in self.hand:
                continue
            h = self.hand[side]
            qm = (lo[0:7] if side == 'L' else lo[9:16]).astype(float)
            if imgs is not None:
                lit = sum(lit_in(im, c) for im in imgs.values()) >= 3
                h['lit'] = lit
                h['unlit'] = 0 if lit else h['unlit'] + 2
                if pt > MOVE_STEPS // 2:
                    wimg = imgs['left_wrist' if side == 'L' else 'right_wrist']
                    s = find_sphere(wimg, c)
                    h['wr'] = None if s is None else (round(s['u'], 1), round(s['v'], 1), round(s['r'], 1), s['area'])
                    ok = s is not None and s['r'] < 75 and (
                        s['area'] >= 60 or (s['border'] and s['area'] >= 20))
                    if ok:
                        h['seen'] = pt
                        if not lit:
                            if s['border'] and s['area'] < 400:
                                # a sliver at the edge: only its direction is reliable
                                p_s = geom.wrist_sphere_cam(s['cu'], s['cv'], 40.0)
                            else:
                                u = float(np.clip(s['u'], -30, 114))
                                v = float(np.clip(s['v'], -30, 114))
                                p_s = geom.wrist_sphere_cam(u, v, float(np.clip(s['r'], 20.0, 60.0)))
                            p_t = geom.wrist_sphere_cam(*WR_TARGET)
                            _, R_link, _ = geom.fk(qm, side)
                            e = _rz3(yaw) @ (R_link @ geom.R_LC @ (p_s - p_t))
                            step = SERVO_GAIN * e
                            n = np.linalg.norm(step)
                            if n > SERVO_STEP:
                                step *= SERVO_STEP / n
                            new = h['tgt'] + step
                            dev = new - h['tgt0']
                            nd = np.linalg.norm(dev)
                            if nd > MAX_DEV:
                                new = h['tgt0'] + dev * MAX_DEV / nd
                            h['tgt'] = new
            if imgs is not None:
                if h['lit'] and not h['pressed']:
                    # first contact: lean a little further in along the wrist view axis
                    _, R_link, _ = geom.fk(qm, side)
                    axis = _rz3(yaw) @ (R_link @ geom.R_LC @ np.array([1.0, 0, 0]))
                    h['tgt'] = h['tgt'] + PRESS * axis
                    h['pressed'] = True
                elif h['unlit'] >= 20:
                    h['pressed'] = False
            recently_seen = pt - h['seen'] < 30
            if pt > MOVE_STEPS + SETTLE and h['unlit'] >= PROBE_STEPS and not recently_seen:
                h['k'] = (h['k'] + 1) % len(SEARCH)
                h['unlit'] = 0
            goal = SEARCH[h['k']].copy()
            if side == 'R':
                goal[1] = -goal[1]
            d_off = goal - h['off']
            n = np.linalg.norm(d_off)
            h['off'] = goal if n <= OFF_RATE else h['off'] + d_off * OFF_RATE / n
            tgt = self._to_fk(h['tgt'], pel, yaw) + h['off']
            q, err = geom.ik(tgt, self.q_cmd[side], side, n_iter=60 if pt <= 1 else 20)
            self.q_cmd[side] = q
            if pt < MOVE_STEPS:
                a = (pt + 1) / MOVE_STEPS
                self.q_out[side] = Q_DEFAULT + a * (q - Q_DEFAULT)
            else:
                ig = self.integ[side]
                ig[:4] = np.clip(ig[:4] + 0.05 * (q[:4] - qm[:4]), -0.3, 0.3)
                self.q_out[side] = q + ig
        self._arm_out(raw)
        if DEBUG:
            rel = {}
            for side, c in SIDES:
                if side in self.hand:
                    qm = lo[0:7] if side == 'L' else lo[9:16]
                    rel[side] = (geom.fk(qm, side)[0] - self._to_fk(self.world[c], pel, yaw)).round(4).tolist()
            self.debug.append(dict(t=t, phase=self.phase, lit={s: self.hand[s]['lit'] for s in self.hand},
                                   k={s: self.hand[s]['k'] for s in self.hand}, rel=rel,
                                   tgt={s: self.hand[s]['tgt'].round(4).tolist() for s in self.hand},
                                   wr={s: self.hand[s]['wr'] for s in self.hand}))
        return raw
