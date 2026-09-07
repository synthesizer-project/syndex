# Syndex

Syndex is the data service for the
[Synthesizer project](https://github.com/synthesizer-project). It will replace
the current Box-hosted collection with one searchable catalogue and one stable
download service for grids, instruments, test data, generation inputs, and
related project assets.

This repository owns the complete service: publication tooling, Cloudflare
infrastructure, catalogue API, Box migration, and the catalogue portal.
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
- The catalogue portal at `/syndex`, described in
  [`docs/website.md`](docs/website.md): tabs per data type, facet and axis
  range filtering, dataset pages, and a reviewed submission queue.
- Tests for mixed batches, metadata precedence, upload verification, and D1
  registration.

Live:

- Catalogue API at `https://data.synthesizer-project.org`.
- Private R2 Standard bucket `synthesizer-data` in Western Europe, holding the
  nine CI pilot objects.
- D1 database `synthesizer-database` in Western Europe, holding their
  catalogue records.

Not yet built:

- Multipart uploads driven by the portal itself. Files over 1 GiB go up with
  an S3 client instead, which already resumes.

The next milestone is resolving downloads through the API in
`synthesizer-download` instead of Box links.

## Architecture

```text
Syncretize ──creates──> grid files
                           |
                           v
                    syndex-upload
                      /          \
                    R2            D1
                 file bytes   catalogue data
                      \          /
                    Worker API
                      /      \
      synthesizer-download   catalogue portal
```

- R2 is authoritative for immutable file bytes.
- D1 is authoritative for catalogue metadata and publication state.
- Worker provides read-only catalogue and download endpoints.
- `syndex-upload` validates files, uploads to R2, then registers them in D1.
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
uv run syndex-upload sample.dat \
    --data-type simulation_data \
    --is-test \
    --dry-run
```

Inspect a directory using per-file metadata:

```bash
uv run syndex-upload ./data \
    --metadata ./metadata.json \
    --dry-run
```

Run local checks:

```bash
uv run --extra test pytest
npm test
uvx ruff check .
uvx ruff format --check .
wrangler d1 migrations apply synthesizer-database --local
```

`npm test` runs `tests/worker_routes.mjs` and `tests/portal_routes.mjs`, which
exercise the API's routing and response shaping and the portal's routing,
filter SQL and form handling against stubbed bindings. Neither needs
dependencies beyond `npm install`, and neither touches the network.

## The Portal

The portal is more routes on the same Worker, under
`synthesizer-project.org/syndex/*`, sharing the D1 and R2 bindings so its
pages query the catalogue in process rather than calling `/v1` over HTTP. It
is server-rendered Hono JSX with Tailwind for styling and htmx for filtering;
nothing hydrates, and every filtered view is a URL that works without
JavaScript. [`docs/website.md`](docs/website.md) records the decisions and the
measurements behind them.

```bash
npm install
npm run dev      # builds the stylesheet, then wrangler dev
npm run deploy   # builds the stylesheet, then wrangler deploy
```

**Deploy with `npm run deploy`, not `wrangler deploy`.** Tailwind generates
`dist/assets/` at build time, and Workers Static Assets serves what is on
disk, so deploying without building first ships whatever styling was there
last. The npm script exists so the step cannot be skipped by anyone who
forgets it is there.

### Submissions

A contributor describes a dataset, then sends the file straight to R2. The
bytes never pass through the Worker: registering a submission mints an
unguessable upload token naming one prefix of a separate submissions bucket,
and the file goes up either through a presigned PUT from the browser (under
1 GiB, which covers 233 of the catalogue's 241 datasets) or with an ordinary
S3 client driven by prefix-scoped temporary credentials (any size, and it
resumes). The Worker then lists that prefix to find out what actually
arrived, rather than believing a report of success.

Approving a submission records a decision. It does not publish: the reviewer
pulls the file out of the submissions bucket and runs `syndex-upload`,
which is the only thing that opens the HDF5, verifies the digest, and
registers R2 and D1 in one transaction. The review page prints both commands.

Both `/syndex/submit` and `/syndex/review` fail closed. The form says
submissions are shut unless every piece below is configured, and the review
page refuses to serve at all without its credentials, so a missing secret can
never leave a write endpoint standing open.

```bash
# One-off infrastructure
wrangler r2 bucket create synthesizer-submissions
wrangler d1 migrations apply synthesizer-database --remote   # 0005

# From an R2 API token scoped to synthesizer-submissions only
wrangler secret put SYNTHESIZER_SUBMISSIONS_ACCESS_KEY_ID
wrangler secret put SYNTHESIZER_SUBMISSIONS_SECRET_ACCESS_KEY
wrangler secret put SYNTHESIZER_SUBMISSIONS_API_TOKEN   # mints temp credentials

# From a Turnstile widget for synthesizer-project.org
wrangler secret put TURNSTILE_SECRET
wrangler secret put TURNSTILE_SITEKEY   # public, so a var in wrangler.jsonc also works

# Whoever reads the queue
wrangler secret put SYNDEX_REVIEW_USER
wrangler secret put SYNDEX_REVIEW_PASSWORD
```

The account id and the bucket name are non-secret and live in
`wrangler.jsonc` under `vars`. For local development everything else goes in
`.dev.vars`, which is not committed; Cloudflare publishes Turnstile test keys
that always pass, and a presigned URL signed with placeholder R2 credentials
is rejected by R2, so the browser upload is the one step that cannot be
exercised locally. To test the rest of the flow, put a file in the local
bucket by hand:

```bash
wrangler r2 object put \
    synthesizer-submissions/submissions/YOUR-TOKEN/example.hdf5 \
    --file example.hdf5 --local
```

Nothing expires the submissions bucket at present. If unreviewed
submissions ever accumulate, an R2 lifecycle rule on the `submissions/`
prefix is a bucket setting rather than a code change.

See [publishing guide](docs/publishing.md) before preparing metadata or using
the command without `--dry-run`.

## Catalogue Plots

`syndex-plots` renders diagnostic figures from the public API, so they
describe exactly what a client sees:

```bash
uv run syndex-plots --output-dir plots
uv run syndex-plots --plot wavelengths --refresh
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
src/syndex/upload.py  inspection and publication CLI
src/syndex/plots.py   diagnostic plots of the published catalogue
src/worker/entry.js      splits /v1 from /syndex
src/worker/index.js      read-only catalogue and download API
src/portal/              the portal: routes, catalogue queries, views, tokens
tests/                   local tests with mocked cloud operations, for the
                         CLI, the API and the portal
package.json             portal dependencies, build and deploy scripts
wrangler.jsonc           Worker entrypoint, static assets and resource
                         bindings
```

## Repository Boundaries

- [Syncretize](https://github.com/synthesizer-project/synthesizer-grids) creates
  grid files and defines their HDF5 conventions.
- [Synthesizer](https://github.com/synthesizer-project/synthesizer) resolves and
  installs published files through `synthesizer-download`.
- Syndex stores, describes, serves, and eventually presents those files.

## Further Reading

- [`docs/plan.md`](docs/plan.md): decisions, phases, and delivery order.
- [`docs/api.md`](docs/api.md): endpoints, response shapes, and caching.
- [`docs/schema.md`](docs/schema.md): R2 layout and D1 data model.
- [`docs/publishing.md`](docs/publishing.md): dry runs, metadata, credentials,
  upload safety, and Box migration.
- [`docs/migration-notes.md`](docs/migration-notes.md): broken source files,
  upstream issues, and naming decisions found during the Box migration.
