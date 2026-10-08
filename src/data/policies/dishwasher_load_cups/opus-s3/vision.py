"""Colour segmentation helpers for the mug task (hand-written thresholds)."""
import numpy as np
import cv2


def mug_mask(im):
    im = im.astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    v = im.max(-1)
    grey = (np.abs(r - b) < 14) & (np.abs(r - g) < 10) & (v > 70) & (v < 246)
    m = grey.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return m


def stick_mask(im):
    im = im.astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    v = im.max(-1)
    return ((r - b > 22) & (r - b < 90) & (v > 80) & (v < 180) & (r >= g)).astype(np.uint8)


def blobs(mask, min_area=20):
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if a >= min_area:
            out.append(dict(label=i, x0=int(x), y0=int(y), x1=int(x + w - 1), y1=int(y + h - 1), area=int(a),
                            cx=float(cent[i][0]), cy=float(cent[i][1]), mask=(lab == i)))
    return out


def sticks(im, min_area=3):
    """Handle-shadow blobs: returns list with endpoints."""
    out = []
    for s in blobs(stick_mask(im), min_area):
        if s['area'] > 150:
            continue
        ys, xs = np.where(s['mask'])
        s['pts'] = np.stack([xs, ys], 1).astype(float)
        out.append(s)
    return out


def mug_blobs_all(im):
    out = []
    for b in blobs(mug_mask(im), 60):
        w = b['x1'] - b['x0'] + 1
        h = b['y1'] - b['y0'] + 1
        if b['y1'] >= 80 or w > 45 or b['area'] > 2500:
            continue
        if h < 0.8 * w and b['y0'] > 0:
            continue
        b['edge'] = b['x0'] == 0 or b['x1'] == 83
        out.append(b)
    return out


def mug_blobs(im):
    out = []
    for b in blobs(mug_mask(im), 60):
        w = b['x1'] - b['x0'] + 1
        h = b['y1'] - b['y0'] + 1
        if b['y1'] >= 80:
            continue          # cabinet front / things at the bottom edge
        if w > 45 or b['area'] > 2500:
            continue
        if h < 0.8 * w and b['y0'] > 0:
            continue
        b['edge'] = b['x0'] == 0 or b['x1'] == 83
        out.append(b)
    full = [b for b in out if not b['edge']]
    return full if full else out


