# Catalogue API

The Worker in [`src/worker/index.js`](../src/worker/index.js) serves the public
read side of the data service. It is read-only: publication happens through
`syndex-upload`, never through this API.

D1 is authoritative for catalogue metadata and R2 for file bytes. The Worker
queries both through bindings and never parses HDF5.

The base URL is `https://data.synthesizer-project.org`, bound as a Worker
custom domain so Cloudflare manages its DNS record and certificate. The bare
root is not a route and returns `404`; every endpoint is under `/v1`.

`workers.dev` stays enabled in [`wrangler.jsonc`](../wrangler.jsonc) as a
fallback entrypoint, because security products routinely block or
TLS-intercept newly registered domains; `synthesizer-download` falls back to
that hostname when the branded one cannot be reached. Since `download_url` is
built from the request origin, the API behaves identically on both.

## Conventions

All responses are JSON except file downloads. `GET`, `HEAD`, and `OPTIONS` are
supported; anything else returns `405`. Every response carries
`Access-Control-Allow-Origin: *`, so the catalogue website can call the API
directly from a browser.

Columns stored as serialised JSON in D1 are decoded before being returned, and
their `_json` suffix is dropped, so `metadata_json` comes back as a real
`metadata` object rather than a string. SQLite integer booleans are returned as
`true`/`false`.

A release id must be written as digits. `Number()` would accept `0x10`, `1e3`,
`1.0` and a leading space, so the check is deliberately stricter than parsing:
anything but digits is a `400`, on every endpoint that takes one.

`download_url` is absolute, built from the origin the request arrived on, so a
client can use it verbatim rather than rejoining it to a configured base. The
same API therefore works unchanged behind `workers.dev` and behind
`data.synthesizer-project.org`.

Errors are `{"error": "explanation"}` with an appropriate status code.

| Status | Meaning |
|---|---|
| `204` | `OPTIONS` preflight |
| `206` | Partial content, for a satisfied `Range` request |
| `304` | The client's `ETag` still matches |
| `400` | Malformed path parameter, such as a release id that is not digits |
| `404` | Unknown route, dataset name, or release id, or a release with no preview |
| `405` | Unsupported HTTP method |
| `416` | A `Range` outside the file |
| `500` | Unhandled error; details are logged, not returned |
| `502` | D1 references an R2 object that is no longer present |

Catalogue responses are cached for 60 seconds. File bytes are
content-addressed and never overwritten, so they are served
`immutable` with a one-year lifetime.

## `GET /v1/datasets`

Lists datasets with summary information from the current release.

| Parameter | Meaning | Default |
|---|---|---|
| `data_type` | Restrict to one type, e.g. `grid`, `dust_grid`, `instrument` | all |
| `is_test` | `true` or `false`; deliberately reduced data or not | all |
| `is_ci` | `true` or `false`; downloaded by Synthesizer's CI or not | all |
| `has_spectra` | `true` or `false`; grids carrying spectra or not | all |
| `has_lines` | `true` or `false`; grids carrying line luminosities or not | all |
| `limit` | Page size, truncated and clamped to 1–1000; anything unparseable falls back to the default | `100` |
| `after` | Dataset name to continue after, from a previous `cursor` | start |

Datasets are ordered by name. `cursor` is the last name in a full page, or
`null` when the listing is exhausted.

```json
{
  "datasets": [
    {
      "name": "draine-li-dust-emission-mw-3p1",
      "display_name": "Draine & Li (2007) MW 3.1 dust emission grid",
      "description": "Production dust emission grid...",
      "data_type": "dust_grid",
      "is_test": false,
      "is_ci": false,
      "is_recommended": false,
      "licence": null,
      "release_id": 5,
      "published_at": "2026-09-04T16:47:01.631937Z",
      "file_id": 5,
      "filename": "draine_li_dust_emission_grid_MW_3p1.hdf5",
      "format": "hdf5",
      "size_bytes": 139567192,
      "sha256": "dd59c8acc469918877c8444634d013a81d12dd68d1e9ac34d9b00b13529e9349",
      "has_spectra": true,
      "has_lines": false,
      "download_url": "https://data.synthesizer-project.org/v1/releases/5/download"
    }
  ],
  "cursor": null
}
```

