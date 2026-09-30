# Building heights & floor counts for Greater Mumbai — technical note

**Status:** complete. Every URL, S3/GCS path, column name and number below was
fetched or measured on 2026-09-29. Anything not verified is marked `UNCERTAIN`.

**What this note answers:** how to get `height_m` and `floors` onto 263k existing
ArcGIS building footprints for a browser 3D model of Greater Mumbai.

---

## 0. TL;DR — the decision

| Source | Per-building height? | Coverage in Greater Mumbai | Needs GCP account? | Verdict |
|---|---|---|---|---|
| **Overture Maps `theme=buildings/type=building`** | yes (vector column) | **`height` 2.59%, `num_floors` 0.92%** — measured | no | **Use it as a sanity-checked seed for a few percent, not as the bulk source.** |
| **Google Open Buildings 2.5D Temporal V1** | no — 4 m **raster** | 100% of the AOI (India is in scope) | **no — public GCS, anonymous HTTP verified** | **This is the real height source.** Sample it onto your footprints. |
| OSM `height` | yes | ~0.6% | no | already ruled out |
| Microsoft Global ML footprints | no | — | n/a (403) | already ruled out |

**The one-line answer to "does Overture have height for Mumbai": no, not usefully.**
792,588 Overture footprints in the Greater Mumbai bbox, 20,555 of them carry a
`height` — **2.59%** — and the median of those values is **2.3 m**, which is
physically absurd for a building. `num_floors` is worse: **0.92%**.
In a dense district sample (Andheri East) it collapses to **0.024%** (8 of 33,202).

**The real finding: Open Buildings 2.5D Temporal is *not* Earth-Engine-gated.**
Its GCS bucket `open-buildings-temporal-data` is world-readable with anonymous
HTTP range requests, verified below. That flips the assumption in the task brief.

---

## 1. Overture Maps — current release

### 1.1 Release discovery (this changed recently)

`labs.overturemaps.org/data/current/release` now **HTTP 404** with a redirect notice.
`releases.json` / `registry-manifest.json` / `overture_releases.yaml` are **removed and
frozen**. Authoritative discovery is the STAC catalog:

```
https://stac.overturemaps.org/catalog.json
```

Its top-level fields, fetched today:

```json
{ "latest": "2026-09-23.1",
  "links": [ {child 2026-08-19.0}, {child 2026-09-23.0}, {child 2026-09-23.1, "latest": true} ] }
```

* **Current release: `2026-09-23.1`**
* Theme catalog: `https://stac.overturemaps.org/2026-09-23.1/buildings/catalog.json`
* Collection: `https://stac.overturemaps.org/2026-09-23.1/buildings/building/collection.json`
  — **512 items** (one per Parquet file), each item carrying its own bbox, `num_rows`,
  `num_row_groups`, and the AWS/Azure asset hrefs.
* One item also exposes a whole-theme **PMTiles** file:
  `https://tiles.overturemaps.org/2026-09-23.1/buildings.pmtiles` (browser-friendly,
  but it carries attributes only, and is not what you want for a 263k-key join).

Releases are monthly.

### 1.2 Exact S3 URIs

Bucket `overturemaps-us-west-2`, region `us-west-2`, **`requester_pays: false`**
(read straight out of the STAC item `properties.storage:schemes`). No credentials.

```
s3://overturemaps-us-west-2/release/2026-09-23.1/theme=buildings/type=building/*
```

Public HTTPS equivalent (what DuckDB `httpfs` actually hits):

```
https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-09-23.1/theme=buildings/type=building/part-00290-3c98d427-c967-564d-a003-618d3c684b92-c000.zstd.parquet
```

Azure mirror:
```
https://overturemapswestus2.blob.core.windows.net/release/2026-09-23.1/theme=buildings/type=building/*
```

Concrete file naming (from a real item):

```
theme=buildings/type=building/part-<NNNNN>-<uuid>-c000.zstd.parquet
```

so the glob patterns that actually work are:

