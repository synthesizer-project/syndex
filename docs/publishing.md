# Publishing and Migration

This guide is for maintainers publishing files to Syndicate. Read it before
running `syndicate-upload` without `--dry-run`.

## Current Limitation

Dry runs are ready. Real publication is implemented but must wait until the
initial migration in `migrations/0001_initial.sql` has been reviewed and applied
to remote D1. Public API verification also remains unavailable until the Worker
is deployed.

## How Publication Works

For every file, `syndicate-upload`:

1. Detects its physical format from its contents where possible.
2. Recognizes Synthesizer grids from their HDF5 structure.
3. Combines command-line defaults with per-file metadata.
4. Extracts grid axes, spectra names, line IDs, wavelength coverage, model
   metadata, photoionisation metadata, and the file's self-reported generation
   attributes without loading spectra or luminosity arrays.
5. Calculates file size and SHA-256.
6. Builds and validates the complete catalogue record in memory.
7. Uploads the file to its content-addressed R2 path.
8. Verifies R2 size and SHA-256 metadata.
9. Registers all catalogue rows using one transactional D1 batch.
10. Optionally verifies the result through the public API.

R2 and D1 cannot share a transaction. Uploading R2 first prevents D1 from ever
pointing to a missing object. If D1 registration fails, an unreferenced R2
object may remain; rerunning the command verifies and reuses it before retrying
registration.

## Installation

From the repository root:

```bash
uv sync --extra test
```

Run the command through the project environment:

```bash
uv run syndicate-upload --help
```

## Format and Type

Physical format and semantic data type are different:

| File | Detected format | Catalogue `data_type` |
|---|---|---|
| Synthesizer grid | `hdf5` | `grid` |
| Synthesizer dust grid | `hdf5` | `dust_grid` |
| CAMELS snapshot | `hdf5` | `simulation_data` |
| Instrument definition | `hdf5` | `instrument` |
| SC-SAM history | `dat` | `simulation_data` |

The command detects HDF5, FITS, NPZ/ZIP, and gzip from content, with extension
fallback for plain files. It assigns a grid `data_type` only when HDF5
structure matches a Synthesizer grid: `dust_grid` when the resolved `grid_type`
is `dust`, otherwise `grid`. Dust grids are deliberately a separate catalogue
type rather than a flavour of `grid`, so they also take a separate
`dust-grid/` R2 prefix. Other semantic types cannot be inferred safely and
must be supplied by command-line default or per-file metadata.

Directories may contain mixed formats and semantic types. A homogeneous batch
can use command-line defaults; a mixed batch should use a metadata file.

## Dry Run

Always dry-run a batch first:

```bash
uv run syndicate-upload PATH \
    --data-type simulation_data \
    --is-test \
    --dry-run
```

For a directory, immediate files are processed in deterministic path order.
Add `--recursive` to include subdirectories. The metadata file itself is
excluded when it sits inside the input directory.

A dry run reads and hashes every file, prints the complete JSON publication
plan, and makes no R2, D1, or API requests. All files are validated before any
real publication starts. One invalid item therefore prevents the entire batch
from mutating cloud state.

## Metadata File

Metadata is JSON with optional batch `defaults` and per-file `files` entries:

```json
{
  "defaults": {
    "is_test": true,
    "r2_prefix": "test-data"
  },
  "files": {
    "test_grid.hdf5": {
      "name": "stellar-test-grid",
      "display_name": "Stellar test grid",
      "description": "Reduced BPASS grid used by the Synthesizer test suite.",
      "grid": {
        "grid_type": "sps",
        "emission_type": "photoionised",
        "model_name": "BPASS",
        "model_version": "2.2.1",
        "photoionisation_code": "Cloudy",
        "photoionisation_code_version": "23.01"
      },
      "set_current": true,
      "provenance": {
        "source": "BPASS 2.2.1 binary models, Chabrier (2003) IMF"
      }
    },
    "camels_snap.hdf5": {
      "name": "camels-snapshot-test-data",
      "display_name": "CAMELS test snapshot",
      "data_type": "simulation_data"
    }
  }
}
```

Per-file keys normally use paths relative to the input directory. Exact
absolute paths and basenames are also accepted. Avoid duplicate basenames in a
batch when using basename keys.

Metadata precedence, highest first:

1. Per-file entry.
2. Command-line batch option.
3. Metadata-file default.
4. Safe derived value, where supported.

Supported catalogue fields:

| Field | Meaning | Default |
|---|---|---|
| `name` | Stable lowercase dataset identifier | Slug of filename stem |
| `display_name` | Human-readable catalogue name | Filename stem |
| `description` | Human-readable explanation | `null` |
| `data_type` | `grid`, `dust_grid`, `instrument`, `simulation_data`, etc. | Recognized grids only |
| `is_test` | Fixture not intended for scientific production | `false` |
| `is_recommended` | Scientifically recommended dataset | `false` |
| `licence` | Licence identifier or text | `null` |
| `citations` | Citation strings or structured citation objects | `[]` |
| `metadata` | Type-specific non-grid metadata | `{}` |
| `r2_prefix` | Administrative R2 path prefix | Derived from type/test status |
| `published_at` | Publication timestamp | Current UTC time |
| `synthesizer_min_version` | Earliest compatible release | `null` |
| `synthesizer_max_version` | Latest compatible release | `null` |
| `provenance` | Origin of the underlying scientific data | `{}` |
| `set_current` | Select release as current | `false` |