A dataset with no current release still appears, with null release fields
including a null `download_url`. `has_spectra` and `has_lines` appear only for
`grid` and `dust_grid` datasets; other data types omit them. Filtering on
either restricts the listing to those, since nothing else has contents to
report.

## `GET /v1/datasets/{name}`

Returns one dataset and the complete stored metadata of its current release.
This is the response that replaces a persisted manifest: everything extracted
at publication time is assembled here from D1.

`current_release` is `null` for a dataset with no current release. `grid` is
populated for `grid` and `dust_grid` datasets and `null` otherwise;
`instrument` is populated only for `instrument` datasets. Grid axes are ordered
by `axis_index` and include complete `values`.

```json
{
  "name": "bpass-2-2-1-cloudy-sps-test",
  "display_name": "BPASS 2.2.1 Cloudy SPS test grid",
  "data_type": "grid",
  "is_test": true,
  "is_ci": true,
  "is_recommended": false,
  "licence": null,
  "citations": [],
  "metadata": {},
  "current_release": {
    "release_id": 2,
    "published_at": "2026-09-04T16:47:01.550420Z",
    "deprecated_at": null,
    "known_bug": false,
    "known_bug_description": null,
    "synthesizer_min_version": null,
    "synthesizer_max_version": null,
    "provenance": {
      "hdf5": {
        "date_created": "2025-09-27",
        "synthesizer_version": "0.9.7b1.dev4+g00432846a",
        "synthesizer_grids_version": "0.1.dev613+ga9a6aa9"
      }
    },
    "file": {
      "filename": "bpass-2.2.1-bin_chabrier03-0.1,300.0_cloudy-c23.01-sps_updated-star-fraction.hdf5",
      "format": "hdf5",
      "size_bytes": 203126664,
      "sha256": "e47f0076370da3a5ae3be24f39c03fdd83ac4d7e23da3d46f935dfb44970cfb8"
    },
    "download_url": "https://data.synthesizer-project.org/v1/releases/2/download",
    "grid": {
      "grid_type": "sps",
      "emission_type": "photoionised",
      "model_name": "BPASS",
      "model_version": "2.2.1",
      "model_parameters": { "imf_type": "chabrier03" },
      "photoionisation_code": "Cloudy",
      "photoionisation_code_version": "23.01",
      "photoionisation_parameters": {},
      "available_spectra": [
        "incident",
        "linecont",
        "nebular",
        "normalisation",
        "transmitted"
      ],
      "available_lines": ["He 2 1025.27A", "O 6 1031.91A"],
      "wavelength_min": 0.000129662,
      "wavelength_max": 299293000000.0,
      "wavelength_units": "Å",
      "has_spectra": true,
      "has_lines": true,
      "incident_release_id": null,
      "incident_release_url": null,
      "axes": [
        {
          "axis_index": 0,
          "name": "ages",
          "units": "yr",
          "scale": "log",
          "count": 51,
          "minimum": 1000000.0,
          "maximum": 100000000000.0,
          "values": [1000000.0, 1258925.411794166, 1584893.1924611141]
        }
      ]
    },
    "instrument": null,
    "citations": [
      {
        "bibcode": "2017PASA...34...58E",
        "doi": "10.1017/pasa.2017.51",
        "authors": "Eldridge, J. J.; Stanway, E. R.; ...",
        "title": "Binary Population and Spectral Synthesis Version 2.1",
        "year": 2017,
        "journal": "PASA",
        "bibtex": "@ARTICLE{2017PASA...34...58E, ... }"
      }
    ]
  }
}
```

