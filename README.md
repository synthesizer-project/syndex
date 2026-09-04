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
- Automatic physical format detection and Synthesizer-grid inspection.
- D1 schema migration and local migration validation.
- Cloudflare bindings for the production R2 bucket and D1 database.
- Tests for mixed batches, metadata precedence, upload verification, and D1
  registration.

Provisioned:

- Private R2 Standard bucket `synthesizer-data` in Western Europe.
- D1 database `synthesizer-database` in Western Europe.

Not yet deployed:

- D1 schema on the remote database.
- Worker API at `data.synthesizer-project.org`.
- Any catalogue records or R2 data objects.
- Catalogue website.

Do not perform a real upload yet. The next milestone is reviewing a dry run for
the nine CI pilot objects described in [`docs/test-data-pilot.json`](docs/test-data-pilot.json),
then applying the D1 migration and publishing that pilot.

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
uvx ruff check .
uvx ruff format --check .
wrangler d1 migrations apply synthesizer-database --local
```

See [publishing guide](docs/publishing.md) before preparing metadata or using
the command without `--dry-run`.

## Repository Layout

```text
docs/                    architecture, schema, and publishing guides
migrations/              ordered D1 schema migrations
src/syndicate/upload.py  inspection and publication CLI
tests/                   local tests with mocked cloud operations
wrangler.jsonc           Worker resource bindings
```

## Repository Boundaries

- [Syncretize](https://github.com/synthesizer-project/synthesizer-grids) creates
  grid files and defines their HDF5 conventions.
- [Synthesizer](https://github.com/synthesizer-project/synthesizer) resolves and
  installs published files through `synthesizer-download`.
- Syndicate stores, describes, serves, and eventually presents those files.

## Further Reading

- [`docs/plan.md`](docs/plan.md): decisions, phases, and proposed API.
- [`docs/schema.md`](docs/schema.md): R2 layout and D1 data model.
- [`docs/publishing.md`](docs/publishing.md): dry runs, metadata, credentials,
  upload safety, and Box migration.
