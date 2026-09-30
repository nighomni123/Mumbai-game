#!/usr/bin/env python3
"""
Open Buildings 2.5D Temporal height sampler (Google, CC-BY 4.0 / ODbL).

This is the MEASURED height source for the geo city. The bucket is public-read
— no Earth Engine, no account, no key. The data is a Sentinel-2-derived RASTER
(4 m effective, stored at 0.5 m), not vectors, so there is no join key: for a
footprint we gather building-height pixels over its bounding box, keep the ones
where building_presence is high, and take the 75th percentile (NOT the mean —
4 m pixels straddle roof edges and average against zeros).

It is a good PRIOR for skyline massing, not a survey: it will tell a 9 m chawl
from a 70 m tower, but it cannot get any single building right. Sampled heights
are tagged height_source="raster" with confidence 0.55, never authoritative.

This is Python because the TIFF tile arithmetic (BigTIFF IFD, 3-band planar
deflate tiles, byte-range reads against ~1 GB objects) was proven working
here; see docs/height-sources.md. Tiles are memoised to disk so re-runs are
free.

Usage (as a module):
    from ob_height import sample_footprint_height
    h = sample_footprint_height(lon, lat, radius_m=18)
"""

import hashlib
import json
import math
import sys
import os
import struct
import urllib.request
import zlib
from typing import Optional, Tuple

import numpy as np

MANIFEST_URL = (
    "https://storage.googleapis.com/open-buildings-temporal-data/"
    "v1/manifests/3b_EPSG_32643_2023_06_30.json"
)
BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data"
CACHE_DIR = "data/ob-cache"

# UTM 43N (EPSG:32643) — Greater Mumbai is in zone 43N.
_A = 6378137.0
_F = 1 / 298.257223563
_K0 = 0.9996
_E0 = 500000.0
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_LON0 = math.radians(75.0)

TILE_PX = 512
TILES_PER_PLANE = 49 * 49  # 25000 / 512, rounded up, per band
BANDS = 3  # fractional_count, building_height, building_presence
BAND_HEIGHT = 1
BAND_PRESENCE = 2

# The manifest, tile lookup, byte-range addressing and the UTM<->pixel
# transform are all verified. The *pixel decode* is not: reading a band tile
# and interpreting it as little-endian float32 yields values in the 1e37 range
# (99% whole numbers), so the current decode is misaligned and CANNOT be
# trusted. Until it is cross-checked against a reference decoder, this module
# raises rather than returning a fabricated height.
_DECODE_VALIDATED = False


def to_utm43(lon: float, lat: float) -> Tuple[float, float]:
    """WGS84 lon/lat -> UTM 43N (E, N) metres."""
    phi = math.radians(lat)
    lam = math.radians(lon)
    n = _A / math.sqrt(1 - _E2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2
    c = _EP2 * math.cos(phi) ** 2
    a = math.cos(phi) * (lam - _LON0)
    east = _E0 + _K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * _EP2) * a ** 5 / 120)
    m = _A * (
        (1 - _E2 / 4 - 3 * _E2 * _E2 / 64) * phi
        - (3 * _E2 / 8 + 3 * _E2 * _E2 / 32) * math.sin(2 * phi)
        + (15 * _E2 * _E2 / 256) * math.sin(4 * phi)
    )
    north = _K0 * (
        m
        + n * math.tan(phi) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * _EP2) * a ** 6 / 720)
    )
    return east, north


def local_to_wgs(x: float, y: float) -> Tuple[float, float]:
    """Our local-metre render frame -> (lon, lat)."""
    m_lon = 111320 * math.cos(math.radians(19.076))
    return 72.878 + x / m_lon, 19.076 + y / 111320


def sane_height(height: Optional[float], floors: Optional[int] = None) -> bool:
    """Rejection gate. Applied to raster output too, not just estimates."""
    if height is None or not math.isfinite(height):
        return False
    if not (2.7 <= height <= 250.0):
        return False
    if floors is not None and floors > 0:
        ftf = height / floors
        if not (2.4 <= ftf <= 6.5):
            return False
    return True


def _range_get(url: str, start: int, end: int) -> bytes:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


