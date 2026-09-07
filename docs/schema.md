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
{prefix}/{sha256}/{filename}
```

`prefix` defaults to the dataset's `data_type` with underscores replaced by
hyphens, below `test-data/` when `is_test` is set. Examples:

```text
dust-grid/{sha256}/draine_li_dust_emission_grid_MW_3p1.hdf5
instrument/{sha256}/Euclid_NISP.hdf5
test-data/grid/{sha256}/qsosed-test_cloudy-c23.01-agn-test.hdf5
test-data/simulation-data/{sha256}/camels_snap.hdf5
```

A publication may override `prefix` with an explicit `r2_prefix`, but the
default is deliberately flat. Scientific classification lives in D1
(`data_type`, `grid_type`, `emission_type`, `instrument_type`), so a deeper
path hierarchy would duplicate that metadata by hand for every published file
and drift from it. Path hierarchy is administrative rather than authoritative
classification.

Published objects are never overwritten. Changed bytes produce a new digest
and path. `filename` preserves the basename presented to users.

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
    is_ci INTEGER NOT NULL DEFAULT 0
        CHECK (is_ci IN (0, 1)),
    is_recommended INTEGER NOT NULL DEFAULT 0
        CHECK (is_recommended IN (0, 1)),
    licence TEXT,
    citations_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

`name` is catalogue identity, not a filename. Expected initial `data_type`
values include `grid`, `dust_grid`, `instrument`, `simulation_data`,
`generation_data`, `synference_data`, and `cache` for mechanical CI
dependencies such as the SVO filter response archive.

`dust_grid` is a distinct type, not a flavour of `grid`. Dust grids describe
dust attenuation curves and dust emission spectra rather than stellar or AGN
emission, so they are classified, prefixed, listed, and filtered separately
throughout: `data_type = dust_grid`, an R2 prefix of `dust-grid/`, and
`emission_type` of `dust_attenuation` or `dust_emission`. Both `grid` and
`dust_grid` still populate `grid_metadata` and `grid_axes`, because the
underlying HDF5 layout is shared. `data_type` is detected structurally: any
file whose resolved `grid_type` is `dust` is published as `dust_grid`. `is_test` and `is_ci` are independent of data type and of each other:

- `is_test` marks data that is **deliberately reduced or incomplete** — a
  handful of points per axis, a synthetic fixture — and therefore not suitable
  for science.
- `is_ci` marks data that **Synthesizer's CI workflows download**.

The two were originally one flag, which could not describe the common case:
the Draine & Li dust grids and the Euclid NISP instrument cache are fetched on
every CI run and are complete, science-grade files, so they are `is_ci = 1`
and `is_test = 0`. Conversely a deliberately reduced grid that CI never
touches is `is_test = 1` and `is_ci = 0`.

Current release and scientific recommendation remain separate decisions
again.

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
    provenance_json TEXT NOT NULL DEFAULT '{}',
    known_bug INTEGER NOT NULL DEFAULT 0,
    known_bug_description TEXT
);
```

Numeric ID, SHA-256, and publication date identify a release. Historical
releases remain available after the current release changes.

`synthesizer_min_version` and `synthesizer_max_version` bound the Synthesizer
releases a file can be used with, stored without a leading `v` so they compare
directly against `synthesizer.__version__`. By convention grids and
instruments carry a minimum of `1.0.0` and no maximum, meaning every supported
Synthesizer release can read them; a maximum is set only when a future release
genuinely drops support. Simulation data, generation inputs, and cache
archives are left unconstrained, since they are not Synthesizer-format files.
Nothing enforces these bounds yet; they are recorded so the downloader can
honour them when a real incompatibility first appears.

`known_bug` and `known_bug_description` record a defect found in a release
after it was published. Releases are immutable and stay resolvable, so a file
that turns out to be wrong is corrected by publishing a new release rather than
by editing the old one; anything still pinned to the old release then needs to
be told what is wrong with it. The description says what the defect is, whether
the data or only the metadata is affected, and that a corrected release exists.
This is deliberately a property of the release and not of the dataset, because
the same dataset's next release is clean.

`provenance_json` records how the published bytes came to exist: the HDF5
root attributes the file reports about itself (`date_created`,
`synthesizer_version`, `synthesizer_grids_version`) under an `hdf5` key, plus
any curated `source` describing the underlying scientific data. It is
retained for detail responses but is not intended for filtering. Download
locations are deliberately not recorded: the R2 path and SHA-256 already
identify the bytes, and a source URL for a service being retired would be
dead metadata on every release.

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
    has_spectra INTEGER NOT NULL DEFAULT 0
        CHECK (has_spectra IN (0, 1)),
    has_lines INTEGER NOT NULL DEFAULT 0
        CHECK (has_lines IN (0, 1)),
    wavelength_min REAL,
    wavelength_max REAL,
    wavelength_units TEXT,
    incident_release_id INTEGER REFERENCES releases(release_id)
);
```

Expected `grid_type` values include `sps`, `agn`, and `dust`; `dust` always
accompanies `data_type = dust_grid`. Initial
`emission_type` values include `incident`, `photoionised`, `dust_emission`, and
`dust_attenuation`; inventory validation may refine this vocabulary.

`has_spectra` and `has_lines` summarise the two JSON lists beside them so a
client can filter on what a grid actually contains. Not every grid carries
both: some hold line luminosities alone, and some hold only specific ionising
luminosities over their axes. Those are legitimate products, but a grid with
no spectra is useless for anyone wanting a spectrum, and answering that from
`available_spectra_json` would mean decoding JSON for every row.

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
