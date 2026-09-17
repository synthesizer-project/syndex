# Catalogue API

`https://data.synthesizer-project.org` — read-only. Publication goes through
`syndex-upload`, never through here. Served by
[`src/worker/index.js`](../src/worker/index.js), which queries D1 and R2
through bindings and never parses HDF5.

Every endpoint is under `/v1`; the bare root is a `404`. `workers.dev` stays
enabled as a fallback entrypoint, because security products routinely block
newly registered domains, and `synthesizer-download` falls back to it.

| Endpoint | Returns |
|---|---|
| [`GET /v1/datasets`](#get-v1datasets) | The catalogue, paged and filterable |
| [`GET /v1/datasets/{name}`](#get-v1datasetsname) | One dataset and its current release in full |
| [`GET /v1/datasets/{name}/releases`](#get-v1datasetsnamereleases) | Every release of one dataset |
| [`GET /v1/releases/{id}`](#get-v1releasesid) | One release by id |
| [`GET /v1/releases/{id}/download`](#get-v1releasesiddownload) | The file bytes |
| [`GET /v1/releases/{id}/citations.bib`](#get-v1releasesidcitationsbib) | Its citations as BibTeX |
| [`GET /v1/releases/{id}/preview.png`](#get-v1releasesidpreviewpng) | Its preview plot |

## Conventions

- JSON everywhere except file downloads and previews. `GET`, `HEAD`, `OPTIONS`
  only; anything else is `405`.
- `Access-Control-Allow-Origin: *` on every response.
- `_json` columns are decoded and lose the suffix: `metadata_json` comes back
  as a `metadata` object. SQLite 0/1 booleans come back as `true`/`false`.
- `download_url` is absolute, built from the request origin, so the same
  response works behind either hostname.
- A release id must be digits. `Number()` would accept `0x10`, `1e3` and a
  leading space, so the check is stricter than parsing.
- Errors are `{"error": "explanation"}`.
- Catalogue responses cache for 60 seconds; file bytes are content-addressed
  and served `immutable` for a year.

| Status | Meaning |
|---|---|
| `204` | `OPTIONS` preflight |
| `206` | A satisfied `Range` |
| `304` | `ETag` still matches |
| `400` | Malformed path parameter |
| `404` | Unknown route, name, or id; or a release with no preview |
| `405` | Unsupported method |
| `416` | `Range` outside the file |
| `500` | Unhandled error; logged, not returned |
| `502` | D1 references an R2 object that is gone |

## `GET /v1/datasets`

Datasets with summary information from the current release, ordered by name.

| Parameter | Meaning | Default |
|---|---|---|
| `data_type` | One type: `grid`, `dust_grid`, `instrument`, … | all |
| `is_test` | `true`/`false`; deliberately reduced data | all |
| `is_ci` | `true`/`false`; downloaded by Synthesizer's CI | all |
| `has_spectra` | `true`/`false`; grids carrying spectra | all |
| `has_lines` | `true`/`false`; grids carrying line luminosities | all |
| `limit` | Page size, clamped to 1–1000; unparseable falls back | `100` |
| `after` | Name to continue after, from the previous `cursor` | start |

```json
{
  "datasets": [
    {
      "name": "draine-li-dust-emission-mw-3p1",
      "display_name": "Draine & Li (2007) MW 3.1 dust emission grid",
      "description": "Production dust emission grid…",
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
      "sha256": "dd59c8ac…",
      "has_spectra": true,
      "has_lines": false,
      "download_url": "https://data.synthesizer-project.org/v1/releases/5/download"
    }
  ],
  "cursor": null
}
```

`cursor` is the last name of a full page, or `null` when exhausted. A dataset
with no current release still appears, with null release fields.
`has_spectra`/`has_lines` appear only for `grid` and `dust_grid`.

## `GET /v1/datasets/{name}`

One dataset and the complete stored metadata of its current release — this is
what replaces a persisted manifest.

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
    "provenance": { "hdf5": { "date_created": "2025-09-27", "…": "…" } },
    "file": { "filename": "…hdf5", "format": "hdf5", "size_bytes": 203126664, "sha256": "e47f0076…" },
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
      "available_spectra": ["incident", "nebular", "transmitted", "…"],
      "available_lines": ["He 2 1025.27A", "…"],
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
          "values": [1000000.0, 1258925.41, "…"]
        }
      ]
    },
    "instrument": null,
    "citations": [
      {
        "bibcode": "2017PASA...34...58E",
        "doi": "10.1017/pasa.2017.51",
        "authors": "Eldridge, J. J.; Stanway, E. R.; …",
        "title": "Binary Population and Spectral Synthesis Version 2.1",
        "year": 2017,
        "journal": "PASA",
        "bibtex": "@ARTICLE{2017PASA...34...58E, … }"
      }
    ]
  }
}
```

Lists are abbreviated above; the real response carries every line identifier
and every axis value, which is what lets a client plot or filter a grid without
downloading it.

- `current_release` is `null` for a dataset with no release. `grid` is
  populated for `grid` and `dust_grid`, `instrument` only for instruments.
- Axes come in `axis_index` order with complete `values`.
- `known_bug` marks a defect found after publication. The release stays
  resolvable; a client pinned to it should surface the description.
- Use `current_release.citations`, in bibliography order — model, release,
  processing code. The top-level `citations` is the legacy dataset column, `[]`
  on every row, kept only so this migration could not break a deployed client.

## `GET /v1/datasets/{name}/releases`

Every release, newest first, each with `is_current`, `known_bug`, version
bounds, file details, and urls for the release and its bytes. Superseded
releases are never removed, so this is how a client discovers what exists and
pins deliberately.

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
      "file": { "filename": "…updated-star-fraction.hdf5", "format": "hdf5", "size_bytes": 203126664, "sha256": "…" },
      "url": "https://data.synthesizer-project.org/v1/releases/9",
      "download_url": "https://data.synthesizer-project.org/v1/releases/9/download"
    }
  ]
}
```

## `GET /v1/releases/{id}`

One release by id, whatever dataset it belongs to — needed because releases
are referenced by id from inside the catalogue, a photoionised grid naming the
incident release it came from.

The body is the release object nested under `current_release` above, plus
`dataset`, `data_type` and `is_current`. Grid metadata carries
`incident_release_url` alongside `incident_release_id`, so a client can follow
the link without building urls.

## `GET /v1/releases/{id}/download`

Streams the bytes. The bucket stays private and the Worker proxies, so no
bucket domain is exposed.

| Header | Purpose |
|---|---|
| `ETag` | R2 object etag; send back as `If-None-Match` for a `304` |
| `Content-Disposition` | `attachment` with the catalogue filename |
| `X-Syndex-SHA256` | Expected digest, verifiable without a second request |
| `Cache-Control` | `public, max-age=31536000, immutable` |
| `Accept-Ranges` | `bytes` |

`HEAD` gives the same headers with no body — enough to check size and digest
before committing to a transfer.

| `Range` | Response |
|---|---|
| `bytes=1000-1003` | `206`, `Content-Range: bytes 1000-1003/<size>` |
| `bytes=1000-` | `206` covering the rest, as a resume asks |
| `bytes=-1000` | `206` with the last 1000 bytes |
| `bytes=<size>-` | `416`, `Content-Range: bytes */<size>` |
| Several at once | `200` with the whole file; multipart is not served |

Ranges are checked against the size in D1, so an impossible one is refused
without reading R2. Verification is the client's: the API cannot tell whether
bytes already on disk came from this release.

## `GET /v1/releases/{id}/citations.bib`

The release's citations as BibTeX (`application/x-bibtex`), filename derived
from the dataset, entries verbatim as ADS produced them — retyping references
out of JSON is where citation errors come from. Ordered by recorded position
then year. A release with no citations returns a BibTeX comment saying so,
not an empty file.

`cache-control: public, max-age=3600, must-revalidate` — the URL names a
release, and a corrected citation must not stay stale.

## `GET /v1/releases/{id}/preview.png`

The indicative preview plot, proxied because the bucket is private. A file with
nothing worth drawing returns `404` and `{"error": "No preview for this
release"}` — a deliberate absence. A recorded preview missing from R2 is `502`.

`must-revalidate` rather than `immutable`: the object is content-addressed but
this URL is not, so regenerating a preview must not leave a stale plot pinned
in browsers for a year. `HEAD` and `If-None-Match` behave as for downloads.

## Not built

- `GET /v1/facets`. The portal renders server-side and computes facet counts
  through the D1 binding, so this would have no caller.
- Multipart range responses. A resuming download only ever asks for one range.
