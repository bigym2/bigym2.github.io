"""Colour segmentation of the target spheres and their floor shadows."""

import numpy as np
import cv2


def sphere_mask(img, color):
    im = img.astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    if color == 'red':
        return (r > 25) & (r > g + 20) & (r > b + 20)
    return (g > 25) & (g > r + 20) & (g > b + 20)


def circle_fit(xs, ys):
    A = np.stack([xs, ys, np.ones_like(xs)], 1)
    bb = xs * xs + ys * ys
    sol, *_ = np.linalg.lstsq(A, bb, rcond=None)
    cx, cy = sol[0] / 2, sol[1] / 2
    r = np.sqrt(max(sol[2] + cx * cx + cy * cy, 0.0))
    return cx, cy, r


def find_sphere(img, color):
    """Largest blob of the colour: dict(u, v, r, area, lit, border) or None."""
    m = sphere_mask(img, color).astype(np.uint8)
    n, lab, stats, cents = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n <= 1:
        return None
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    area = int(stats[k, cv2.CC_STAT_AREA])
    if area < 3:
        return None
    blob = (lab == k).astype(np.uint8)
    ch = 0 if color == 'red' else 1
    vals = img[..., ch][blob > 0]
    lit = float(np.percentile(vals, 90)) >= 235
    # boundary pixels not on the image border and next to background (not to an
    # occluding robot part)
    er = cv2.erode(blob, np.ones((3, 3), np.uint8))
    edge = (blob > 0) & (er == 0)
    H, W = blob.shape
    ys, xs = np.nonzero(edge)
    keep = (xs > 0) & (xs < W - 1) & (ys > 0) & (ys < H - 1)
    border = bool((~keep).any())
    im = img.astype(np.int16)
    bg = ((im[..., 2] > im[..., 0] + 15) & (im[..., 2] >= im[..., 1])).astype(np.uint8)
    near_bg = cv2.dilate(bg, np.ones((3, 3), np.uint8)) > 0
    keep2 = keep & near_bg[ys, xs]
    if keep2.sum() >= 8:
        keep = keep2
    xs, ys = xs[keep] + 0.5, ys[keep] + 0.5
    if len(xs) >= 6:
        u, v, r = circle_fit(xs.astype(float), ys.astype(float))
        r += 0.5
    else:
        u, v = cents[k][0] + 0.5, cents[k][1] + 0.5
        r = np.sqrt(area / np.pi)
    r_area = np.sqrt(area / np.pi)
    if not border and (r > 1.3 * r_area or r < 0.8 * r_area):
        u, v = cents[k][0] + 0.5, cents[k][1] + 0.5
        r = r_area
    return dict(u=float(u), v=float(v), r=float(r), area=area, lit=lit, border=border,
                cu=float(cents[k][0] + 0.5), cv=float(cents[k][1] + 0.5))


def shadow_mask(img):
    im = img.astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    return (b < 126) & (b > r + 30) & (g < 100) & (g > r + 15)


def find_shadows(img, min_area=8, v_min=28):
    """Dark blobs on the near floor: list of dict(u, v, area, w, h)."""
    m = shadow_mask(img).astype(np.uint8)
    m[:v_min] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab, stats, cents = cv2.connectedComponentsWithStats(m, connectivity=4)
    out = []
    for k in range(1, n):
        a = int(stats[k, cv2.CC_STAT_AREA])
        if a < min_area:
            continue
        out.append(dict(u=float(cents[k][0] + 0.5), v=float(cents[k][1] + 0.5), area=a,
                        w=int(stats[k, cv2.CC_STAT_WIDTH]), h=int(stats[k, cv2.CC_STAT_HEIGHT])))
    return out
