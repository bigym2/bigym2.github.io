import numpy as np
from scipy import ndimage


def find_handles(img, vmin=55, vmax=110, min_area=12):
    a = img.astype(np.int16)
    v = a.max(axis=2)
    sp = v - a.min(axis=2)
    m = (sp < 14) & (v > vmin) & (v < vmax)
    lab, n = ndimage.label(m)
    out = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if len(xs) < min_area:
            continue
        cu, cv = xs.mean(), ys.mean()
        X = np.stack([xs - cu, ys - cv]).astype(float)
        ev, evec = np.linalg.eigh(X @ X.T / len(xs))
        d = evec[:, 1]
        if d[0] < 0:
            d = -d
        proj = (xs - cu) * d[0] + (ys - cv) * d[1]
        length = proj.max() - proj.min() + 1
        width = len(xs) / length
        angle = float(np.degrees(np.arctan2(d[1], d[0])))
        if width < 1.5 or length < 6:
            continue
        # endpoints: mean of pixels within 1.5px of each extreme along axis
        e1 = np.array([xs[proj <= proj.min() + 1.5].mean(), ys[proj <= proj.min() + 1.5].mean()])
        e2 = np.array([xs[proj >= proj.max() - 1.5].mean(), ys[proj >= proj.max() - 1.5].mean()])
        trunc = xs.min() <= 0 or xs.max() >= img.shape[1] - 1 or ys.min() <= 0 or ys.max() >= img.shape[0] - 1
        out.append(dict(c=(cu, cv), e1=e1, e2=e2, length=length, width=width, angle=angle,
                        area=len(xs), trunc=bool(trunc)))
    return out
