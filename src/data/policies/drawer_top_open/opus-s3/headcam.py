"""Head camera model (pelvis frame), calibrated from the left gripper seen at known arm poses."""
import numpy as np

# camera centre (pelvis frame), camera axes as columns (x right, y down, z optical), focal px
CAM_C = np.array([0.1379, 0.0027, 0.3873])
CAM_R = np.array([[0.0242, -0.9044, 0.426],
                  [-0.9997, -0.0215, 0.0113],
                  [-0.001, -0.4261, -0.9047]])
CAM_F = 70.59


def ray(u, v):
    """Unit ray (pelvis frame) through pixel (u, v) of the 84x84 head image."""
    d = CAM_R @ np.array([(u - 42.0) / CAM_F, (v - 42.0) / CAM_F, 1.0])
    return d / np.linalg.norm(d)


def project(p):
    pc = CAM_R.T @ (np.asarray(p) - CAM_C)
    return np.array([42 + CAM_F * pc[0] / pc[2], 42 + CAM_F * pc[1] / pc[2]])


def on_plane_z(u, v, z):
    """Point on the ray through (u,v) at pelvis-frame height z."""
    d = ray(u, v)
    t = (z - CAM_C[2]) / d[2]
    return CAM_C + t * d


def on_plane_x(u, v, x):
    d = ray(u, v)
    t = (x - CAM_C[0]) / d[0]
    return CAM_C + t * d
