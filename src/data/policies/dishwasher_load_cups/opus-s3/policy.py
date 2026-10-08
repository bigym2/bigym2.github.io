"""Scripted policy: load two mugs from the counter into the dishwasher upper rack.

Hand-written control: approximate G1 arm kinematics + IK (g1kin.py), colour
segmentation of the wrist cameras (vision.py), and a fixed choreography.
"""

import numpy as np

import g1kin as K
import vision

QNOM = np.array([-0.8, 0.15, 0.0, 0.6, 0.0, 0.0, 0.0])
DEBUG = False
LOCK = None
Q_PRE_L = np.array([-0.56, 0.23, 0.43, -1.05, -0.36, 1.61, 0.02])

P = dict(
    stand=(0.15, -0.60), stand2_dy=0.02, ys_l=0.14, ys_r=-0.14,
    zg=0.90,           # tool height for the handle grasp (world z)
    x0=0.22, xmax=0.37,
    ustar=40.0, vstar=40.0,  # handle-shadow start: column target, row trigger
    dx_blind=0.15,     # forward move from trigger to grasp
    hold_fj=-0.017,    # finger joint above this after closing = something in the hand
    va=23.66, vh=-42.5,  # wrist camera ground-plane model: distance = va / (row - vh)
    vstop=55.0, xgmax=0.53,
    mug_r=0.04, bar_r=0.075, grip_off=0.09,
    carry_l=(0.30, 0.24, 1.16), carry_r=(0.30, -0.24, 1.16), ylim=0.04,
    do_right=True,
    dw=(0.17, -0.52, 1.5708),   # stand in front of the open dishwasher, clear of the door
    place_h=0.62, place_pitch=0.3,
    place_x=0.55, place_y=0.10, place_zhi=1.02, place_zmin=0.76,
    gpre=0.3,          # gripper pre-shape before the final approach
    kpx=0.0018,        # servo gain m/px
)


def qnom(side):
    q = QNOM.copy()
    if side == 'r':
        q[[1, 2, 4, 6]] *= -1
    return q


def mirror(q):
    q = np.array(q, float).copy()
    q[[1, 2, 4, 6]] *= -1
    return q


def body_to_world(ld, p):
    x, y, yaw = ld[21], ld[22], ld[24]
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([x + c * p[0] - s * p[1], y + s * p[0] + c * p[1], p[2]])


class Arm:
    """Tool target in the body frame (pelvis x, y, yaw; world z)."""

    def __init__(self, side, q):
        self.s = side
        self.q = np.array(q, float)
        self.pb = None
        self.hd = 0.0
        self.pt = 0.0
        self.frozen = True

    def set(self, pb, hd=0.0, pt=0.0):
        self.pb = np.array(pb, float)
        self.hd, self.pt = hd, pt
        self.frozen = False

    def freeze(self):
        self.frozen = True

    def solve(self, ld, frame):
        if self.frozen or self.pb is None:
            return
        pw = body_to_world(frame, self.pb)
        h = frame[24] + self.hd
        d = np.array([np.cos(h) * np.cos(self.pt), np.sin(h) * np.cos(self.pt), -np.sin(self.pt)])
        pt = K.world_to_torso(ld, p=pw)
        dt = K.world_to_torso(ld, d=d)
        zt = K.world_to_torso(ld, d=[0, 0, 1])
        best = None
        for q0 in (self.q, qnom(self.s)):
            q, err = K.solve(self.s, pt, dt, zt, q0, qnom=qnom(self.s), wreg=0.02, lock=LOCK)
            M = K.arm_T(self.s, q)
            cost = err + 0.1 * np.linalg.norm(M[:3, 0] - dt) + 0.02 * np.linalg.norm(q - qnom(self.s))
            if best is None or cost < best[0] - 1e-3:
                best = (cost, q, err)
        _, self.q, self.err = best

    def tool_body(self, ld):
        """Current tool position in body frame (from measured joints)."""
        M = K.torso_world(ld) @ K.arm_T(self.s, K.arm_q(ld, self.s))
        p = M[:3, 3]
        x, y, yaw = ld[21], ld[22], ld[24]
        c, s = np.cos(yaw), np.sin(yaw)
        dx, dy = p[0] - x, p[1] - y
        return np.array([c * dx + s * dy, -s * dx + c * dy, p[2]])