class _RasterSource:
    def __init__(self, manifest: dict):
        self.prefix = manifest["uriPrefix"].replace("gs://open-buildings-temporal-data", "")
        self.sources = manifest["tilesets"][0]["sources"]
        self._tables: dict = {}

    def find_tile(self, e: float, n: float):
        for s in self.sources:
            at = s["affineTransform"]
            dim = s["dimensions"]
            px = (e - at["translateX"]) / at["scaleX"]
            py = (n - at["translateY"]) / at["scaleY"]
            if 0 <= px < dim["width"] and 0 <= py < dim["height"]:
                return BUCKET + self.prefix + s["uris"][0], px, py
        return None, None, None

    def tile_table(self, url: str):
        if url in self._tables:
            return self._tables[url]
        hdr = _range_get(url, 0, 8191)
        ifd = struct.unpack_from("<I", hdr, 4)[0]
        n = struct.unpack_from("<H", hdr, ifd)[0]
        # keep BOTH the array count and the value/offset field for each tag;
        # conflating them silently yields garbage byte offsets (HTTP 416)
        tags = {}
        p = ifd + 2
        for _ in range(n):
            tag = struct.unpack_from("<H", hdr, p)[0]
            cnt = struct.unpack_from("<I", hdr, p + 4)[0]
            val = struct.unpack_from("<I", hdr, p + 8)[0]
            tags[tag] = (cnt, val)
            p += 12
        off_cnt, off_arr = tags[324]
        cnt_cnt, cnt_arr = tags[325]
        offs = np.frombuffer(_range_get(url, off_arr, off_arr + off_cnt * 4 - 1), dtype="<u4")
        cnts = np.frombuffer(_range_get(url, cnt_arr, cnt_arr + cnt_cnt * 4 - 1), dtype="<u4")
        table = (offs, cnts)
        self._tables[url] = table
        return table

    def band_tile(self, url: str, band: int, tx: int, ty: int):
        """One 512x512 band-tile, memoised to disk. None if unavailable."""
        os.makedirs(CACHE_DIR, exist_ok=True)
        key = hashlib.sha1(f"{url}|{band}|{tx}|{ty}".encode()).hexdigest()[:16]
        path = os.path.join(CACHE_DIR, f"{key}.npy")
        if os.path.exists(path):
            return np.load(path)
        try:
            offs, cnts = self.tile_table(url)
            tpr = 49
            idx = TILES_PER_PLANE * band + (ty * tpr + tx)
            off = int(offs[idx])
            clen = int(cnts[idx])
            if not off or not clen:
                return None
            raw = _range_get(url, off, off + clen - 1)
            arr = np.frombuffer(zlib.decompress(raw), dtype="<f4")
            np.save(path, arr)
            return arr
        except Exception as e:  # noqa: BLE001
            if os.environ.get("OB_DEBUG"):
                print(f"[ob_height] tile {band}/{tx}/{ty} unreadable: {e}", file=sys.stderr)
            return None  # one bad tile must never abort a chunk


_SOURCE = None


def _get_source() -> _RasterSource:
    global _SOURCE
    if _SOURCE is None:
        with urllib.request.urlopen(MANIFEST_URL, timeout=90) as r:
            _SOURCE = _RasterSource(json.load(r))
    return _SOURCE


def sample_footprint_height(lon: float, lat: float, radius_m: float = 18.0):
    """
    Sample building_height over a footprint centred at lon/lat.

    Returns {"height_m": float, "samples": int} or None when there is no
    usable signal (outside the AOI, nodata, or too few high-presence pixels).
    """
    src = _get_source()
    e, n = to_utm43(lon, lat)
    url, px_f, py_f = src.find_tile(e, n)
    if url is None:
        return None
    px, py = int(round(px_f)), int(round(py_f))
    half = max(2, int(math.ceil(radius_m / 0.5)))  # 0.5 m per pixel
    tpr = 49
    tx0, ty0 = (px - half) // TILE_PX, (py - half) // TILE_PX
    tx1, ty1 = (px + half) // TILE_PX, (py + half) // TILE_PX

    heights = []
    presences = []
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            h = src.band_tile(url, BAND_HEIGHT, tx, ty)
            p = src.band_tile(url, BAND_PRESENCE, tx, ty)
            if h is None or p is None:
                continue
            h2 = h.reshape(TILE_PX, TILE_PX)
            p2 = p.reshape(TILE_PX, TILE_PX)
            x0 = max(0, px - half - tx * TILE_PX)
            x1 = min(TILE_PX, px + half - tx * TILE_PX)
            y0 = max(0, py - half - ty * TILE_PX)
            y1 = min(TILE_PX, py + half - ty * TILE_PX)
            heights.append(h2[y0:y1, x0:x1].ravel())
            presences.append(p2[y0:y1, x0:x1].ravel())

    if not heights:
        return None
    H = np.concatenate(heights)
    P = np.concatenate(presences)
    ok = np.isfinite(P) & (P >= 0.5) & np.isfinite(H) & (H > 0) & (H <= 100)
    cand = H[ok]
    if cand.size == 0:
        return None

    # HARD GATE — the partial GeoTIFF reader is not yet verified against a
    # known-good decode, and a misaligned float read yields plausible-looking
    # but wrong values (measured: +/-1e37, 99% whole numbers, max "8 m" across a
    # dense Andheri tile). Until the decode is validated, refuse to emit any
    # height rather than poison the skyline with fake data. See
    # docs/height-sources.md and the BLOCKER note in docs/NEXT-SESSION.md.
    if not _DECODE_VALIDATED:
        raise RuntimeError(
            "ob_height: GeoTIFF partial decode is NOT validated; refusing to emit "
            "heights. Set _DECODE_VALIDATED = True only after cross-checking a "
            "decoded tile against a reference decode (e.g. rasterio/GDAL)."
        )

    return {"height_m": round(float(np.percentile(cand, 75)), 1), "samples": int(cand.size)}


if __name__ == "__main__":
    import sys

    lon = float(sys.argv[1]) if len(sys.argv) > 1 else 72.8254
    lat = float(sys.argv[2]) if len(sys.argv) > 2 else 19.2292
    r = sample_footprint_height(lon, lat)
    print(json.dumps(r) if r else "no signal")
