# Data Service Schema

R2 stores immutable files. D1 is the authoritative catalogue containing file
locations, release history, complete extracted metadata, and publication state.

The executable schema lives in [`migrations/0001_initial.sql`](../migrations/0001_initial.sql).
SQL below explains that migration and must be updated with it.

## Concepts

- A **file** is one immutable sequence of bytes in R2, identified by SHA-256.
- A **dataset** is a stable catalogue identity presented to users.
- A **release** connects one version of a dataset to one immutable file.
- **Grid metadata** describes scientific properties specific to grid releases.
- **Grid axes** retain ordered values separately so common ranges can be
  filtered without decoding JSON.

Physical format is independent of semantic type. For example, a Synthesizer
grid and a CAMELS snapshot are both HDF5 files but have `data_type = grid` and
`data_type = simulation_data`, respectively.

## R2 Layout

```text
{meaningful hierarchy}/{sha256}/{filename}
```

Examples:

```text
grids/sps/bpass/incident/{sha256}/bpass-2.2.1-bin_chabrier03-0.1,300.0.hdf5
grids/sps/bpass/photoionised/{sha256}/bpass-2.2.1-bin_chabrier03-0.1,300.0_cloudy-c23.01-sps.hdf5
instruments/jwst/{sha256}/JWST_NIRCam.hdf5
test-data/camels/{sha256}/camels_snap.hdf5
```

Published objects are never overwritten. Changed bytes produce a new digest
and path. `filename` preserves the basename presented to users; path hierarchy
is administrative rather than authoritative classification.

## Relationships

```text
datasets
  |
  +-- releases
        |
        +-- files
        +-- grid_metadata
        |     |
        |     +-- incident_release_id -> releases
        |
        +-- grid_axes
```

## Files

One immutable R2 object:

```sql
CREATE TABLE files (
    file_id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    r2_path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64)
);
```

## Datasets

One stable logical item across file updates:

