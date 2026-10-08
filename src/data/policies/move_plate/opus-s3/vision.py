"""Image measurements used by the policy."""
import numpy as np
import cv2


def hsv(im):
    return cv2.cvtColor(im, cv2.COLOR_RGB2HSV)


def counter_mask(im):
    h = hsv(im)
    return (h[..., 1] < 40) & (h[..., 2] > 150)


def wood_mask(im):
    h = hsv(im)
    return (h[..., 0] >= 5) & (h[..., 0] <= 25) & (h[..., 1] > 70) & (h[..., 2] > 60)


def rack_blobs(im, min_area=15):
    """Connected wood regions (racks) in the head image: list of dicts, largest first."""
    m = wood_mask(im).astype(np.uint8)
    m = cv2.dilate(m, np.ones((3, 3), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    out = []
    for i in range(1, n):
        if st[i, 4] < min_area:
            continue
        ys, xs = np.where((lab == i) & wood_mask(im))
        out.append(dict(u0=xs.min(), u1=xs.max(), v0=ys.min(), v1=ys.max(), uc=xs.mean(), vc=ys.mean(),
                        n=len(xs), touches=(xs.min() == 0 or xs.max() == im.shape[1] - 1)))
    out.sort(key=lambda b: -b['n'])
    return out


def rack_features(im, which):
    """Front bar of the left- or right-most rack in the head image.

    Returns dict(bar=row, ul=left end, ur=right end, um=midpoint, touches) or None.
    """
    blobs = [b for b in rack_blobs(im) if b['n'] > 50]
    if not blobs:
        return None
    b = min(blobs, key=lambda b: b['uc']) if which == 'left' else max(blobs, key=lambda b: b['uc'])
    m = wood_mask(im)
    sub = np.zeros_like(m)
    sub[b['v0']:b['v1'] + 1, b['u0']:b['u1'] + 1] = m[b['v0']:b['v1'] + 1, b['u0']:b['u1'] + 1]
    rows = sub.sum(1)
    thr = 0.5 * rows.max()
    cand = np.where(rows >= thr)[0]
    bar = int(cand.max())
    band = sub[max(0, bar - 1):bar + 2]
    xs = np.where(band.any(0))[0]
    # weighted bar row (sub-pixel) from the rows around the bar
    r = np.arange(max(0, bar - 2), min(m.shape[0], bar + 3))
    w = rows[r].astype(float)
    barf = float((r * w).sum() / max(w.sum(), 1e-6))
    return dict(bar=barf, ul=float(xs.min()), ur=float(xs.max()), um=0.5 * float(xs.min() + xs.max()),
                touches=bool(xs.min() == 0 or xs.max() == m.shape[1] - 1),
                touch_r=bool(xs.max() == m.shape[1] - 1), blob=b)


def dark_mask(im):
    h = hsv(im)
    return h[..., 2] < 110


def peg_phase(im, f, periods=np.arange(4.0, 7.01, 0.05)):
    """Sub-pixel phase of the peg comb of a rack in the head image.

    Uses dark pixels in the band just above the front bar, within the rack blob.
    Returns (period, phase, strength) with pegs at phase + k * period, or None.
    """
    b = f['blob']
    bar = int(round(f['bar']))
    r0, r1 = max(0, bar - 7), max(1, bar - 1)
    u0, u1 = int(b['u0']), int(b['u1']) + 1
    band = dark_mask(im)[r0:r1, u0:u1].astype(float)
    prof = band.sum(0)
    if prof.sum() < 5:
        return None
    prof = prof - prof.mean()
    u = np.arange(u0, u1, dtype=float)
    best = None
    for P in periods:
        z = (prof * np.exp(-2j * np.pi * u / P)).sum()
        if best is None or abs(z) > best[2]:
            best = (float(P), float((np.angle(z) * P / (2 * np.pi)) % P), float(abs(z)))
    return best


def start_features(im):
    """Rack features in the head image at the initial pose (both racks in view).

    Left rack: right end of its front bar; right rack: left end of its front bar.
    """
    fl = rack_features(im, 'left')
    fr = rack_features(im, 'right')
    if fl is None or fr is None or fl['blob'] is fr['blob']:
        return None
    return dict(urL=fl['ur'], barL=fl['bar'], ulR=fr['ul'], barR=fr['bar'])


def white_mask(im):
    h = hsv(im)
    return (h[..., 2] > 215) & (h[..., 1] < 25)


def plate_column(im, blob):
    """Median column of plate (white) pixels over a rack blob in the head image."""
    m = white_mask(im)
    u0, u1 = int(blob['u0']), int(blob['u1'])
    v1 = int(blob['v1'])
    sub = m[:v1 + 1, u0:u1 + 1]
    ys, xs = np.where(sub)
    if len(xs) < 5:
        return None
    return float(np.median(xs) + u0)


def wrist_plate_column(im, rows=(0, 42), cols=(12, 72)):
    """Median column of the plate strip in the wrist image (plate seen edge-on)."""
    m = white_mask(im)[rows[0]:rows[1], cols[0]:cols[1]]
    ys, xs = np.where(m)
    if len(xs) < 8:
        return None
    return float(np.median(xs) + cols[0])


def peg_comb(im, excl=(36, 54)):
    """Front-row peg columns in a wrist image looking at a rack.

    Returns (bar_row, period, phase, cols) or None. Pegs are at phase + k * period.
    """
    m = wood_mask(im)
    m[:, excl[0]:excl[1]] = False
    rows = m.sum(1)
    bar = int(np.argmax(rows))
    if rows[bar] < 8:
        return None
    r0, r1 = max(0, bar - 7), max(1, bar - 1)
    band = m[r0:r1]
    prof = band.sum(0).astype(float)
    cols = []
    for u in range(1, len(prof) - 1):
        if prof[u] >= 2 and prof[u] >= prof[u - 1] and prof[u] > prof[u + 1]:
            # centroid of the local run
            lo, hi = u, u
            while lo > 0 and prof[lo - 1] > 0:
                lo -= 1
            while hi < len(prof) - 1 and prof[hi + 1] > 0:
                hi += 1
            w = prof[lo:hi + 1]
            cols.append(float((np.arange(lo, hi + 1) * w).sum() / w.sum()))
    cols = sorted(set(round(c, 2) for c in cols))
    if len(cols) < 3:
        return None
    d = np.diff(cols)
    period = float(np.median(d[(d > 4) & (d < 20)])) if np.any((d > 4) & (d < 20)) else None
    if period is None:
        return None
    # phase by circular mean
    ang = 2 * np.pi * np.array(cols) / period
    phase = float(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()) * period / (2 * np.pi)) % period
    return bar, period, phase, cols


def gap_offset(comb, col):
    """Signed pixel offset of `col` from the nearest gap centre of the peg comb."""
    bar, period, phase, cols = comb
    g = phase + period / 2
    k = np.round((col - g) / period)
    return float(col - (g + k * period))


def counter_edge_row(im, cols=(30, 54)):
    """Lowest row of the counter top (grey) in the central columns of the head image."""
    m = counter_mask(im)[:, cols[0]:cols[1]]
    frac = m.mean(axis=1)
    rows = np.where(frac > 0.5)[0]
    if len(rows) == 0:
        return None
    # contiguous run from top
    r = rows[0]
    while r + 1 < m.shape[0] and frac[r + 1] > 0.5:
        r += 1
    return int(r)