def handle_foot(im, pick='left'):
    """Image point of the far end of the handle shadow of the chosen mug (u, v) or None."""
    mugs = mug_blobs(im)
    if not mugs:
        return None
    if pick == 'left':
        mugs.sort(key=lambda b: b['cx'])
    elif pick == 'right':
        mugs.sort(key=lambda b: -b['cx'])
    else:
        mugs.sort(key=lambda b: abs(b['cx'] - 42))
    ss = sticks(im, 3)
    for mb in mugs:
        grown = cv2.dilate(mb['mask'].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        mk = mb['mask']
        rows = np.where(mk.any(1))[0]
        y1 = rows[-1]
        hb = max(2, int(0.2 * (y1 - rows[0] + 1)))
        cols = np.where(mk[y1 - hb + 1:y1 + 1].any(0))[0]
        c = np.array([0.5 * (cols[0] + cols[-1]), float(y1)])
        best = None
        for s in ss:
            if not (grown & s['mask']).any():
                continue
            if best is None or s['area'] > best['area']:
                best = s
        if best is None:
            continue
        d = np.linalg.norm(best['pts'] - c, axis=1)
        p = best['pts'][int(np.argmax(d))]
        return (float(p[0]), float(p[1]), c[0], c[1])
    return None


def mug_obs(im, pick='left', near=None):
    """Body bottom-centre (uc, vb), body width w, handle-shadow start column us (or None).

    near: image column of the mug tracked so far; the blob closest to it is used.
    """
    mugs = mug_blobs_all(im) if (near is not None or pick == 'big') else mug_blobs(im)
    if not mugs:
        return None
    if near is not None:
        mb = min(mugs, key=lambda b: abs(b['cx'] - near))
        if abs(mb['cx'] - near) > 25:
            return None
    elif pick == 'big':
        mb = max(mugs, key=lambda b: b['area'])
    elif pick == 'left':
        mb = min(mugs, key=lambda b: b['cx'])
    elif pick == 'right':
        mb = max(mugs, key=lambda b: b['cx'])
    else:
        mb = min(mugs, key=lambda b: abs(b['cx'] - 42))
    mk = mb['mask']
    rows = np.where(mk.any(1))[0]
    y0, y1 = rows[0], rows[-1]
    hb = max(2, int(0.15 * (y1 - y0 + 1)))
    cols = np.where(mk[y1 - hb + 1:y1 + 1].any(0))[0]
    uc = 0.5 * (cols[0] + cols[-1])
    w = float(cols[-1] - cols[0] + 1)
    # body bottom row at the centre column
    cc = int(round(uc))
    colr = np.where(mk[:, cc])[0]
    vb = float(colr[-1]) if len(colr) else float(y1)
    grown = cv2.dilate(mk.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    best = None
    for s in sticks(im, 3):
        if not (grown & s['mask']).any():
            continue
        if best is None or s['area'] > best['area']:
            best = s
    us = vs = None
    if best is not None:
        d = np.abs(best['pts'][:, 0] - uc) + np.abs(best['pts'][:, 1] - vb)
        near = best['pts'][d <= d.min() + 1.5]
        us, vs = float(near[:, 0].mean()), float(near[:, 1].mean())
        if abs(us - uc) > 1.3 * max(w, 8) or abs(vs - vb) > 6:
            us = vs = None
    touch = mb['x0'] == 0 or mb['x1'] == 83
    # handle protruding past the body outline (sideways handle)
    protL = protR = 0.0
    edgeL, edgeR = float(cols[0]), float(cols[-1])
    if y0 > 0 and y1 - y0 >= 10:
        top = [np.where(mk[r])[0] for r in range(y0 + 1, y0 + 4)]
        top = [c for c in top if len(c)]
        if top:
            xl = max(c[0] for c in top)
            xr = min(c[-1] for c in top)
            for r in range(y0 + 4, y1 + 1):
                c = np.where(mk[r])[0]
                if len(c):
                    if xl - c[0] > protL:
                        protL, edgeL = float(xl - c[0]), float(c[0])
                    if c[-1] - xr > protR:
                        protR, edgeR = float(c[-1] - xr), float(c[-1])
    return dict(uc=uc, vb=vb, w=w, us=us, vs=vs, y0=int(y0), touch=touch, cx=float(mb['cx']),
                protL=float(protL), protR=float(protR), edgeL=edgeL, edgeR=edgeR)


def side_edges(im, pick, near=None):
    """Leftmost / rightmost silhouette column of the chosen mug above its bottom rows."""
    mugs = mug_blobs_all(im) if near is not None else mug_blobs(im)
    if not mugs:
        return None
    if near is not None:
        mb = min(mugs, key=lambda b: abs(b['cx'] - near))
    elif pick == 'left':
        mb = min(mugs, key=lambda b: b['cx'])
    elif pick == 'right':
        mb = max(mugs, key=lambda b: b['cx'])
    else:
        mb = min(mugs, key=lambda b: abs(b['cx'] - 42))
    mk = mb['mask']
    rows = np.where(mk.any(1))[0]
    y0, y1 = rows[0], rows[-1]
    sub = mk[y0:max(y0 + 1, y1 - int(0.12 * (y1 - y0)))]
    cols = np.where(sub.any(0))[0]
    return float(cols[0]), float(cols[-1])


def handle_bar(f):
    """(column of the handle's outer bar, sin of handle direction; + = toward image left)."""
    w = f['w']
    if f['protL'] >= 3 and f['protL'] >= f['protR'] + 2:
        return f['edgeL'] + 1.5, float(np.clip((0.5 * w + f['protL']) / (0.94 * w), 0.4, 1.0))
    if f['protR'] >= 3 and f['protR'] >= f['protL'] + 2:
        return f['edgeR'] - 1.5, -float(np.clip((0.5 * w + f['protR']) / (0.94 * w), 0.4, 1.0))
    s = 0.0
    if f['us'] is not None:
        s = float(np.clip((f['uc'] - f['us']) / (0.5 * w), -0.4, 0.4))
    return f['uc'] - s * 0.94 * w, s


def mug_handle(im, pick='left', ratio=1.6):
    """Mug body + handle estimate.

    Returns dict(uc, vb, w, uh, side, psi) where uh is the image column of the
    handle's outer bar and psi the handle yaw relative to the camera (+ = handle
    toward image right).
    """
    mugs = mug_blobs(im)
    if not mugs:
        return None
    if pick == 'left':
        mb = min(mugs, key=lambda b: b['cx'])
    elif pick == 'right':
        mb = max(mugs, key=lambda b: b['cx'])
    else:
        mb = min(mugs, key=lambda b: abs(b['cx'] - 42))
    mk = mb['mask'].copy()
    # fill enclosed highlights (handle shine) : holes inside the blob
    filled = mk.astype(np.uint8).copy()
    h, w_ = filled.shape
    ff = np.zeros((h + 2, w_ + 2), np.uint8)
    inv = (1 - filled).astype(np.uint8)
    cv2.floodFill(inv, ff, (0, h - 1), 0)
    holes = inv > 0
    full = mk | holes
    rows = np.where(full.any(1))[0]
    y0, y1 = int(rows[0]), int(rows[-1])
    H = y1 - y0 + 1
    L = np.array([np.where(full[r])[0][0] if full[r].any() else -1 for r in range(84)], float)
    R = np.array([np.where(full[r])[0][-1] if full[r].any() else -1 for r in range(84)], float)
    nb = max(2, int(0.12 * H))
    bot = list(range(y1 - nb + 1, y1 + 1))
    top = [r for r in range(y0, y0 + nb) if y0 > 0]
    fitrows = bot + top
    fr = np.array(fitrows, float)
    if len(top) >= 2:
        pl = np.polyfit(fr, L[fitrows], 1); pr = np.polyfit(fr, R[fitrows], 1)
    else:
        pl = np.array([0.0, np.median(L[bot])]); pr = np.array([0.0, np.median(R[bot])])
    mid = [r for r in range(y0 + nb, y1 - nb + 1)]
    uc = 0.5 * (np.median(L[bot]) + np.median(R[bot]))
    wb = float(np.median(R[bot]) - np.median(L[bot]) + 1)
    cc = int(round(uc))
    colr = np.where(mk[:, cc])[0]
    vb = float(colr[-1]) if len(colr) else float(y1)
    protL = protR = 0.0
    rl = rr = None
    for r in mid:
        dl = np.polyval(pl, r) - L[r]
        dr = R[r] - np.polyval(pr, r)
        if dl > protL:
            protL, rl = dl, r
        if dr > protR:
            protR, rr = dr, r
    touchL = mb['x0'] == 0
    touchR = mb['x1'] == 83
    side = 0
    if protL > 2.5 and protL >= protR and not touchL:
        side = -1
        uh = L[rl] + 1.0
    elif protR > 2.5 and not touchR:
        side = 1
        uh = R[rr] - 1.0
    else:
        hm = holes.copy()
        hm[:y0 + nb] = False
        hm[y1 - nb + 1:] = False
        ys, xs = np.where(hm)
        uh = float(xs.mean()) if len(xs) >= 2 else uc
    s = (uh - uc) / (ratio * wb / 2)
    psi = float(np.arcsin(np.clip(s, -1, 1)))
    return dict(uc=float(uc), vb=vb, w=wb, uh=float(uh), side=side, psi=psi,
                protL=float(protL), protR=float(protR), y0=y0, y1=y1,
                touch=bool(touchL or touchR))


def mug_features(im, pick='left'):
    """Find mug blobs; return features of the chosen one (leftmost/rightmost/center)."""
    m = mug_mask(im)
    cands = []
    for b in blobs(m, 40):
        w = b['x1'] - b['x0'] + 1
        if b['y1'] >= 82 and w > 50:
            continue
        cands.append(b)
    if not cands:
        return None
    if pick == 'left':
        b = min(cands, key=lambda b: b['cx'])
    elif pick == 'right':
        b = max(cands, key=lambda b: b['cx'])
    else:
        b = min(cands, key=lambda b: abs(b['cx'] - 42) + abs(b['cy'] - 42))
    mk = b['mask']
    rows = np.where(mk.any(1))[0]
    y0, y1 = rows[0], rows[-1]
    hb = max(2, int(0.2 * (y1 - y0 + 1)))
    lo = mk[y1 - hb + 1:y1 + 1]
    cols = np.where(lo.any(0))[0]
    xl, xr = cols[0], cols[-1]
    f = dict(x0=b['x0'], x1=b['x1'], y0=int(y0), y1=int(y1), xl=int(xl), xr=int(xr),
             uc=0.5 * (xl + xr), w=float(xr - xl + 1), area=b['area'], cx=b['cx'], cy=b['cy'])
    sm = stick_mask(im)
    best = None
    for s in blobs(sm, 2):
        if s['y0'] >= y1 - 6 and s['y0'] <= y1 + 4 and s['x0'] >= b['x0'] - 4 and s['x1'] <= b['x1'] + 4 and s['area'] < 80:
            if best is None or s['area'] > best['area']:
                best = s
    if best is not None:
        top = best['mask'][best['y0']]
        f['uh'] = float(np.mean(np.where(top)[0]))
        f['vh'] = float(best['y0'])
    return f
