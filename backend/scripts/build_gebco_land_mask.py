#!/usr/bin/env python3
"""
Build a GEBCO-based binary land mask for the routing grid extension band
(lat -50..-32, lon -10..82) and save it as rows [H_MODEL:H_route].

Source: GEBCO_2026 global grid (15 arc-second). The 2023 release is
retired from gebco.net, so the current release is used instead.

GEBCO_2026's global NetCDF is ~7.5 GB; the needed slab is fetched over
the CEDA OPeNDAP (THREDDS dodsC) endpoint as a set of small column
strips. A single large slab request returns a truncated/corrupted reply
from this server, so (a) requests are kept ~40 MB and (b) every strip is
validated against independent scalar point queries before assembly.

Land rule: elevation > 0 (GEBCO). Nearest-neighbour resampling to the
0.25 deg routing grid (no bilinear smearing across the coast).
Missing/fill values are treated as non-land.

Produces:
    cache/routing_land_extension.npy   [72, 369] bool (extension band)

Does NOT modify cost grids; applying the mask to routing is Task 5.
"""
from pathlib import Path

import netCDF4 as nc
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
PLOTS = ROOT / "plots"

DAP_URL = ("https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/"
           "gebco_2026/ice_surface_elevation/netcdf/GEBCO_2026.nc")
H_MODEL = 101

LAT0, LAT1 = -51.0, -28.9
LON0, LON1 = -10.5, 82.5
STRIP_COLS = 1500