Grid files also require `grid.grid_type` and `grid.emission_type`, either
supplied explicitly or detected. A resolved `grid_type` of `dust` publishes the
file as `data_type = dust_grid`. `grid_type: dust` is detected whenever the
filename contains "dust" (a reliable Synthesizer naming convention) or the
file uses the `extinction_curves` HDF5 layout. `emission_type` is detected as
`dust_attenuation` for the `extinction_curves` layout and `dust_emission` for
any other dust grid. Every other grid_type/emission_type combination looks
structurally identical between models (for example, an unprocessed SPS
incident grid and a dust emission grid both store a bare `spectra` group with
no filename signal to rely on), so science-specific classification is never
guessed there. Other grid fields may provide model names, versions,
photoionisation details, and an `incident_release_id`.

Instrument files (`data_type: instrument`) are classified into one of the
four real Synthesizer instrument types (`photometric`, `photometric_imager`,
`spectroscopic`, `ifu`) or a `collection` of them, with capability flags,
filters, wavelength coverage, resolution, depth/SNR, and PSF/noise-map
presence extracted structurally — see [`schema.md`](schema.md#instruments)
for the full field-by-field mapping to Synthesizer's instrument classes.

`is_test` means reduced or synthetic fixture data not intended for scientific
production. It does not mean “downloaded by CI”; production instrument files
used in tests remain `is_test = false`.

## Real Publication

Real publication requires:

- `SYNTHESIZER_R2_ACCESS_KEY_ID` and `SYNTHESIZER_R2_SECRET_ACCESS_KEY` for R2
  S3 access. Ambient `AWS_*` credentials are deliberately not used, so an
  unrelated AWS profile can never silently become the upload identity.
- `SYNTHESIZER_D1_API_TOKEN` with D1 write access.

Every variable is namespaced to this project and read only under that exact
name. Generic `AWS_*` and `CLOUDFLARE_*` variables are deliberately ignored, so
credentials or an account id belonging to unrelated infrastructure can never
silently become the publication identity.

Do not pass secrets as command arguments or commit them to files. Optional
configuration variables are:

| Variable | Purpose |
|---|---|
| `SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID` | Override Cloudflare account |
| `SYNTHESIZER_R2_BUCKET` | Override `synthesizer-data` |
| `SYNTHESIZER_D1_DATABASE_ID` | Override production D1 ID |
| `SYNTHESIZER_DATA_API_URL` | Enable final public API verification |

After reviewing dry-run output, remove `--dry-run`:

```bash
uv run syndicate-upload PATH --metadata metadata.json
```

Existing R2 objects are reused only when size and stored SHA-256 match. Existing
database records are updated idempotently. Reusing one file release under a
different dataset fails rather than silently moving it. Selecting a current
release always requires `set_current` or `--set-current`.

All files are prevalidated before cloud access. Once publication starts, one
file's transfer or registration failure does not prevent remaining validated
files from being attempted. The command reports every failure and exits
non-zero.

## Test-Data Pilot

First migration target is every distinct object the CI workflows currently
download via `synthesizer-download`:

- BPASS stellar test grid.
- QSOSED AGN test grid.
- CAMELS snapshot.
- CAMELS subhalo catalogue.
- SC-SAM history.
- Draine & Li dust emission grid.
- Draine & Li dust extinction-curve grid.
- Euclid NISP instrument cache file.
- SVO filter-cache archive.

The batch metadata for this set is operational input rather than
documentation, so it is not kept in the repository. Keying each entry by its
unique basename lets one such file match sources staged from different local
directories.

These cover grid, simulation-data, instrument, and reference-data semantics.
Existing downloader aliases produce three installed grid names from two grid
objects, giving the pilot a useful alias and deduplication test. Only the
BPASS and QSOSED grids are reduced fixtures (`is_test: true`); the dust grids,
instrument cache file, and SVO archive are production data reused by CI and
are marked `is_test: false`.

Before uploading, review every derived name, path, classification, axis, model
field, line list, wavelength range, and checksum. Also measure serialized D1
metadata sizes. Normalize a field only if the pilot demonstrates a real limit.

## Full Box Migration

Bulk migration will run from HPC scratch one file at a time:

```text
Box download
    -> temporary file
    -> inspect and hash
    -> upload and verify R2
    -> register D1
    -> record checkpoint
    -> remove temporary file
```

Peak scratch use is one source file plus transfer overhead, not the full Box
collection. Migration tooling must checkpoint every completed file, resume
safely, retry interrupted transfers, report failures, bound concurrency by
scratch capacity, and avoid changing current releases automatically.

Direct Box-to-R2 streaming is intentionally deferred. HDF5 metadata extraction
needs local file access, and the final object path is unknown until hashing
finishes.

## Recovery

Before bulk migration or destructive catalogue maintenance, export D1:

```bash
wrangler d1 export synthesizer-database --remote --output=database.sql
```

R2 file bytes are immutable. D1 time travel and exports protect catalogue
metadata. A future reconciliation command will compare D1 file rows with R2 and
report orphaned or missing objects.
