# Development

Everything needed to run the service locally and understand how the pieces fit
together. For what Syndex is and how to use it, see the
[README](../README.md); for the decisions behind the portal, see
[`website.md`](website.md).

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
- The Worker serves the read-only catalogue and download API, and the portal.
- `syndex-upload` validates files, uploads to R2, then registers them in D1.
- Synthesizer keeps user-facing aliases, download groups and destinations.

There are no persisted metadata manifests: complete metadata lives in D1 and
is returned as JSON by the API.

## Prerequisites

Python 3.10 or later, [uv](https://docs.astral.sh/uv/), and Node 22.15 or
later — the portal's tests transform JSX through `module.registerHooks`, which
older releases do not have. The Cloudflare commands below assume `npm install`
has run; prefix `wrangler` with `npx` unless it is installed globally.

```bash
uv sync --extra test
npm install
```

## Running the checks

```bash
uv run --extra test pytest
npm test
uvx ruff check .
uvx ruff format --check .
npx wrangler d1 migrations apply synthesizer-database --local
```

`npm test` runs `tests/worker_routes.mjs` and `tests/portal_routes.mjs`, which
exercise the API's routing and response shaping and the portal's routing,
filter SQL, pages and form handling against stubbed bindings. Neither needs
anything beyond `npm install`, and neither touches the network.

## Running the portal

The portal is more routes on the same Worker, under
`synthesizer-project.org/syndex/*`, sharing the D1 and R2 bindings so its
pages query the catalogue in process rather than calling `/v1` over HTTP. It
is server-rendered Hono JSX with Tailwind for styling and htmx for filtering;
nothing hydrates, and every filtered view is a URL that works without
JavaScript.

```bash
npm run dev      # builds assets, applies local D1 migrations, starts Wrangler
npm run deploy   # builds the stylesheet, then wrangler deploy
```

`npm run dev` creates the local D1 schema but no rows, so the portal starts
empty. Seed it from the live catalogue:

```bash
npx wrangler d1 export synthesizer-database --remote --output=local.sql
npx wrangler d1 execute synthesizer-database --local --file=local.sql
```

Preview images and download links always point at
`data.synthesizer-project.org`, so those load from production even locally.

**Deploy with `npm run deploy`, not `wrangler deploy`.** Tailwind generates
`dist/assets/` at build time and Workers Static Assets serves what is on disk,
so deploying without building first ships whatever styling was there last. The
npm script exists so the step cannot be skipped.

### Signing in locally

`wrangler dev` serves plain HTTP, and session cookies are marked `Secure` only
over HTTPS, so signing in works locally — but the OAuth app needs a second
redirect URI, `http://localhost:8787/syndex/auth/callback`, and
`GITHUB_CLIENT_SECRET` in `.dev.vars`. Everything else it needs is in
`wrangler.jsonc` under `vars`.

The configuration the portal expects, and what each piece is for, is in
"Accounts" and "Validation" in [`website.md`](website.md).

## Migrations

Ordered SQL in `migrations/`, applied by hand rather than by the deploy
workflow: a schema change should land when someone is watching it, not as a
side effect of a merge.

```bash
npx wrangler d1 migrations list synthesizer-database --remote
npx wrangler d1 migrations apply synthesizer-database --remote
```

A deploy can outrun the database. If the Worker writes a column that is not
there yet, the page it writes from returns a 500 with nothing else to say, so
apply migrations before deploying the code that needs them.

## Catalogue plots

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
| `sps` | Age and metallicity coverage across the SPS grids |
| `cloudy` | Photoionisation parameters across the Cloudy-processed grids |
| `imf` | Initial mass functions in use, by slope and mass range |

Responses are cached in `.catalogue-cache.json`; `--refresh` re-fetches them.
`syndex-plots` reads no environment variables, so `SYNTHESIZER_DATA_API_URL`
does not affect it; point it elsewhere with `--api-url`.

## Preview plots

`syndex-previews` renders the one indicative plot each catalogue file can
honestly support: every spectrum for a grid, transmission curves for an
instrument, an ionising-luminosity map for a grid that carries nothing else.
Files with nothing to draw get no image rather than an empty frame.

```bash
uv run syndex-previews --only DATASET --output-dir plots   # judge it first
uv run syndex-previews --apply                             # publish
```

It reads the grids out of R2 over range requests, so nothing is downloaded
whole, and records what it made in a manifest so a long run resumes. With
neither flag it lists what it would do.

## Releasing

The version is never written down: `hatch-vcs` reads it from the git tag, so a
release is a tag and nothing else, and the published metadata cannot disagree
with the repository.

```bash
git tag v0.1.0
git push origin v0.1.0
```

That fires `.github/workflows/publish.yml`, which runs the tests, builds, and
publishes to PyPI through trusted publishing — no token is stored anywhere. A
version cannot be republished once it exists on PyPI, so a broken release
means the next number, not a retry.

## Repository layout

```text
docs/                    architecture, schema, API, publishing and portal notes
migrations/              ordered D1 schema migrations

src/syndex/              the Python tools, one concern per module
  classify.py            what a file is
  check.py               whether it can be published, and why not
  inspection.py          opening a file and reading what it says
  cloudflare.py          the account and bucket the tools default to
  errors.py              the exception the tools raise on purpose
  submit.py              sending a file to a submission from a terminal
  plotting.py            importing matplotlib, once, for both plot commands
  publish/               publishing a file: sources, citations, plan,
                         storage, registry, serialise, and the
                         syndex-upload command
  plots/                 diagnostic plots of the catalogue: api, palette,
                         layout, catalogue, coverage, instruments
  previews/              per-file preview plots, stored in R2 and D1: r2,
                         figure, kinds, store

src/worker/entry.js      splits /v1 from /syndex
src/worker/index.js      read-only catalogue and download API

src/portal/              the portal, layered the same way
  app.jsx                assembly: middleware, mounts, error pages
  base.js                where the portal and the API live
  routes/                one module per group of URLs
  pages/                 a component per page
  views/                 the shell, formatting, filter rail, results table
  data/                  every query and every write, and nothing rendered
  static/                the only JavaScript that reaches a browser

tests/                   local tests with mocked cloud operations, for the
                         CLI, the API and the portal
package.json             portal dependencies, build and deploy scripts
wrangler.jsonc           Worker entrypoint, static assets and resource bindings
```

## Repository boundaries

- [Syncretize](https://github.com/synthesizer-project/syncretize) creates grid
  files and defines their HDF5 conventions.
- [Synthesizer](https://github.com/synthesizer-project/synthesizer) resolves
  and installs published files through `synthesizer-download`.
- Syndex stores, describes, serves and presents those files.

## Further reading

- [`plan.md`](plan.md): decisions, phases, and delivery order.
- [`api.md`](api.md): endpoints, response shapes, and caching.
- [`schema.md`](schema.md): R2 layout and D1 data model.
- [`website.md`](website.md): the portal, accounts, submissions and validation.
- [`publishing.md`](publishing.md): dry runs, metadata, credentials, upload
  safety, and Box migration.
- [`migration-notes.md`](migration-notes.md): broken source files, upstream
  issues, and naming decisions found during the Box migration.