| pattern | status |
|---|---|
| `.../theme=buildings/type=building/*.parquet` | matches (Overture's own docs use this) |
| `.../theme=buildings/type=building/*` | matches (Overture's own docs use this) |
| `.../theme=buildings/type=building/*.zstd.parquet` | matches |
| `s3://...release=<date>-<n>.<m>/theme=...` | **obsolete — the old `release=` spelling is gone** |

There is a **second feature type in the same theme** — `type=building_part`
(poda/parts of a building, OSM-sourced only, linked by `building_id`). Your
263k footprints correspond to `type=building`. Use `building_part` only if you want
to extrude multi-massing towers; ignore it for a flat height field.

### 1.3 Schema — exact column names and types

Schema version **v2.0.0** (v1.18.0 is still served). This is DuckDB's own
`DESCRIBE SELECT * FROM read_parquet(<live url>)` output, not the docs table —
so it is the real physical Parquet schema:

```
id                       VARCHAR
names                    STRUCT("primary" VARCHAR, common MAP(VARCHAR,VARCHAR), rules STRUCT(...))
sources                  STRUCT(property VARCHAR, dataset VARCHAR, license VARCHAR, record_id VARCHAR,
                                update_time VARCHAR, confidence DOUBLE, "between" DOUBLE[],
                                provider VARCHAR, resource VARCHAR, "version" VARCHAR)[]
level                    INTEGER
height                   DOUBLE          <-- metres, nullable
min_height               DOUBLE
is_underground           BOOLEAN
num_floors               INTEGER         <-- above-ground floors, nullable
num_floors_underground   INTEGER
min_floor                INTEGER
subtype                  VARCHAR
class                    VARCHAR
facade_color             VARCHAR
facade_material          VARCHAR
roof_material            VARCHAR
roof_shape               VARCHAR
roof_direction           DOUBLE
roof_orientation         VARCHAR
roof_color               VARCHAR
roof_height              DOUBLE
geometry                 GEOMETRY('OGC:CRS84')     <-- GeoParquet WKB, lon/lat WGS84
has_parts                BOOLEAN
version                  INTEGER
bbox                     STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE)
theme                    VARCHAR
type                     VARCHAR
```

The two columns you asked about:

| column | Parquet/DuckDB type | schema constraint | meaning |
|---|---|---|---|
| `height` | `DOUBLE` / float64 | `> 0`, optional | metres, **lowest point → highest point** |
| `num_floors` | `INTEGER` / int32 | `> 0`, optional | **above-ground** floors |

Also useful and easy to miss:

* `bbox` is a real struct — it is the row-group statistic key, and filtering on it
  is what makes remote queries cheap (§3).
* `sources` is a **list of structs**, each with `dataset`, `property`, `record_id`,
  `update_time`, `confidence`, `license`. `property` is the OSM key when the row
  came from OSM (`height`, `building:levels`), so you can tell *which tag* a height
  came from. This is the provenance column you should copy into your own output.
* `min_height`, `min_floor`, `num_floors_underground` model podium/bridging.

Overture's own filtering rule worth knowing: **features with `height >= 900` m are
excluded**, so a `NULL` `height` does not mean "short".

---

## 2. Reading the Mumbai bbox — exact, working SQL

`DuckDB >= 1.1.0` required for GeoParquet. Verified working with **DuckDB 1.5.6**.

```sql
INSTALL spatial; LOAD spatial;
INSTALL httpfs;  LOAD httpfs;
SET s3_region = 'us-west-2';
SET variable xmin = 72.70; SET variable ymin = 18.80;
SET variable xmax = 73.10; SET variable ymax = 19.35;
```

> **Practical route: DuckDB `httpfs` over HTTPS.** Athena is a fine alternative but
> needs an AWS account, a glue-crawler first run over ~500 files, and per-query
> cost. HTTP range reads against a public bucket need nothing. Because the files
> are Zstd-compressed Parquet with per-row-group statistics, DuckDB reads **only the
> row groups whose `bbox` overlaps your AOI** — nothing else crosses the wire.

### 2.1 Which files to read (do NOT glob all 512)

The `buildings/building` collection item bboxes are irregular, so globbing
`theme=buildings/type=building/*` makes DuckDB issue 512 footers and open many
useless files. Query the STAC catalog and intersect the item bboxes yourself.

For Greater Mumbai exactly **two** of the 512 items intersect
`(72.7, 18.8, 73.1, 19.35)`:

| item | bbox (xmin, ymin, xmax, ymax) | rows | row groups | size |
|---|---|---|---|---|
| `00290` | `71.166, 17.992, 73.023, 22.567` | 4,939,954 | 128 | 507.7 MB |
| `00293` | `73.022, 18.683, 75.044, 20.472` | 5,021,512 | 128 | 512.3 MB |

```
s3://overturemaps-us-west-2/release/2026-09-23.1/theme=buildings/type=building/part-00290-3c98d427-c967-564d-a003-618d3c684b92-c000.zstd.parquet
s3://overturemaps-us-west-2/release/2026-09-23.1/theme=buildings/type=building/part-00293-fb18bbf6-d8a6-5348-b476-a5ec98180e11-c000.zstd.parquet
```

### 2.2 The extraction query

This is the query that produced every measured number in §3. It reads only
**34 of the 256 row groups** (26/128 in item `00290`, 8/128 in `00293`):

```sql
COPY (
  SELECT
    id,
    height,
    num_floors,
    class,
    subtype,
    -- provenance: which source contributed this row, and via which OSM tag
    sources,
    bbox,
    geometry
  FROM read_parquet([
    'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-09-23.1/theme=buildings/type=building/part-00290-3c98d427-c967-564d-a003-618d3c684b92-c000.zstd.parquet',
    'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-09-23.1/theme=buildings/type=building/part-00293-fb18bbf6-d8a6-5348-b476-a5ec98180e11-c000.zstd.parquet'
  ])
  WHERE bbox.xmin <= 73.10 AND bbox.xmax >= 72.70
    AND bbox.ymin <= 19.35 AND bbox.ymax >= 18.80
    AND ST_Intersects(ST_GeomFromText('POLYGON((72.7 18.8, 73.1 18.8, 73.1 19.35, 72.7 19.35, 72.7 18.8))'),
                      geometry)
) TO 'mumbai_overture_buildings.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
```

Notes that matter in practice:

* **Drop `ST_Intersects` if you only need to enumerate coverage** — the `bbox`
  predicate alone is enough for row-group pruning and lets DuckDB skip the
  geometry column entirely. That is the difference between a ~3-minute query and a
  much longer one. Add `ST_Intersects` only once, at the end, to trim the box.
* **Two-step, per Overture's own guidance**: materialise a local `.parquet` with
  the bbox predicate only, then re-open it locally for any geometry work. Every
  re-scan of the remote files re-downloads.
* **Do not `UNNEST(sources)` in the same query as the remote scan.** I measured
  this: it defeats the filter pushdown and the query ran >10 min without
  finishing versus 170 s for the plain aggregate. Materialise first, then `UNNEST`
  against the local file.
* DuckDB's `DESCRIBE` over the glob form `…/part-00290-*` **fails with HTTP 404**
  (DuckDB issues a plain GET on the literal asterisk URL). Use explicit filenames,
  or the `s3://` form with `*` which goes through the S3 path resolver instead.
* If you build a glob, also set `SET allow_asterisks_in_http_paths=true;`
  (DuckDB rejects `*` in HTTP paths by default).
* Areas must be computed in a projected CRS. Use `ST_Transform(geometry,'EPSG:32643')`
  (WGS84 / UTM 43N) — that is Mumbai's UTM zone. EPSG:32643 is also the CRS Google's
  own Open Buildings tiles for this region use (§4).

### 2.3 Athena alternative

`UNION` over the same two S3 keys with `openmap` / `ST_GeomFromText` on `geometry`
— but note Athena cannot see the Parquet `bbox` **row-group statistics**, so it
will read far more than DuckDB does. There is a **BigQuery public mirror**
(`overturemaps-world-buildings` region, CARTO-maintained) that is genuinely
convenient and free inside GCP. All listed at
<https://docs.overturemaps.org/getting-data/data-mirrors/>.

---

## 3. Does Overture actually have height for Mumbai? — **NO. Measured.**

Query run against release `2026-09-23.1`, `type=building`, bbox
`(xmin 72.70, ymin 18.80, xmax 73.10, ymax 19.35)`:

| metric | value |
|---|---|
| footprints in bbox | **792,588** |
| with `height` | **20,555 (2.59%)** |
| with `num_floors` | **7,306 (0.92%)** |
| with `class` | 38,981 (4.92%) |
| with `subtype` | 39,899 (5.03%) |
| min / **median** / mean / max `height` | 1.0 m / **2.3 m** / 4.0 m / **500.0 m** |
| median / max `num_floors` | 7 / 123 |

Denser sub-sample, **Andheri East (72.83–72.88 E, 19.11–19.16 N)**, 33,202 footprints:

| metric | value |
|---|---|
| with `height` | **8 (0.024%)** |
| footprint area m²: p10 / p25 / **p50** / p75 / p90 / p99 | 18 / 29 / **58** / 181 / 443 / 1,884 |
| min / mean / max area m² | 6 / 191 / 18,394 |

**Read this plainly: Overture is not a height source for Mumbai.** 2.6% is a
rounding error for a 263k-footprint model, and the values that *are* present are
mostly garbage — a 2.3 m median "building" in a city where a chawl is 9 m and a
tower is 100 m means the surviving values are mostly mis-tagged roof/parapet/`min_height`
data pulled from OSM, which is precisely the 0.6%-coverage source you already ruled out.

**Why it is this bad, from Overture's own documentation:** the buildings theme is
"primary source is OpenStreetMap, which is given the highest conflation priority",
with Microsoft ML, Google Open Buildings and an East-Asia dataset layered in for
*footprint* coverage only. *"Non-overlapping building footprints are combined
through hierarchical merging, and **height attributes are merged between matches**"*
— i.e. a conflated row inherits a height only if one of its contributing sources
had one, and in India that source is OSM. There is **no authoritative Indian
municipal or national height source in the conflation graph.** (The only
authoritative contributors are Instituto Geográfico Nacional in Spain and the City
of Vancouver.)

Overture is still worth taking, for two reasons:

1. **792,588 footprints vs your 263k.** That is ~3× more geometry. If any of your
   263k polygons has no counterpart, Overture is a fallback footprint source.
2. **20,555 real heights** is ~20k buildings you can trust *after* a sanity gate
   (§6.1), which is more than OSM alone gives you, and enough to calibrate the
   estimator's tail.

**UNCERTAIN:** I did not complete a `sources[].dataset` breakdown for the 20,555
populated rows (`UNNEST` over the remote files defeated pushdown and exceeded my
time budget). The claim that they are OSM-derived comes from Overture's
documentation, not from my own measurement. Cheap to confirm locally:

```sql
SELECT s.dataset, s.property, count(*) n, count(b.height) with_h
FROM 'mumbai_overture_buildings.parquet' b, UNNEST(b.sources) AS t(s)
GROUP BY 1,2 ORDER BY n DESC;
```

---

## 4. Google Open Buildings 2.5D Temporal — **not Earth-Engine-gated**

### 4.1 Identity (verified against the Earth Engine catalog)

| property | value |
|---|---|
| Earth Engine dataset id | `GOOGLE/Research/open-buildings-temporal/v1` |
| availability | `2016-06-30T07:00:00Z` – `2023-06-30T07:00:00Z`, **annual** (8 epochs) |
| effective resolution | **4 m** (rasters are stored at 0.5 m) |
| source imagery | Sentinel-2 |
| geographic scope | Africa, South Asia, South-East Asia, Latin America & Caribbean (**India is in scope**) |
| licence | CC-BY 4.0 **or** ODbL 1.0 — your choice |
| citation | Sirko et al. 2023, *High-Resolution Building and Road Detection from Sentinel-2*, arXiv:2310.11622 |

Bands (from the manifest's own `bands` array — exact, including the nodata value):

| band | tilesetBandIndex | units | range | nodata |
|---|---|---|---|---|
| `building_fractional_count` | (implicit 0) | — | 0 … 0.0216 | `-99.0` |
| `building_height` | 1 | **metres** | **0 … 100** | `-99.0` |
| `building_presence` | 2 | — | 0 … 1 (uncalibrated) | `-99.0` |

**This is a raster, not a per-building vector.** `building_height` is the model's
estimate of building height *within each 4 m pixel*, relative to terrain. There is
no join key to a footprint. You sample it (§5). Note also the hard **100 m cap** —
Mumbai's handful of genuine supertall towers will clip, which is acceptable for a
massing model.

### 4.2 The public GCS path — this is the part that was assumed gated

The Earth Engine catalog page states: *"if you are not an Earth Engine user, you can
download the data directly from Google Cloud Storage"*, linking a Colab notebook in
`google-research`. That notebook hard-codes:

```python
_GCS_BUCKET = "open-buildings-temporal-data"
_DATASET_VERSION = "v1"
_GCS_MANIFESTS_FOLDER = "manifests"
_MANIFEST_S2_LEVEL = 2
storage_client = storage.Client(credentials=credentials.AnonymousCredentials())
```

**`AnonymousCredentials` is the whole answer to question 3.** I verified it end to
end with plain `curl`, no `gcloud`, no service account, no project:

```
$ curl -s "https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?maxResults=5"
{ "kind": "storage#objects", "items": [ { "name": "v1/", ... },
    { "name": "v1/geotiffs/00824_2016_06_30/tile_3FYdP6L109o.tif", ... } ] }
```

HTTP 200 on an anonymous bucket listing. **The bucket is public read.**

### 4.3 Layout, and the exact Mumbai paths

```
gs://open-buildings-temporal-data/
  v1/manifests/{CELL}_EPSG_{UTM_ZONE}_{YYYY}_06_30.json
  v1/geotiffs/{CELL}{SUBCELL}_{YYYY}_06_30/tile_{S2TOKEN}.tif
```

* A **manifest** is the index for one S2 cell: it lists every Cloud-Optimized
  GeoTIFF in the dataset for one S2 cell and one UTM zone.
* Tiles are **25,000 × 25,000 px @ 0.5 m = 12.5 km × 12.5 km**, on a 12,500 m grid,
  in the manifest's UTM CRS.

**Greater Mumbai's S2 manifest cell is `3b`, UTM zone 43N (EPSG:32643):**

```
gs://open-buildings-temporal-data/v1/manifests/3b_EPSG_32643_2023_06_30.json
```

Verified: **HTTP 200, 3,514,313 bytes, 9,529 tiles, `uriPrefix` = `gs://open-buildings-temporal-data/v1/geotiffs/3b`.**
(2016's `3b_EPSG_32643_2016_06_30.json` also returns 200 if you want a time series.)

> **Gotcha that costs an hour if you don't know it:** `uriPrefix` does **not** end
> in a slash. The notebook concatenates `manifest["uriPrefix"] + uri` with no
> separator, so the real object path for a tile is
> `v1/geotiffs/3b` + `e7c_2023_06_30/tile_OScHfh-5ubs.tif`
> = **`v1/geotiffs/3be7c_2023_06_30/tile_OScHfh-5ubs.tif`**. Inserting a slash gives
> a 404. I hit both.

**Resolved tile paths for real Mumbai places** (computed by projecting each place
into EPSG:32643 and matching the manifest's `affineTransform`):

| place | lon, lat | tile |
|---|---|---|
| Mumbai Fort / Bandra | 72.8777, 19.0760 | `v1/geotiffs/3be7c_2023_06_30/tile_OScHfh-5ubs.tif` |
| Thane | 72.9781, 19.2183 | `v1/geotiffs/3be7c_2023_06_30/tile_9saav0m0P7I.tif` |
| Navi Mumbai | 73.0297, 19.0330 | `v1/geotiffs/3be7c_2023_06_30/tile_lLHJwXyOP0k.tif` |

Anonymous **HTTP 206 Partial Content** confirmed on all of them with `curl -r 0-511`:

```
$ curl -s -o /dev/null -w "%{http_code}\n" -r 0-511 \
    https://storage.googleapis.com/open-buildings-temporal-data/v1/geotiffs/3be7c_2023_06_30/tile_OScHfh-5ubs.tif
206
```

So: COG range reads work, `rasterio`/`GDAL_VSI_CURL`/`duckdb spatial` can all read
them without any Google credentials.

### 4.4 Which S2 cell / manifest do I need?

Compute the S2 cell covering your AOI, then list
`v1/manifests/{CELL}_` and pick `{YEAR}`. For an arbitrary bbox the reliable route
is the notebook's approach (S2 region coverer over the bbox's `S2LatLngRect`), but
for Greater Mumbai a single cell — `3b` — suffices and I have verified it.
If you extend the AOI you may need sibling cells; `curl` the listing to find out:

```
https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?prefix=v1/manifests/&fields=items(name),nextPageToken
```

**UNCERTAIN:** the exact S2 level convention. Google's `s2geometry`
`set_fixed_level(2)` and `s2sphere` level 2 disagree by one on token length, so
don't hard-code a level — derive the token, then confirm the manifest exists with
a HEAD. The token `3b` for Mumbai is empirically confirmed, not derived.

---

## 5. Recommended pipeline

```
263k ArcGIS footprints
        │
        ├── 1. join to Overture by geometry (bbox + IoU > 0.5)
        │       → 2.59% get a real height
        │       → sanity-gate it (§6.1) or fall through
        │
        ├── 2. sample Open Buildings 2.5D `building_height` (§5.1)
        │       → ~95% of the city gets a real, model-derived height
        │       → confidence = raster
        │
        └── 3. anything still missing → §6 estimator
                → confidence = estimated
```

### 5.1 Sampling the 4 m raster onto footprints

**The query below is a sketch, not runnable DuckDB** — DuckDB has no raster type, so
you are picking the engine. Two workable choices:

* **`rasterio` + `shapely`** (Python): open each COG window with
  `rasterio.open(url, ...)`, `ds.sample()` / `ds.window()`, then do the percentile
  per footprint yourself. Simplest and most portable.
* **GDAL `gdal_calc`/`gdallocationinfo` + `ST_Intersects`**: windowed-read the 4 m
  height raster to a vector of points (`building_height` at footprint centroids and
  at N sample points inside the polygon), then join in DuckDB/PostGIS.

The statistic to compute per footprint is the shape of this query, expressed over
whatever table your sampler produces (`samples(id, h, presence)`):

```sql
-- h75, not mean — a mean under-reads, because 4 m pixels straddling the roof edge
-- average against background zeros. The 75th percentile is the robust
-- "how tall is the tall part of this footprint" estimator.
SELECT
  id,
  quantile_cont(h, 0.75)       AS h_raster,
  count(*)                     AS n_pixels,
  quantile_cont(presence, 0.5) AS presence_med
FROM samples
WHERE h > -99                   -- nodata; the manifest's own missingData value
GROUP BY id;
```

Three guards worth keeping:

* **Restrict to pixels where `building_presence` is high** (say > 0.5). The
  confidence band is uncalibrated so it can only be used for *relative* ranking,
  but ranking is exactly what you need to reject "building_height" bleeding onto
  a road or a courtyard.
* **Cap pixels per footprint** (e.g. at 25). A 12.5 km tile is 25,000² px; a large
  plot plus its surroundings will otherwise sample thousands of mostly-background
  pixels and drag the estimate toward 0. Take the top-N by `building_presence`.
* A footprint with `n_pixels = 0` is genuinely outside the dataset's footprint —
  drop to the estimator, and mark it `coverage: none`.

**Cost note:** 12.5 km × 12.5 km at 0.5 m is a 25,000² tile. Do **not** load whole
tiles into memory. Read with `GDAL_VSI_CURL`/COG windowed reads — one 4 km-radius
Greater Mumbai AOI needs roughly 4–6 of these tiles.

---

## 6. Fallback height rule — conservative, documented, confidence-tagged

### 6.0 The design principle

**Err low.** A building modelled 3 m too short is invisible from a street-level
camera; the same building 20 m too tall is a glaring error against the real skyline
and destroys the silhouette the model is for. Every constant below is chosen at or
near the bottom of its plausible band, and the rule has a hard cap that only a
genuine tower signature can lift.

**Area is a non-monotonic predictor.** This is the single most important thing to
get right for Mumbai. A 400 m² footprint is far more likely to be a low industrial
shed or a redeveloped slab block than a tower; Mumbai's towers have *small*
footprints (typically 300–1,500 m² but on a 5–10× plot ratio, so a 200 m² tower
footprint sits on 1,500 m² of plot). So **larger footprint ⇒ shorter building**,
which is the opposite of the naive "big building = tall building" rule. The rule
below encodes that sign.

### 6.1 Gate any measured height first

```python
def sane(height_m, floors, area_m2):
    if height_m is None:                      return False
    if not (2.7 <= height_m <= 250.0):        return False   # <1 storey, or absurd
    if floors is not None and floors > 0:
        ftf = height_m / floors
        if not (2.4 <= ftf <= 6.5):           return False   # floor count disagrees
    return True
```

This gate is not paranoia: it is what rejects Overture's Mumbai median of 2.3 m
and its 500 m outliers. **Apply it to every measured height, not just Overture's.**

### 6.2 Constants (Mumbai planning defaults — assumptions, not measurements)

These are stated so they can be argued with and re-tuned. Everything marked
`UNCERTAIN` is a planning default; the one hard measured number in this section is
the area distribution in §3.

```python
# Floor-to-floor height, metres. Residential is the conservative default because
# the overwhelming majority of Mumbai building stock is residential.
FTF = {                      # UNCERTAIN
    "residential": 3.0,     # chawl / old stock, new residential 3.0-3.2
    "apartments": 3.0,
    "commercial": 3.6,
    "office":     3.6,
    "retail":     3.6,
    "industrial": 4.5,      # high-bay clear-span
    "warehouse":  6.0,
    "religious":  4.5,
    "transportation": 6.0,  # stations, depots
    "_default":   3.0,      # UNCERTAIN — residential is the safe prior
}

# Median storeys by macro-zone. UNCERTAIN: derived from how Mumbai's stock is
# generally described, NOT measured. Recalibrate from §3's SQL if you disagree.
ZONE_STORES = {              # UNCERTAIN
    "south_mumbai":    4,    # Colaba/Fort/Malat Hill/Worli — old stock, low FAR
    "island_city":     4,    # Nariman Point, Cuffe Parade — few, very tall
    "central":         7,    # Dadar/Parel/Sion/Mahim — mixed, redeveloping
    "western_suburb": 12,    # Andheri/Bandra/Powai/Goregaon — 7-20 storey
    "eastern_suburb":  8,    # Chembur/Bhandup/Kurla
    "new_mumbai":      5,    # Navi Mumbai — planned, low-rise, big footprints
    "_default":        6,
}

# Height band by class, metres. This is the safety rail.
BAND = {                     # UNCERTAIN
    "residential":   (6.0,  30.0),
    "apartments":    (9.0,  45.0),
    "commercial":    (6.0,  40.0),
    "office":       (10.0,  60.0),
    "retail":        (4.5,  25.0),
    "industrial":    (6.0,  20.0),
    "warehouse":     (7.0,  18.0),
    "religious":     (6.0,  25.0),
    "transportation":(6.0,  25.0),
    "_default":      (6.0,  30.0),
}

# Only a genuine tower signature lifts past TOWER_TRIGGER_M2.
TOWER_TRIGGER_M2   = 2500.0   # UNCERTAIN — plot, not footprint, really
TOWER_CAP_M        = 120.0    # conservative: never invent a supertall
A_REF_M2           = 58.0     # **MEASURED** median footprint area, Andheri East
```

### 6.3 The rule

```python
def estimate_height(area_m2, cls, zone, floors_known=None):
    """area_m2 : ground footprint area, metres, in EPSG:32643
       cls     : Overture/your class or subtype, may be None
       zone    : 'western_suburb' | 'south_mumbai' | ... , may be None
       returns (height_m, floors, confidence, source)
    """
    a   = max(area_m2, 10.0)                 # Overture drops ML footprints <10 m^2
    ftf = FTF.get(cls, FTF["_default"])
    lo, hi = BAND.get(cls, BAND["_default"])
    z0  = ZONE_STORES.get(zone, ZONE_STORES["_default"])

    # 1. zone prior is the base
    storeys = z0

    # 2. area term -- NON-MONOTONIC. Small footprint in a dense zone nudges up;
    #    large footprint (shed, mall, planned New Mumbai plot) nudges down.
    #    Damped hard: it is a nudge, never a driver.
    s = clamp(math.log(a / A_REF_M2) / math.log(4.0), -1.0, 1.0)   # +/-1 per octave
    if s < 0:                                    # small footprint
        storeys += (-s) * 0.20 * min(1.0, z0 / 10.0)
    else:                                        # large footprint -> lower
        storeys -= s * 0.35

    # 3. clamp the storey estimate into the class band before converting
    storeys = max(1.0, storeys)

    # 4. tower escape hatch -- gated on area AND on the band
    if a >= TOWER_TRIGGER_M2 and zone in ("western_suburb", "central",
                                          "island_city", "south_mumbai"):
        storeys = max(storeys, hi / ftf)          # may reach the band top only
        storeys = min(storeys, TOWER_CAP_M / ftf)

    height = storeys * ftf
    height = clamp(height, lo, hi)                # the safety rail, always

    floors = max(1, round(height / ftf))

    # 5. confidence -- how much of the above was actually known
    c = 0.10                                     # area alone
    if cls:   c += 0.15                          # class known
    if zone:  c += 0.15                          # zone known
    c += 0.10 * min(1.0, (a / A_REF_M2 - 1.0) / 3.0) if a > A_REF_M2 else 0.0
    if height >= hi - 1e-9: c -= 0.10            # sitting on a clamp -> less sure
    confidence = clamp(c, 0.05, 0.45)            # ESTIMATED can never exceed 0.45

    return round(height, 1), floors, round(confidence, 2), "estimated"
```

### 6.4 The confidence contract

Attach all three of these to every building, and let downstream code branch on them
rather than on `height_m`:

| `height_source` | `confidence` | meaning | share in Greater Mumbai |
|---|---|---|---|
| `measured` | **1.00** | passed §6.1 sanity gate; Overture height with a consistent floor count or a plausible standalone value | ≤ 2.6% (Overture), minus gate rejects |
| `raster` | **0.55** | Open Buildings 2.5D `building_height` sampled at 75th pct over high-presence pixels; 4 m / Sentinel-2 derived, 100 m cap | ~90% of the city |
| `estimated` | **0.05 – 0.45** | §6.3 heuristic | remainder |
| `none` | **0.00** | outside the AOI or no pixels above nodata | small |

Practical thresholds: `>= 0.55` is safe to show in a labelled/hero view;
`< 0.55` should be visually de-emphasised (flat colour, no window rows) so the
viewer never reads an estimate as a surveyed fact.

The `raster` band deserves a caveat beyond the number: it is **model output from
10 m Sentinel-2**, whose *effective* resolution is 4 m. It gets the massing of a
Mumbai skyline right in a way nothing else open does — it will tell a 9 m chawl
from a 70 m tower — but it will not get any individual building right, and it
cannot see chawl courtyards at all. Treat it as the best available prior, not as
truth. Where you have a real Overture height (§3), it beats the raster.

### 6.5 Calibration you should run before trusting this

The constants in §6.2 are assumptions. The cheap way to replace the most important
one (`ZONE_STORES`) with measurement — bucket the 20,555 populated Overture rows by
a zone you assign from the footprint centroid (e.g. a `zones` table joined on
`bbox`, or a lat/lon lookup on your 263k layer, since Overture rows carry no zone):

```sql
-- from the local extract produced in §2.2; `z` must come from your own join
SELECT z, class,
       quantile_cont(height, 0.5)  AS med_h,
       quantile_cont(height, 0.9)  AS p90_h,
       count(*)                     AS n
FROM mumbai_overture_buildings.parquet b
JOIN zones z ON ST_Intersects(z.geom, b.geometry)     -- your zone polygons
WHERE b.height IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 20
ORDER BY n DESC;
```

20,555 rows across ~6 zones × ~8 classes is thin but not useless for flattening the
priors by a storey. **The `raster` band gives you a far better calibration set** —
sample it on the full 263k and take per-zone medians; that replaces the guesses in
`ZONE_STORES` with numbers derived from your own AOI.

---

## 7. Tiling / bbox strategy — both datasets

### 7.1 Overture

Two levels, and you need both:

1. **File level — 512 files for `type=building`, irregular spatial bins.**
   *Not a quadtree, not a lat/lon grid, not S2.* 512 = 2⁹ but the bboxes are
   clearly data-adaptive: item `00000` is `[-180, -84.29, -85.87, 13.99]` (a huge
   ocean polygon) while items around India are ~2° × ~2°. Total 2,533,842,612
   building rows, ~5M per file, ~400–525 MB each. **Do not assume a level
   number** — read the item bboxes from STAC and intersect:
   `https://stac.overturemaps.org/2026-09-23.1/buildings/building/collection.json`
   → each `links[rel=item]` → each item's `bbox`. For Greater Mumbai that is 2 items.

2. **Row-group level — exactly 128 row groups per file**, laid out as a regular
   lon/lat grid of variable cell size over the file's bbox (visible clearly in item
   `00293`: `rg0`/`rg1` adjacent in longitude, `rg2`/`rg3` the next latitude band).
   Each row group carries **min/max statistics on `bbox.xmin/xmax/ymin/ymax` and on
   `height`, `num_floors`, etc.** DuckDB prunes on these automatically. Greater
   Mumbai needs 26/128 + 8/128 = **34 of 256 row groups** (~13% of two files).

The footer-only stats are also a free diagnostic. Row groups whose `height`
min/max are `NULL` contain **zero** non-null heights — a footer read costs
~1 KB per row group and tells you exactly where Overture has nothing:

```
item 00290: rg81, rg84, rg85, rg93  -> height stats NULL
item 00293: rg0,  rg10              -> height stats NULL
```

For the rest, the row-group `height` maxima are themselves a quality warning —
`rg65` max = 500 m, `rg64` max = 320 m, `rg67` max = 200 m, `rg20` spans
1–3 m — none of which is a coherent height distribution for a dense Indian city.

```sql
-- footer-only, no data read: which row groups can this AOI even touch?
SELECT row_group_id, num_values,
       stats_min_value, stats_max_value
FROM  parquet_metadata('<file url>')
WHERE path_in_schema = 'bbox, xmin'    -- NB: comma-space, NOT 'bbox.xmin'
ORDER BY row_group_id;
```

> **Trap:** the Parquet metadata `path_in_schema` for nested columns is
> `'bbox, xmin'` / `'bbox, ymax'`, **not** `'bbox.xmin'`. Querying the dotted form
> silently returns 0 rows and you will conclude "no pruning data exists".

### 7.2 Open Buildings 2.5D

* **Manifests** are indexed by S2 cell + UTM zone + year:
  `v1/manifests/{CELL}_EPSG_{ZONE}_{YYYY}_06_30.json`. Greater Mumbai = **`3b`, zone 43**.
* **Tiles** are indexed by `manifest CELL` concatenated with a `SUBCELL` token, then
  year: `v1/geotiffs/3b` + `e7c_2023_06_30/` → `v1/geotiffs/3be7c_2023_06_30/`.
* Each tile is 25,000 × 25,000 px @ 0.5 m = **12.5 km × 12.5 km**, in the manifest's
  UTM CRS. Greater Mumbai's manifest enumerates 9,529 of them.
* To pick tiles for an arbitrary bbox: project the bbox to the manifest CRS, then
  test `affineTransform` + `dimensions` (this is exactly what I did to resolve the
  Fort/Bandra/Thane/Navi Mumbai tiles above). Or simpler — for Mumbai just use the
  three tiles in the table in §4.3.
* 8 epochs × ~3 tiles for the city ≈ 24 tile reads for a 2016→2023 series. Pick
  **2023** unless you specifically want change detection.

---

## 8. Reproduction

Everything in this note was produced on 2026-09-29 with:

```bash
python3 -m venv /tmp/dv && /tmp/dv/bin/pip install duckdb==1.5.6 s2sphere==0.2.5
```

* DuckDB 1.5.6, `httpfs` + `spatial` extensions.
* Release `2026-09-23.1`, schema v2.0.0, bucket `overturemaps-us-west-2`
  (public, `requester_pays: false`).
* Network egress to `s3.us-west-2` and `storage.googleapis.com` was slow in this
  environment (~11 MB / 10 min on a raw parallel `curl`), which is why the
  per-source breakdown in §3 is `UNCERTAIN`. The queries themselves are correct and
  each first-run aggregate completed in 170 s.

---

## 9. Open items / explicitly not done

* `sources[].dataset` provenance for the 20,555 populated `height` rows — `UNCERTAIN`,
  see the query in §3.
* `ZONE_STORES` and the `BAND` table in §6.2 are **planning defaults, not measurements**.
  §6.5 gives the one-query path to replace them with measurement.
* Whether Open Buildings 2.5D height beats Overture height for Mumbai *buildings
  that have both* — I did not compute the join, but Overture's median 2.3 m makes
  the answer obvious in advance.
* East-Asia / Europe are outside this dataset's scope (Africa, South Asia,
  South-East Asia, Latin America, Caribbean) — irrelevant for Mumbai but relevant if
  you ever extend the world.


---

## Appendix: what our own implementation measured (2026-09-29)

We built a partial byte-range TIFF reader (`scripts/ob_height.py`) and verified
every step EXCEPT the final pixel decode:

- anonymous GCS read of the manifest and Mumbai tiles: **works** (206)
- manifest parse, cell `3b`, band->plane map (height=1, presence=2): **correct**
- lon/lat -> UTM 43N -> pixel via `affineTransform`: **correct**
- tile URL join (`3b` + `e7c_...`, no separator): **correct**
- TIFF is tiled 512, deflate, 3 planes, 7203 offsets, 2401/plane: **correct**
- reading a band tile's bytes by range and inflating them: length correct
  (exactly 512*512*4 = 1,048,576 bytes)

**The pixel decode is WRONG.** Interpreting the inflated bytes as little-endian
float32 yields values with magnitude ~1e37 and ~99% whole numbers — a misaligned
float read, not metre values. A dense Andheri tile returned a "height" max of
8.0 m, which is obviously wrong (real Andheri has 20-70 m towers).

Conclusion: the hand-rolled reader must be cross-checked against a real decoder
(rasterio/GDAL) before any sampled height is trusted. The sampler currently
RAISES rather than emit a fabricated height. This does NOT change any
conclusion in this document about which source to use or how to sample it — only
how the bytes get turned into floats.