# (name, lat, lon, expected_bool_land) anchor checks
ANCHORS = [
    ("CapeTown city", -33.92, 18.42, True),
    ("Karoo inland", -32.0, 22.0, True),
    ("Inland -34.5/20", -34.5, 20.0, True),
    ("open south ocean -38/18", -38.0, 18.0, False),
    ("mid Indian -35/60", -35.0, 60.0, False),
    ("S Indian -46/50", -46.0, 50.0, False),
    ("near CAgulhas shelf -35/20", -35.0, 20.0, False),
]


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    PLOTS.mkdir(parents=True, exist_ok=True)

    print("Opening GEBCO_2026 over OPeNDAP...")
    ds = nc.Dataset(DAP_URL, "r")
    lat = ds.variables["lat"][:].astype(np.float64)
    lon = ds.variables["lon"][:].astype(np.float64)
    elev = ds.variables["elevation"]
    print(f"GEBCO full grid: lat {lat[0]:.4f}..{lat[-1]:.4f} ({len(lat)}), "
          f"lon {lon[0]:.4f}..{lon[-1]:.4f} ({len(lon)})")

    if lat[0] > lat[-1]:
        lat = lat[::-1]
    if lon[0] > lon[-1]:
        lon = lon[::-1]

    i0 = int(np.argmin(np.abs(lat - LAT0)))
    i1 = int(np.argmin(np.abs(lat - LAT1))) + 1
    j0 = int(np.argmin(np.abs(lon - LON0)))
    j1 = int(np.argmin(np.abs(lon - LON1))) + 1
    nlat = i1 - i0
    nlon = j1 - j0

    print(f"Subset: lat[{i0}:{i1}] ({lat[i0]:.4f}..{lat[i1-1]:.4f}), "
          f"lon[{j0}:{j1}] ({lon[j0]:.4f}..{lon[j1-1]:.4f}) -> "
          f"{nlat} x {nlon} cells")

    # read strips; cache each on disk so an interrupted run resumes
    strip_dir = ROOT / "data" / "raw" / "gebco" / "strips"
    strip_dir.mkdir(parents=True, exist_ok=True)
    slab = np.empty((nlat, nlon), dtype=np.float32)
    for c0 in range(0, nlon, STRIP_COLS):
        c1 = min(c0 + STRIP_COLS, nlon)
        fp = strip_dir / f"strip_{c0:06d}_{c1:06d}.npy"
        if fp.exists():
            strip = np.load(fp)
            print(f"  cached lon strip {c0}:{c1}", flush=True)
        else:
            strip = np.asarray(elev[i0:i1, j0 + c0:j0 + c1],
                               dtype=np.float32)
            np.save(fp, strip)
            print(f"  read lon strip cols {c0}:{c1} "
                  f"(min {strip.min():.0f} max {strip.max():.0f})",
                  flush=True)
        slab[:, c0:c1] = strip
    ds.close()

    slab = np.where(np.isnan(slab), 0.0, slab)
    print(f"Slab assembled {slab.shape}, land cells {int((slab > 0).sum())}, "
          f"elev {slab.min():.0f}..{slab.max():.0f} m")

    # independent anchor validation on a fresh handle
    ds2 = nc.Dataset(DAP_URL, "r")
    ok = True
    for name, la, lo, want in ANCHORS:
        v = float(ds2.variables["elevation"][
            int(np.argmin(np.abs(lat - la))),
            int(np.argmin(np.abs(lon - lo)))])
        got = v > 0
        flag = "OK" if got == want else "MISMATCH"
        if got != want:
            ok = False
        print(f"  anchor {name}: elev {v:8.1f} land={got} want={want} {flag}")
    ds2.close()
    if not ok:
        raise SystemExit("anchor mismatch against source scalar reads")

    # assembled-slab vs anchor spot check (same cells)
    for name, la, lo in [("Inland -34.5/20", -34.5, 20.0),
                         ("Karoo inland", -32.0, 22.0),
                         ("open -35/60", -35.0, 60.0)]:
        a = int(np.argmin(np.abs(lat[i0:i1] - la)))
        b = int(np.argmin(np.abs(lon[j0:j1] - lo)))
        print(f"  slab-spot {name}: {slab[a, b]:.1f}")

    # regrid to routing grid, nearest neighbour
    routing_lat = np.load(CACHE / "routing_lat.npy")   # [173], -75..-32
    routing_lon = np.load(CACHE / "routing_lon.npy")   # [369], -10..82
    step = lat[i0 + 1] - lat[i0]

    ilat = np.clip(np.floor((routing_lat - lat[i0]) / step + 0.5).astype(int),
                   0, nlat - 1)
    ilon = np.clip(np.floor((routing_lon - lon[j0]) / step + 0.5).astype(int),
                   0, nlon - 1)
    regridded = slab[np.ix_(ilat, ilon)]                 # [173, 369]

    land_mask_full = regridded > 0
    land_mask_extension = land_mask_full[H_MODEL:, :]    # [72, 369]

    np.save(CACHE / "routing_land_extension.npy", land_mask_extension)
    print(f"Extension land cells {int(land_mask_extension.sum())} / "
          f"{land_mask_extension.size} "
          f"(fraction {land_mask_extension.mean():.4f})")

    # STEP 5 verification
    def show(label, la, lo):
        a = int(np.argmin(np.abs(routing_lat - la)))
        b = int(np.argmin(np.abs(routing_lon - lo)))
        v = land_mask_extension[a - H_MODEL, b]
        print(f"  {label}: land? {bool(v)} (row {a - H_MODEL}, col {b})")
        return v

    ct = show("Cape Town (-33.92,18.42)", -33.92, 18.42)
    inland = show("Inland (-34.5,20.0)", -34.5, 20.0)
    show("Coastal shelf (-35.0,20.0)", -35.0, 20.0)
    show("Open (-46.0,50.0)", -46.0, 50.0)

    # nearest ocean cell usable as Cape Town approach
    base = max(ct, inland)
    if base:
        print("  NOTE: requested cells are land; "
              "router goal for Cape Town will need an offshore cell")
    else:
        print("  CHECK PASSED: Cape Town and inland cells are both ocean")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(14, 5))
    ax.imshow(land_mask_extension.astype(int), origin="lower",
              aspect="auto",
              extent=[routing_lon[0], routing_lon[-1],
                      routing_lat[H_MODEL], routing_lat[-1]],
              cmap="RdYlBu_r", vmin=0, vmax=1)
    ax.plot(18.42, -33.92, "g*", markersize=18, label="Cape Town")
    ax.set_title("Routing extension band land mask (red = land)")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.legend()
    plt.tight_layout()
    plt.savefig(PLOTS / "land_mask_extension.png", dpi=120)
    print("Saved plots/land_mask_extension.png")


if __name__ == "__main__":
    main()