# Publishing

For maintainers running `syndex-upload`. Dry-run first, always: publication
writes immutable objects.

## What it does

For every file:

1. Detects the physical format from its contents.
2. Recognises Synthesizer grids and instruments from their HDF5 structure.
3. Merges command-line defaults with the metadata file.
4. Extracts axes, spectra names, line IDs, wavelength coverage, model and
   photoionisation metadata, without reading any bulk array.
5. Hashes the file and builds the whole catalogue record in memory.
6. Uploads to a content-addressed R2 path and verifies size and digest.
7. Registers every row in one transactional D1 batch.
8. Optionally verifies through the public API.

R2 and D1 cannot share a transaction, so bytes go first: D1 can then never
point at a missing object, and a failed registration leaves only an
unreferenced object that rerunning reuses.

Previews are separate, because they read the whole file back out of R2:

```bash
uv run syndex-previews --only NAME --output-dir plots   # judge the plot
uv run syndex-previews --apply                          # upload and record it
```

## Format and type

Physical format and catalogue type are different things:

| File | Format | `data_type` |
|---|---|---|
| Synthesizer grid | `hdf5` | `grid` |
| Synthesizer dust grid | `hdf5` | `dust_grid` |
| CAMELS snapshot | `hdf5` | `simulation_data` |
| Instrument definition | `hdf5` | `instrument` |
| SC-SAM history | `dat` | `simulation_data` |

HDF5, FITS, NPZ/ZIP and gzip are detected from content, with an extension
fallback for plain files. A grid `data_type` is assigned only when the HDF5
structure matches a Synthesizer grid. Everything else must be given, on the
command line or in the metadata file.

## Dry run

```bash
uv run syndex-upload PATH --data-type simulation_data --is-test --dry-run
```

Reads and hashes every file, prints the complete JSON plan, and makes no R2,
D1 or API request. A directory takes its immediate files in path order;
`--recursive` descends. Every file is validated before any is published, so one
bad item stops the batch before it touches anything.

## Metadata file

JSON, with batch `defaults` and per-file `files` entries:

```json
{
  "defaults": { "is_test": true, "r2_prefix": "test-data" },
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
      "citations": ["2017PASA...34...58E"],
      "set_current": true,
      "provenance": { "source": "BPASS 2.2.1 binary, Chabrier (2003) IMF" }
    },
    "camels_snap.hdf5": {
      "name": "camels-snapshot-test-data",
      "display_name": "CAMELS test snapshot",
      "data_type": "simulation_data"
    }
  }
}
```

Keys are paths relative to the input directory; absolute paths and bare
basenames also work, so avoid duplicate basenames in one batch.

Precedence, highest first: per-file entry, command-line option, metadata-file
default, derived value.

| Field | Meaning | Default |
|---|---|---|
| `name` | Stable lowercase dataset identifier | Slug of the filename stem |
| `display_name` | Human-readable name | Filename stem |
| `description` | What it is | `null` |
| `data_type` | `grid`, `dust_grid`, `instrument`, `simulation_data`, … | Grids only |
| `is_test` | Deliberately reduced, not science-grade | `false` |
| `is_ci` | Downloaded by Synthesizer's CI | `false` |
| `is_recommended` | Curated recommendation | `false` |
| `licence` | Licence identifier or text | `null` |
| `citations` | Bibcodes, resolved to BibTeX through ADS | `[]` |
| `metadata` | Type-specific metadata for non-grids | `{}` |
| `r2_prefix` | R2 path prefix | From type and test status |
| `published_at` | Publication timestamp | Now, UTC |
| `synthesizer_min_version` / `_max_version` | Compatible range | `null` |
| `provenance` | Where the underlying data came from | `{}` |
| `set_current` | Make this the dataset's current release | `false` |

`is_test` and `is_ci` are independent: the dust grids and the Euclid NISP cache
are production files CI downloads, so `is_ci: true, is_test: false`.

Grids need `grid.grid_type` and `grid.emission_type`, given or detected.
`grid_type: dust` is detected from "dust" in the filename (a reliable
Synthesizer convention) or the `extinction_curves` layout, and publishes as
`data_type = dust_grid`; `emission_type` follows as `dust_attenuation` for that
layout and `dust_emission` otherwise. Nothing else is guessed — an unprocessed
SPS incident grid and a dust emission grid both store a bare `spectra` group
with no signal to tell them apart.

Instruments are classified structurally into Synthesizer's five types, with
capabilities, filters, coverage, resolution, depth and PSF presence extracted;
[`schema.md`](schema.md#instruments) has the field mapping.

Citations are given as bibcodes and resolved against ADS at planning time, so
an unknown one fails before anything is uploaded.

## Publishing

Required:

- `SYNTHESIZER_R2_ACCESS_KEY_ID`, `SYNTHESIZER_R2_SECRET_ACCESS_KEY`
- `SYNTHESIZER_D1_API_TOKEN` with D1 write access

Optional:

| Variable | Purpose |
|---|---|
| `SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID` | Another Cloudflare account |
| `SYNTHESIZER_R2_BUCKET` | Another bucket |
| `SYNTHESIZER_D1_DATABASE_ID` | Another database |
| `SYNTHESIZER_DATA_API_URL` | Turn on the final API check |
| `SYNTHESIZER_ADS_TOKEN` | ADS token for citations; without it the tool asks for an anonymous one, fine for occasional use but rate-limited ([get one](https://ui.adsabs.harvard.edu/user/settings/token)) |

Every name is namespaced to this project. Generic `AWS_*` and `CLOUDFLARE_*`
variables are deliberately ignored, so an unrelated profile can never silently
become the publication identity. Never pass a secret as an argument.

```bash
uv run syndex-upload PATH --metadata metadata.json
```

The API check is opt-in because a transient API error after both writes have
succeeded would report a sound publication as a failure:

```bash
SYNTHESIZER_DATA_API_URL=https://data.synthesizer-project.org \
    uv run syndex-upload PATH --metadata metadata.json
```

It only affects `syndex-upload`; point `syndex-plots` and `syndex-previews`
elsewhere with `--api-url` and `--account-id`.

## Releases

Publishing a regenerated file under the same `name` adds a release rather than
replacing anything: the old release keeps its bytes and stays resolvable.
`set_current` decides what the dataset points at — leave it false when
publishing a superseded file after the fact.

An existing R2 object is reused only when size and digest match. Database rows
update idempotently. Reusing one file release under a different dataset fails
rather than silently moving it.

Once publication starts, one file failing does not stop the rest: every failure
is reported and the exit status is non-zero.

## Recovery

Export D1 before bulk or destructive work:

```bash
wrangler d1 export synthesizer-database --remote --output=database.sql
```

R2 bytes are immutable; D1 time travel and exports cover the metadata.
