"""
qa_plot.py — QA panel figure for the preprocess gates, using PIL.

matplotlib cannot render on this machine (Smart App Control blocks
matplotlib._image), so panels are drawn directly to PNG with Pillow.

Usage:
    python qa_plot.py <stage: A|B> <out_png>
Reads backend/data/sic.npy, backend/data/forcing.npy, backend/data/norm_stats.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CMAP_BLUES_R = np.array(
    [[0.032, 0.188, 0.420],
     [0.118, 0.322, 0.553],
     [0.231, 0.459, 0.682],
     [0.392, 0.616, 0.796],
     [0.588, 0.763, 0.882],
     [0.804, 0.894, 0.949],
     [0.969, 0.984, 0.996]], dtype=np.float32)
CMAP_RDBU_R = np.array(
    [[0.404, 0.094, 0.640],
     [0.737, 0.322, 0.643],
     [0.949, 0.647, 0.557],
     [0.976, 0.816, 0.675],
     [0.910, 0.941, 0.945],
     [0.651, 0.796, 0.894],
     [0.365, 0.604, 0.831],
     [0.067, 0.357, 0.659]], dtype=np.float32)


def _apply_cmap(values, cmap, vmin=None, vmax=None):
    vmin = float(np.nanmin(values)) if vmin is None else vmin
    vmax = float(np.nanmax(values)) if vmax is None else vmax
    rng = (vmax - vmin) or 1.0
    idx = np.clip((values - vmin) / rng, 0.0, 1.0)
    n, c = cmap.shape
    lut = np.stack([np.interp(np.linspace(0, 1, n), np.linspace(0, 1, n),
                              cmap[:, k]) for k in range(c)], axis=1)
    r = np.interp(idx.ravel(), np.linspace(0, 1, n), cmap[:, 0])
    g = np.interp(idx.ravel(), np.linspace(0, 1, n), cmap[:, 1])
    b = np.interp(idx.ravel(), np.linspace(0, 1, n), cmap[:, 2])
    rgb = np.stack([r, g, b], axis=1).reshape(values.shape + (3,))
    rgb[np.isnan(values)] = 0.85  # land / no-data -> grey
    return (rgb * 255).astype(np.uint8)


def _font(size):
    for name in ("consola.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _panel(rgb, title):
    h, w = rgb.shape[:2]
    scale = 2
    img = Image.fromarray(rgb).resize((w * scale, h * scale),
                                      Image.NEAREST)
    draw = ImageDraw.Draw(img)
    f = _font(18)
    draw.rectangle([0, 0, img.width - 1, 30], fill=(255, 255, 255))
    draw.text((8, 6), title, fill=(0, 0, 0), font=f)
    return img


def main():
    stage, out_png = sys.argv[1].upper(), sys.argv[2]
    sic = np.load(os.path.join(ROOT, "data", "processed", "sic.npy"))        # RAW 0..1 (ITEM 4)
    frc = np.load(os.path.join(ROOT, "data", "processed", "forcing.npy"))    # standardized channels
    stats = json.load(open(os.path.join(ROOT, "data", "processed", "norm_stats.json")))
    names = list(stats["channel_names"])
    mean = np.array(stats["mean"], dtype=np.float32)
    std = np.array(stats["std"], dtype=np.float32)

    panels = []
    panels.append(_panel(_apply_cmap(sic[0], CMAP_BLUES_R, 0.0, 1.0),
                         "SIC 2022-01-01 (raw 0-1)"))
    for c, name in enumerate(names):
        raw = frc[0, c] * std[c] + mean[c]  # un-standardize for display
        cmap = CMAP_RDBU_R
        panels.append(_panel(_apply_cmap(raw, cmap),
                             f"{name} (raw: {raw} nan={int(np.isnan(raw).sum())})"))

    if stage == "A":
        ncols, nrows = 2, 2
    else:
        ncols, nrows = 3, 3
    assert len(panels) <= ncols * nrows

    w = max(p.width for p in panels)
    h = max(p.height for p in panels)
    gap = 10
    canvas = Image.new("RGB", (ncols * w + (ncols + 1) * gap,
                               nrows * h + (nrows + 1) * gap),
                       (255, 255, 255))
    for i, p in enumerate(panels):
        r, c = divmod(i, ncols)
        canvas.paste(p, (gap + c * (w + gap), gap + r * (h + gap)))
    canvas.save(out_png)
    print(f"QA plot saved: {out_png}  (panels={len(panels)}, HxW={sic.shape[1]}x{sic.shape[2]})")


if __name__ == "__main__":
    main()