class Policy:
    def reset(self, obs, tools):
        self.tools = tools
        self.base = np.asarray(tools.hold_action(), dtype=np.float64)
        self.base[0] = self.base[1] = self.base[3] = 0.0
        self.base[2] = 0.74
        self.base[4] = 0.0
        self.base[19] = self.base[20] = 0.0
        self.arms = {'l': Arm('l', Q_PRE_L), 'r': Arm('r', mirror(Q_PRE_L))}
        self.off = np.zeros(14)
        self.obs = obs
        self.frame = None
        self.face = 0.0
        self.holding_active = False
        self.nowalk = False
        self.k = 0
        self.log = []
        self.gen = self.script()

    # ---------------------------------------------------------------- helpers
    def action(self):
        ld = self.obs['low_dim_obs']
        if self.k % 5 == 0:
            fr = ld if self.frame is None else self.frame
            for A in self.arms.values():
                A.solve(ld, fr)
            if DEBUG:
                self.log.append(('dbg', self.obs['t'], ld[21:25].round(3), self.arms['l'].q.round(2),
                                 None if self.arms['l'].pb is None else self.arms['l'].pb.round(3),
                                 round(float(getattr(self.arms['l'], 'err', -1)), 3), self.base[:4].round(2)))
        self.k += 1
        qt = np.concatenate([self.arms['l'].q, self.arms['r'].q])
        qa = np.concatenate([ld[3:10], ld[12:19]])
        self.off = np.clip(self.off + 0.1 * (qt - qa), -0.3, 0.3)
        a = self.base.copy()
        a[5:19] = qt + self.off
        return a

    def steps(self, n, walk=None):
        for _ in range(n):
            if walk is not None:
                if walk(self.obs['low_dim_obs']):
                    break
            elif self.frame is not None:
                self.hold_base(self.obs['low_dim_obs'])
            yield self.action()

    def move(self, side, goal, speed=0.1, settle=10, hd=None):
        """Move one tool target in a straight line at a limited speed (m/s)."""
        A = self.arms[side]
        goal = np.array(goal, float)
        if A.pb is None:
            A.set(goal)
        start = A.pb.copy()
        h0 = A.hd
        h1 = h0 if hd is None else hd
        n = max(1, int(np.ceil(np.linalg.norm(goal - start) / (speed * 0.02))))
        for i in range(1, n + 1):
            A.pb = start + (goal - start) * i / n
            A.hd = h0 + (h1 - h0) * i / n
            A.frozen = False
            yield self.action_with_hold()
        yield from self.steps(settle)

    def action_with_hold(self):
        if self.frame is not None:
            self.hold_base(self.obs['low_dim_obs'])
        return self.action()

    def goto(self, x, y, yaw, n=400):
        """Walk to a pose with the arm targets following the body, then fix the task frame there."""
        self.frame = None
        yield from self.steps(n, self.walker(x, y, yaw))
        self.stop_base()
        fr = np.zeros(56)
        fr[21:25] = self.obs['low_dim_obs'][21:25]
        self.log.append(('goto', (x, y, yaw), fr[21:25].round(3), self.obs['t']))
        self.frame = fr
        self.holding_active = False
        yield from self.steps(20)

    def hold_base(self, ld):
        """Keep the pelvis near the task frame; correct only when drift is large."""
        fr = self.frame
        if self.nowalk:
            self.stop_base()
            return
        dx, dy = fr[21] - ld[21], fr[22] - ld[22]
        c, s = np.cos(ld[24]), np.sin(ld[24])
        bx, by = c * dx + s * dy, -s * dx + c * dy
        ey = (fr[24] - ld[24] + np.pi) % (2 * np.pi) - np.pi
        d = np.hypot(bx, by)
        if not self.holding_active and (d > 0.08 or abs(ey) > 0.10):
            self.holding_active = True
        if self.holding_active and d < 0.03 and abs(ey) < 0.03:
            self.holding_active = False
        if not self.holding_active:
            self.stop_base()
            return
        v = np.array([bx, by]) * 1.5
        sp = np.linalg.norm(v)
        if d < 0.015:
            v[:] = 0
        elif sp < 0.07:
            v *= 0.07 / max(sp, 1e-6)
        elif sp > 0.12:
            v *= 0.12 / sp
        self.base[0], self.base[1] = v
        self.base[3] = np.clip(1.2 * ey, -0.3, 0.3) if abs(ey) > 0.02 else 0.0

    def walker(self, tx, ty, tyaw, vmax=0.2, tol=0.03):
        def w(ld):
            x, y, yaw = ld[21], ld[22], ld[24]
            dx, dy = tx - x, ty - y
            c, s = np.cos(yaw), np.sin(yaw)
            bx, by = c * dx + s * dy, -s * dx + c * dy
            ey = (tyaw - yaw + np.pi) % (2 * np.pi) - np.pi
            v = np.array([bx, by]) * 1.5
            sp = np.linalg.norm(v)
            if sp > vmax:
                v *= vmax / sp
            close = np.hypot(bx, by) < tol
            if close:
                v[:] = 0
            elif sp < 0.07:
                v *= 0.07 / max(sp, 1e-6)
            self.base[0], self.base[1] = v
            self.base[3] = np.clip(1.5 * ey, -0.5, 0.5) if abs(ey) > 0.03 else 0.0
            if close and abs(ey) < 0.04:
                self.base[0] = self.base[1] = self.base[3] = 0.0
                return True
            return False
        return w

    def stop_base(self):
        self.base[0] = self.base[1] = self.base[3] = 0.0

    # ---------------------------------------------------------------- vision
    def foot(self, side, pick):
        cam = 'left_wrist' if side == 'l' else 'right_wrist'
        im = self.tools.image(cam)
        f = vision.mug_obs(im, pick)
        if f is None or f['us'] is None:
            return None
        return (f['us'], f['vs'])

    # ---------------------------------------------------------------- script
    def holding(self, side):
        ld = self.obs['low_dim_obs']
        fj = ld[10] if side == 'l' else ld[19]
        return fj > P['hold_fj']

    def center_base(self, side, cam, pick, u0, tol=6, search_vy=0.0):
        """Side-step (base vy) until the tracked mug is centred in the wrist camera."""
        good = 0
        miss = 0
        self.frame = None
        for it in range(40):
            f = vision.mug_obs(self.tools.image(cam), pick, near=self.track)
            if f is None:
                miss += 1
                if miss >= 2:
                    self.track = None
                self.stop_base()
                if search_vy != 0.0 and miss >= 2:
                    self.base[1] = search_vy
                self.log.append(('search', side, it, self.obs['low_dim_obs'][21:25].round(3)))
                yield from self.steps(10)
                continue
            miss = 0
            self.track = f['cx']
            err = f['cx'] - u0
            self.log.append(('center', side, it, round(err, 1), self.obs['low_dim_obs'][21:25].round(3)))
            if abs(err) < tol:
                self.stop_base()
                good += 1
                if good >= 2:
                    break
                yield from self.steps(15)
                continue
            good = 0
            vy = -np.clip(0.004 * err, -0.15, 0.15)
            vy = np.sign(vy) * max(abs(vy), 0.07)
            ld = self.obs['low_dim_obs']
            ey = (self.face - ld[24] + np.pi) % (2 * np.pi) - np.pi
            self.base[0] = 0.0
            self.base[1] = vy
            self.base[3] = np.clip(1.5 * ey, -0.3, 0.3) if abs(ey) > 0.03 else 0.0
            yield from self.steps(10)
        self.stop_base()
        yield from self.steps(25)
        fr = np.zeros(56)
        fr[21:25] = self.obs['low_dim_obs'][21:25]
        self.frame = fr
        self.holding_active = False

    def grasp(self, side, pick, ys):
        """Visual approach to the mug handle and close; returns via self.result."""
        A = self.arms[side]
        gi = 19 if side == 'l' else 20
        self.base[gi] = 0.0
        cam = 'left_wrist' if side == 'l' else 'right_wrist'
        u0 = P['ustar'] if side == 'l' else 84 - P['ustar']
        A.set((P['x0'], ys, P['zg'] + 0.07))
        yield from self.steps(20)
        A.set((P['x0'], ys, P['zg']))
        yield from self.steps(20)
        # side-step until the target mug is centred in this hand's wrist camera
        self.track = None
        if side == 'r':
            yield from self.center_base(side, cam, pick, u0, search_vy=-0.08)
        track = self.track
        mode = 'front'
        extra = 0.0
        for attempt in range(3):
            est = []
            sin_psi = {'left': 1.0, 'right': -1.0}.get(mode, 0.0)
            for it in range(50):
                im = self.tools.image(cam)
                f = vision.mug_obs(im, pick, near=track)
                if f is not None:
                    track = f['cx']
                self.log.append(('servo', side, attempt, it, None if f is None else
                                 (f['uc'], f['vb'], f['w'], f['us']), A.pb.copy()))
                ok_lat = False
                if f is not None and f['touch']:
                    # mug cut by the image border: shift sideways toward it
                    A.pb[1] += 0.008 if f['uc'] < 42 else -0.008
                    A.pb[1] = float(np.clip(A.pb[1], ys - P['ylim'], ys + P['ylim']))
                    ok_lat = True
                elif f is not None and f['w'] >= 8:
                    if mode == 'front':
                        if f['us'] is not None:
                            sin_psi = float(np.clip((f['uc'] - f['us']) / (0.5 * f['w']), -0.4, 0.4))
                        ub = f['uc'] - sin_psi * 0.94 * f['w']
                    else:
                        e = vision.side_edges(im, pick, near=track)
                        ub = e[0] + 1.5 if mode == 'left' else e[1] - 1.5
                    err = ub - u0
                    ynew = A.pb[1] + np.clip(-P['kpx'] * err, -0.008, 0.008)
                    ynew = float(np.clip(ynew, ys - P['ylim'], ys + P['ylim']))
                    at_lim = abs(ynew - A.pb[1]) < 1e-4 and abs(err) >= 4
                    A.pb[1] = ynew
                    ok_lat = abs(err) < 4 or at_lim
                    if 22 <= f['vb'] <= 78:
                        est.append(A.pb[0] + P['va'] / (f['vb'] - P['vh']))
                    if f['vb'] >= P['vstop'] and len(est) >= 2 and ok_lat:
                        break
                if A.pb[0] >= P['xmax']:
                    break
                if ok_lat or f is None:
                    A.pb[0] += 0.015
                yield from self.steps(9)
            self.base[gi] = P['gpre']
            x0 = A.pb[0]
            if est:
                xf = float(np.median(est[-3:]))
                cpsi = np.sqrt(1 - sin_psi ** 2)
                xg = xf + P['mug_r'] - P['bar_r'] * cpsi - P['grip_off'] + extra
            else:
                xg = x0 + P['dx_blind'] + extra
            xg = float(np.clip(xg, x0, P['xgmax']))
            self.log.append(('xg', side, attempt, round(xg, 3), round(sin_psi, 2), len(est)))
            n = max(1, int(round((xg - x0) / 0.01)))
            for i in range(1, n + 1):
                A.pb[0] = x0 + (xg - x0) * i / n
                yield from self.steps(6)
            yield from self.steps(15)
            self.base[gi] = 1.0
            yield from self.steps(35)
            ok = self.holding(side)
            self.log.append(('close', side, attempt, A.pb.copy(), ok))
            if ok:
                yield from self.move(side, A.pb + (0, 0, 0.06), speed=0.05)
                if self.holding(side):
                    self.result = True
                    return
            # retry: open, back off, go deeper next time
            self.base[gi] = 0.0
            yield from self.steps(15)
            A.pb[2] = P['zg']
            A.pb[0] = x0 - 0.06
            yield from self.steps(40)
            extra += 0.02
        self.result = False

    def script(self):
        yield from self.steps(10)
        yield from self.goto(*P['stand'], 0.0)
        yield from self.grasp('l', 'left', P['ys_l'])
        self.log.append(('grasp_l', self.result, self.obs['t']))
        yield from self.move('l', P['carry_l'], speed=0.15)
        self.log.append(('carry_l', self.holding('l'), self.obs['t']))
        if P['do_right']:
            # the remaining mug is to the right of the first one: put the right hand
            # just right of where the left hand took the first mug
            y1 = self.frame[22] + P['ys_l']
            yield from self.goto(self.frame[21], y1 + P['stand2_dy'], 0.0)
            yield from self.grasp('r', 'big', P['ys_r'])
            self.log.append(('grasp_r', self.result, self.obs['t']))
            yield from self.move('r', P['carry_r'], speed=0.15)
        yield from self.goto(*P['dw'], n=300)
        self.log.append(('turned', self.holding('l'), self.holding('r'), self.obs['t']))
        # squat and lean over the rack; re-anchor the task frame where the pelvis settles
        self.frame = None
        self.base[2] = P['place_h']
        self.base[4] = P['place_pitch']
        yield from self.steps(60)
        fr = np.zeros(56)
        fr[21:25] = self.obs['low_dim_obs'][21:25]
        self.frame = fr
        self.nowalk = True   # never walk while squatting
        self.log.append(('squat', fr[21:25].round(3), self.obs['t']))
        for side in ('l', 'r') if P['do_right'] else ('l',):
            yield from self.place(side)
        while True:
            yield from self.steps(50)

    def place(self, side):
        A = self.arms[side]
        gi = 19 if side == 'l' else 20
        s = 1 if side == 'l' else -1
        yield from self.move(side, (P['place_x'], s * P['place_y'], P['place_zhi']), speed=0.08)
        z = P['place_zhi']
        while z > P['place_zmin']:
            z -= 0.01
            yield from self.move(side, (P['place_x'], s * P['place_y'], z), speed=0.04, settle=3)
            tb = A.tool_body(self.obs['low_dim_obs'])
            if tb[2] - z > 0.015:
                break
        self.log.append(('place', side, round(z, 3), self.obs['t']))
        self.base[gi] = 0.0
        yield from self.steps(25)
        yield from self.move(side, A.pb + (0, 0, 0.10), speed=0.06)
        yield from self.move(side, A.pb + (-0.10, 0, 0), speed=0.08)

    def act(self, obs, tools):
        self.obs = obs
        return next(self.gen)
