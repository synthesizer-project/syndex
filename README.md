# Syndicate

Syndicate is the data service for the
[Synthesizer project](https://github.com/synthesizer-project). It will replace
the current Box-hosted collection with one searchable catalogue and one stable
download service for grids, instruments, test data, generation inputs, and
related project assets.

This repository owns the complete service: publication tooling, Cloudflare
infrastructure, catalogue API, Box migration, and the future catalogue website.
It does not generate scientific grids and it does not install downloads into a
user's Synthesizer environment.

## Current Status

Implemented:

- Content-addressed batch uploader with a network-free dry-run mode.
- Automatic physical format detection, Synthesizer-grid inspection, and
  instrument inspection.
- D1 schema migration, applied locally and remotely.
- Read-only catalogue and download API, described in
  [`docs/api.md`](docs/api.md).
- Tests for mixed batches, metadata precedence, upload verification, and D1
  registration.

Live:

- Catalogue API at `https://data.synthesizer-project.org`.
- Private R2 Standard bucket `synthesizer-data` in Western Europe, holding the
  nine CI pilot objects.
- D1 database `synthesizer-database` in Western Europe, holding their
  catalogue records.

Not yet built:

- Catalogue website.

The next milestone is resolving downloads through the API in
`synthesizer-download` instead of Box links.

## Architecture

```text
Syncretize ──creates──> grid files
                           |
                           v
                    syndicate-upload
                      /          \
                    R2            D1
                 file bytes   catalogue data
                      \          /
                    Worker API
                      /      \
      synthesizer-download   catalogue website
```

- R2 is authoritative for immutable file bytes.
- D1 is authoritative for catalogue metadata and publication state.
- Worker provides read-only catalogue and download endpoints.
- `syndicate-upload` validates files, uploads to R2, then registers them in D1.
- Synthesizer retains user-facing aliases, download groups, and destination
  handling.

There are no persisted metadata manifests. Complete metadata is held in D1 and
returned as JSON by the API.

## Quick Start

Install dependencies:

```bash
uv sync --extra test
```

Inspect one non-grid file without contacting Cloudflare:

```bash
uv run syndicate-upload sample.dat \
    --data-type simulation_data \
    --is-test \
    --dry-run
```

Inspect a directory using per-file metadata:

```bash
uv run syndicate-upload ./data \
    --metadata ./metadata.json \
    --dry-run
```

Run local checks:

```bash
uv run --extra test pytest
node tests/worker_routes.mjs
uvx ruff check .
uvx ruff format --check .
wrangler d1 migrations apply synthesizer-database --local
```

`tests/worker_routes.mjs` exercises the API's routing and response shaping
against stubbed bindings, so it needs neither dependencies nor network access.

See [publishing guide](docs/publishing.md) before preparing metadata or using
the command without `--dry-run`.

## Catalogue Plots

`syndicate-plots` renders diagnostic figures from the public API, so they
describe exactly what a client sees:

```bash
uv run syndicate-plots --output-dir plots
uv run syndicate-plots --plot wavelengths --refresh
```

| Plot | Shows |
|---|---|
| `composition` | Volume and dataset count by data type |
| `sizes` | File size distribution, with the extremes named |
| `wavelengths` | Distinct wavelength coverage across the grids |
| `models` | Grids by model family and emission type |
| `timeline` | Datasets and cumulative volume over publication time |
| `instruments` | Instrument wavelength coverage and filter counts |

Responses are cached in `.catalogue-cache.json`; `--refresh` re-fetches them.

## Repository Layout

```text
docs/                    architecture, schema, API, and publishing guides
migrations/              ordered D1 schema migrations
src/syndicate/upload.py  inspection and publication CLI
src/syndicate/plots.py   diagnostic plots of the published catalogue
src/worker/index.js      read-only catalogue and download API
tests/                   local tests with mocked cloud operations, for both
                         the CLI and the API
wrangler.jsonc           Worker entrypoint and resource bindings
```

## Repository Boundaries

- [Syncretize](https://github.com/synthesizer-project/synthesizer-grids) creates
  grid files and defines their HDF5 conventions.
- [Synthesizer](https://github.com/synthesizer-project/synthesizer) resolves and
  installs published files through `synthesizer-download`.
- Syndicate stores, describes, serves, and eventually presents those files.

## Further Reading

- [`docs/plan.md`](docs/plan.md): decisions, phases, and delivery order.
- [`docs/api.md`](docs/api.md): endpoints, response shapes, and caching.
- [`docs/schema.md`](docs/schema.md): R2 layout and D1 data model.
- [`docs/publishing.md`](docs/publishing.md): dry runs, metadata, credentials,
  upload safety, and Box migration.
- [`docs/migration-notes.md`](docs/migration-notes.md): broken source files,
  upstream issues, and naming decisions found during the Box migration.