`available_lines` and axis `values` are abbreviated above. The real response
for this release carries all 254 line identifiers, all 51 age values, and the
second `metallicities` axis, because complete axis values are what let a client
plot or filter a grid without downloading it.

`known_bug` is `true` when a defect was found in that release after it was
published. Releases are immutable, so a bad file is corrected by publishing a
new release rather than by editing the old one, and the old release stays
resolvable for anything pinned to it. When the flag is set,
`known_bug_description` says what is wrong, whether the data or only the
metadata is affected, and that a corrected release exists. A client resolving a
pinned release should surface this rather than ignore it.

Each release carries a `citations` array, ordered as a paper's bibliography
would be: the model, then the release, then the processing code. Every entry
holds `bibcode`, `doi`, `authors`, `title`, `year`, `journal` and the verbatim
`bibtex`, so a client can render a reference without parsing anything.

Two different fields are called `citations`, and only one of them matters. The
one at the top level is the legacy `datasets.citations_json` column: it is `[]`
on every row and is kept only so this migration could not break a deployed
client. The citations to use are per release, under `current_release.citations`,
because a citation belongs to the file somebody downloads rather than to the
dataset name — two releases of one dataset can need different references.

## `GET /v1/releases/{id}/citations.bib`

Returns that release's citations as a BibTeX document, `content-type:
application/x-bibtex`, with a filename derived from the dataset. The stored
entries are returned exactly as ADS produced them, since retyping references
out of a JSON payload is where citation errors come from. A release with no
recorded citations returns a BibTeX comment saying so rather than an empty
file, because a gap in the catalogue is not an error.

Entries are ordered by their recorded position and then by year, which is the
same order as the JSON `citations` array. `cache-control` is
`public, max-age=3600, must-revalidate`: this URL names a release rather than
the bytes, and a corrected citation must not stay stale.

## `GET /v1/releases/{id}/preview.png`

Returns the release's indicative preview plot, `content-type: image/png`. The
bucket is private, so the image is proxied rather than linked.

Not every release has one. A file with nothing indicative to draw returns `404`
with `{"error": "No preview for this release"}`, which is a deliberate absence
rather than a failure; 182 of the 248 releases carry a preview. A recorded
preview that R2 no longer holds is a `502`.

`cache-control` is `public, max-age=3600, must-revalidate` rather than
`immutable`. The object is content addressed, but this URL is not: it names a
release, and regenerating a preview repoints that release at new bytes, so
marking it immutable would pin a stale plot in browsers for a year. The `ETag`
changes with the object, so revalidating costs a `304`. `HEAD` returns the same
headers with no body, and `If-None-Match` returns `304`.


## `GET /v1/datasets/{name}/releases`

Lists every release of one dataset, newest publication first, each with
`is_current`, `known_bug`, its version bounds, its file details, and urls for
the release and its bytes. This is the endpoint a client uses to choose a
release, so it carries the bug flag rather than making the client fetch each
release to find it.

A dataset gains releases as its file is regenerated: the BPASS 2.2.1 Cloudy
grid, for example, has an earlier release and a later one that adds star
fraction data. Superseded releases are never removed — their bytes stay in R2
and their rows stay in D1 — so this is how a client discovers which versions
exist and pins deliberately to one.

```json
{
  "dataset": "bpass-2-2-1-cloudy-sps",
  "data_type": "grid",
  "releases": [
    {
      "release_id": 9,
      "published_at": "2026-09-06T12:00:00Z",
      "deprecated_at": null,
      "known_bug": false,
      "known_bug_description": null,
      "is_current": true,
      "synthesizer_min_version": null,
      "synthesizer_max_version": null,
      "file": {
        "filename": "...updated-star-fraction.hdf5",
        "format": "hdf5",
        "size_bytes": 203126664,
        "sha256": "..."
      },
      "url": "https://data.synthesizer-project.org/v1/releases/9",
      "download_url": "https://data.synthesizer-project.org/v1/releases/9/download"
    },
    {
      "release_id": 2,
      "published_at": "2026-09-01T12:00:00Z",
      "deprecated_at": null,
      "known_bug": true,
      "known_bug_description": "Superseded: the star fraction data was absent.",
      "is_current": false,
      "synthesizer_min_version": null,
      "synthesizer_max_version": null,
      "file": {
        "filename": "...cloudy-c23.01-sps.hdf5",
        "format": "hdf5",
        "size_bytes": 201203344,
        "sha256": "..."
      },
      "url": "https://data.synthesizer-project.org/v1/releases/2",
      "download_url": "https://data.synthesizer-project.org/v1/releases/2/download"
    }
  ]
}
```

## `GET /v1/releases/{id}`

Returns one release by id, whatever dataset it belongs to. Releases are
referenced by id from within the catalogue — a photoionised grid names the
incident release it was computed from — so they must be retrievable without
knowing the dataset first.

The body is the same release object `GET /v1/datasets/{name}` nests under
`current_release`, with three additions: `dataset` names the dataset it
belongs to, `data_type` repeats that dataset's type, and `is_current` says
whether this is the dataset's current release. Historical releases stay
retrievable after a newer one supersedes them.

```json
{
  "dataset": "bc03-2016-miles-kroupa-0p1-100",
  "data_type": "grid",
  "is_current": true,
  "release_id": 25,
  "published_at": "2026-09-06T09:14:21.117Z",
  "file": { "filename": "...", "size_bytes": 470456456, "sha256": "..." },
  "download_url": "https://data.synthesizer-project.org/v1/releases/25/download",
  "grid": { "grid_type": "sps", "emission_type": "photoionised", "...": "..." }
}
```

Grid metadata carries `incident_release_id` alongside an
`incident_release_url` pointing at this endpoint, so a client can follow a
processed grid back to the incident grid it was built from without
constructing urls itself.

## `GET /v1/releases/{id}/download`

Streams the release's file bytes. The R2 bucket stays private: bytes are
proxied through the Worker rather than redirected to a public URL, so no
bucket domain is exposed and access can later be changed in one place.

Response headers:

| Header | Purpose |
|---|---|
| `ETag` | R2 object etag; send it back as `If-None-Match` for `304` |
| `Content-Disposition` | `attachment` with the catalogue filename |
| `X-Syndex-SHA256` | Expected SHA-256, so a client can verify without a second request |
| `Cache-Control` | `public, max-age=31536000, immutable` |
| `Accept-Ranges` | `bytes`, advertising resumable downloads |

`HEAD` returns the same headers with no body, which is enough to check size
and digest before committing to a large transfer.

A `Range` header serves part of the file, so an interrupted transfer resumes
instead of restarting. That matters for production grids, which run to
gigabytes.

| Request | Response |
|---|---|
| `Range: bytes=1000-1003` | `206` with `Content-Range: bytes 1000-1003/<size>` |
| `Range: bytes=1000-` | `206` covering the rest of the file, as a resume sends |
| `Range: bytes=-1000` | `206` with the final 1000 bytes |
| `Range: bytes=<size>-` | `416` with `Content-Range: bytes */<size>` |
| Multiple ranges | `200` with the whole file; multipart responses are not served |

Ranges are validated against the size held in D1, so an impossible range is
refused without reading R2. A client resuming a download should confirm the
digest of the assembled file, since the API cannot tell whether the bytes
already on disk came from this release.

Downloading is a two-step operation: resolve the dataset to learn its release
id and expected digest, then fetch the bytes. Clients own verification, in
keeping with `synthesizer-download` retaining SHA-256 checking and atomic
installation.

## Deferred

`GET /v1/facets` is not being built. The portal server-renders its pages and
computes facet counts from D1 through the binding, so an endpoint with no
caller outside the site would be speculative. See
[`website.md`](website.md).

Multipart range responses are not served: a request for several ranges at
once receives the whole file instead. No client here needs them, and a
download resuming from one offset only ever asks for one range.