```sql
CREATE TABLE datasets (
    dataset_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    data_type TEXT NOT NULL,
    current_release_id INTEGER REFERENCES releases(release_id),
    is_test INTEGER NOT NULL DEFAULT 0
        CHECK (is_test IN (0, 1)),
    is_recommended INTEGER NOT NULL DEFAULT 0
        CHECK (is_recommended IN (0, 1)),
    licence TEXT,
    citations_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

`name` is catalogue identity, not a filename. Expected initial `data_type`
values include `grid`, `instrument`, `simulation_data`, `generation_data`, and
`synference_data`. `is_test` is independent of data type and marks reduced or
synthetic fixtures not intended for scientific production. A production
instrument used by CI remains `is_test = 0`. Current release and scientific
recommendation are separate decisions.

`metadata_json` retains data-type-specific curated metadata for non-grid assets
without forcing them into grid tables. Promote a field to a column only when it
needs indexing or filtering.

## Releases

One published version backed by one immutable file:

```sql
CREATE TABLE releases (
    release_id INTEGER PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES datasets(dataset_id),
    file_id INTEGER NOT NULL UNIQUE REFERENCES files(file_id),
    published_at TEXT NOT NULL,
    deprecated_at TEXT,
    synthesizer_min_version TEXT,
    synthesizer_max_version TEXT,
    provenance_json TEXT NOT NULL DEFAULT '{}'
);
```

Numeric ID, SHA-256, and publication date identify a release. Historical
releases remain available after the current release changes.
`provenance_json` records information such as original Box path and URL,
generation tool, and source creation date. It is retained for detail responses
but is not intended for filtering.

## Grid Metadata

One row for each grid release; non-grid datasets have no row:

```sql
CREATE TABLE grid_metadata (
    release_id INTEGER PRIMARY KEY REFERENCES releases(release_id),
    grid_type TEXT NOT NULL,
    emission_type TEXT NOT NULL,
    model_name TEXT,
    model_version TEXT,
    model_parameters_json TEXT NOT NULL DEFAULT '{}',
    photoionisation_code TEXT,
    photoionisation_code_version TEXT,
    photoionisation_parameters_json TEXT,
    available_spectra_json TEXT NOT NULL DEFAULT '[]',
    available_lines_json TEXT NOT NULL DEFAULT '[]',
    wavelength_min REAL,
    wavelength_max REAL,
    wavelength_units TEXT,
    incident_release_id INTEGER REFERENCES releases(release_id)
);
```

Expected `grid_type` values include `sps`, `agn`, and `dust`. Initial
`emission_type` values include `incident`, `photoionised`, `dust_emission`, and
`dust_attenuation`; inventory validation may refine this vocabulary.

Model and photoionisation parameters remain separate JSON objects because keys
vary between models and processing codes. `incident_release_id` links a
photoionised release to the exact incident release used to produce it.

## Grid Axes

One row per axis in a grid release:

```sql
CREATE TABLE grid_axes (
    release_id INTEGER NOT NULL REFERENCES releases(release_id),
    axis_index INTEGER NOT NULL CHECK (axis_index >= 0),
    name TEXT NOT NULL,
    units TEXT,
    scale TEXT NOT NULL CHECK (scale IN ('linear', 'log')),
    count INTEGER NOT NULL CHECK (count > 0),
    minimum REAL,
    maximum REAL,
    values_json TEXT NOT NULL,
    PRIMARY KEY (release_id, name),
    UNIQUE (release_id, axis_index)
);
```

`axis_index` is zero-based and preserves HDF5 axis order. Summary columns
support filtering without decoding JSON; `values_json` retains complete axis
values for detailed API responses and metadata plots.

## Instruments

One row per instrument release, populated for `data_type = instrument`:

```sql
CREATE TABLE instruments (
    release_id INTEGER PRIMARY KEY REFERENCES releases(release_id),
    instrument_type TEXT NOT NULL
        CHECK (instrument_type IN (
            'photometric', 'photometric_imager', 'spectroscopic', 'ifu',
            'collection'
        )),
    label TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    filter_codes_json TEXT NOT NULL DEFAULT '[]',
    wavelength_min REAL,
    wavelength_max REAL,
    wavelength_units TEXT,
    resolution REAL,
    resolution_units TEXT,
    resolving_power REAL,
    depth_json TEXT,
    depth_app_radius REAL,
    depth_app_radius_units TEXT,
    snrs_json TEXT,
    psfs_json TEXT,
    psf_resample_factor INTEGER,
    noise_maps_json TEXT,
    noise_source_maps_json TEXT,
    members_json TEXT NOT NULL DEFAULT '{}'
);
```

Metadata is extracted structurally from the Synthesizer instrument
serialisation layout, the same way grid metadata is extracted from grid
files, without importing Synthesizer or constructing real instrument
objects. The four concrete `instrument_type` values and every field they can
carry are taken directly from `synthesizer.instruments`
(`PhotometricInstrument`, `PhotometricImager`, `SpectroscopicInstrument`,
`IntegratedFieldUnit`):

| `instrument_type` | Synthesizer class | Carries |
|---|---|---|
| `photometric` | `PhotometricInstrument` | filters, depth, depth_app_radius, snrs |
| `photometric_imager` | `PhotometricImager` | the above, plus resolution, psfs (per filter), psf_resample_factor, noise_maps (per filter), noise_source_maps (per filter) |
| `spectroscopic` | `SpectroscopicInstrument` | wavelength coverage, depth, depth_app_radius, snrs, noise_maps (single array), resolving_power |
| `ifu` | `IntegratedFieldUnit` | wavelength coverage, resolution, psfs (single array), psf_resample_factor, noise_source_maps, depth, depth_app_radius, snrs, resolving_power |
| `collection` | `InstrumentCollection` | `members_json`: the same extracted metadata for every contained instrument |

`resolving_power` (R = lambda / delta_lambda) is only meaningful for
`spectroscopic`/`ifu` instruments and only when Synthesizer was given a
constant value; a wavelength-dependent resolving power is a Python callable
and cannot be serialised to HDF5, so it is `NULL` here too (this is a real
Synthesizer limitation, not a Syndicate one — added as an explicit column now
so a future Synthesizer release that supports non-constant resolving powers
differently, or new instrument classes that expose it, has somewhere to land
without another migration).

`capabilities_json` mirrors `InstrumentBase`'s capability properties exactly
(`can_do_photometry`, `can_do_imaging`, `can_do_psf_imaging`, etc.), computed
from which optional fields are present the same way the real classes compute
them. Three flags (`can_do_noisy_spectroscopy`, `can_do_psf_spectroscopy`,
`can_do_noisy_resolved_spectroscopy`) are hardcoded `false` because that
functionality is not implemented in Synthesizer yet, regardless of stored
data — the extractor reports the same hardcoded values rather than inferring
them.

Depth/SNRs may be a single scalar or one value per filter/region (stored as
`{"kind": "scalar", ...}` or `{"kind": "per_key", "values": {...}}`); values
are small floats and safe to store directly. PSFs/noise maps are large bulk
arrays and are never read into metadata — only presence, per-key shape, and
units are recorded (`{"kind": "single"|"per_key", ...}`), the same way grid
spectra arrays are never read into `grid_metadata`.

Two on-disk layouts exist and are both handled: the generic layout (an
explicit `instrument_type` HDF5 attribute, used by
`InstrumentCollection.write_instruments` and hand-saved instruments) and the
lighter-weight layout used by Synthesizer's premade instrument cache files
(no `instrument_type` attribute; verified structurally against every
currently downloadable premade cache file to always be a
`photometric_imager` — filters, optionally resolution, optionally PSFs).

## Deferred Normalization

Aliases and download groups remain in `synthesizer-download`. Spectra, lines,
and variable parameter dictionaries remain JSON until concrete query or scale
requirements justify separate tables.

## Recovery

D1 backups and time travel protect normal catalogue operation. A reconciliation
command will compare D1 file rows with R2 objects. If full reconstruction is
ever required, tooling can re-extract scientific metadata from HDF5 files and
restore curated metadata from a D1 export. Take an explicit export before bulk
migration or destructive catalogue maintenance. Persisted release manifests are
deferred until an external consumer needs portable metadata independent of the
API.
