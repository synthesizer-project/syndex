# Schema

R2 holds immutable file bytes. D1 holds everything else: what the files are,
which dataset each belongs to, what has been extracted from them, and who
submitted what.

The migrations in [`migrations/`](../migrations) are the executable schema and
the only authority. What follows is the same thing as it now stands, with the
columns later migrations added folded in and the comments stripped; SQLite
appends an added column to the end of the row, so column order here is logical
rather than physical.

## R2 layout

```text
{prefix}/{sha256}/{filename}
```

`prefix` is the `data_type` with underscores replaced by hyphens, under
`test-data/` when `is_test` is set, and can be overridden per publication with
`r2_prefix`.

```text
dust-grid/{sha256}/draine_li_dust_emission_grid_MW_3p1.hdf5
instrument/{sha256}/Euclid_NISP.hdf5
test-data/grid/{sha256}/qsosed-test_cloudy-c23.01-agn-test.hdf5
```

Objects are never overwritten: changed bytes give a new digest and a new path.
The hierarchy is administrative — classification lives in D1, and a deeper
path would duplicate it by hand and drift.

Submissions go to a separate bucket under `{upload_token}/`, and previews to
`preview/{sha256}/{name}.png` in the data bucket.

## Tables

```text
datasets ──< releases ──── files ──< file_citations >── citations
                │            │
                │            └── preview_path, preview_kind
                ├── grid_metadata ──> releases (incident_release_id)
                ├── grid_axes
                └── instruments

users ──< sessions
  │
  └──< submissions ──< submission_parts
             │
             └──> datasets (release_of_dataset_id)
```

Submissions are requests, not catalogue rows. Approving one records a
decision; publishing is a separate run of `syndex-upload`.

## Catalogue

### files

One immutable R2 object.

```sql
CREATE TABLE files (
    file_id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    r2_path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
    preview_path TEXT,
    preview_kind TEXT CHECK (preview_kind IN ('spectra', 'filters', 'ionising'))
);
```

- `format` is the physical format (`hdf5`, `zip`, …), independent of
  `data_type`: a grid and a CAMELS snapshot are both HDF5.
- Preview columns name a plot in R2 and say what it shows, so a page can
  caption it. Null where a file has nothing indicative to draw.

### datasets

One stable catalogue identity, across file updates.

```sql
CREATE TABLE datasets (
    dataset_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    data_type TEXT NOT NULL,
    current_release_id INTEGER REFERENCES releases(release_id),
    is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
    is_ci INTEGER NOT NULL DEFAULT 0 CHECK (is_ci IN (0, 1)),
    is_recommended INTEGER NOT NULL DEFAULT 0 CHECK (is_recommended IN (0, 1)),
    licence TEXT,
    citations_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

- `name` is catalogue identity, not a filename. It is what
  `synthesizer-download` resolves.
- `data_type`: `grid`, `dust_grid`, `instrument`, `simulation_data`,
  `generation_data`, `synference_data`, `reference_data`, `cache`.
- `dust_grid` is its own type, not a flavour of `grid`: separate prefix,
  separate tab, separate filters. Both still populate `grid_metadata` and
  `grid_axes`, because the HDF5 layout is shared.
- `is_test` means deliberately reduced and not science-grade. `is_ci` means
  Synthesizer's CI downloads it. Independent: the Draine & Li grids are
  `is_ci = 1, is_test = 0`.
- `licence` and `is_recommended` are curated and currently unset everywhere;
  they are where those decisions will go, not a signal to read yet.
- `citations_json` is superseded by `file_citations` and unused.

### releases

One published version, backed by one file.

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
    known_bug INTEGER NOT NULL DEFAULT 0 CHECK (known_bug IN (0, 1)),
    known_bug_description TEXT
);
```

- Superseded releases stay resolvable. Changing `datasets.current_release_id`
  is what publishes.
- Version bounds are stored without a leading `v`, to compare against
  `synthesizer.__version__`. Recorded but not yet enforced.
- `known_bug` belongs to the release, not the dataset: a defect is corrected by
  publishing a new release, and anything pinned to the old one needs telling.
- `provenance_json` holds the HDF5 root attributes the file reports about
  itself under `hdf5`, plus any curated `source`. Returned, never filtered on.

### grid_metadata

One row per grid release; no row for anything else.

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
    has_spectra INTEGER NOT NULL DEFAULT 0 CHECK (has_spectra IN (0, 1)),
    has_lines INTEGER NOT NULL DEFAULT 0 CHECK (has_lines IN (0, 1)),
    wavelength_min REAL,
    wavelength_max REAL,
    wavelength_units TEXT,
    incident_release_id INTEGER REFERENCES releases(release_id)
);
```

- `grid_type`: `sps`, `agn`, `dust`. `emission_type`: `incident`,
  `photoionised`, `dust_emission`, `dust_attenuation`.
- `has_spectra` and `has_lines` summarise the JSON lists beside them so the
  facets do not decode JSON per row. A grid may legitimately carry only lines,
  or only ionising luminosities.
- `incident_release_id` links a photoionised release to the incident release it
  was produced from.

### grid_axes

One row per axis, in file order.

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

Summary columns serve the range filters; `values_json` holds every value, for
detail responses and plots.

### instruments

One row per instrument release.

```sql
CREATE TABLE instruments (
    release_id INTEGER PRIMARY KEY REFERENCES releases(release_id),
    instrument_type TEXT NOT NULL CHECK (instrument_type IN (
        'photometric', 'photometric_imager', 'spectroscopic', 'ifu',
        'collection')),
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

- The five types are Synthesizer's instrument classes; `collection` carries the
  others in `members_json`. Metadata is read structurally out of the HDF5, not
  by importing Synthesizer.
- `capabilities_json` mirrors `InstrumentBase`'s capability properties.
- Bulk arrays (PSFs, noise maps) are never read: only presence, per-key shape
  and units are recorded, the same way spectra are not read into
  `grid_metadata`.
- `resolving_power` is null unless Synthesizer was given a constant value; a
  wavelength-dependent one is a callable and does not serialise.

### citations, file_citations

```sql
CREATE TABLE citations (
    citation_id INTEGER PRIMARY KEY,
    bibcode TEXT UNIQUE,
    doi TEXT,
    bibtex TEXT NOT NULL,
    authors TEXT,
    title TEXT,
    year INTEGER,
    journal TEXT,
    added_at TEXT NOT NULL
);

CREATE TABLE file_citations (
    file_id INTEGER NOT NULL REFERENCES files(file_id),
    citation_id INTEGER NOT NULL REFERENCES citations(citation_id),
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (file_id, citation_id)
);
```

- Citations attach to **files**, because that is the level at which the answer
  varies: two releases of one dataset can need different references, and grids
  processed through different Cloudy versions cite different papers.
- Each paper is stored once and shared, so a release paper cited by every grid
  is one row.
- `position` is citation order, by convention model, release, processing code.
- `bibcode` is unique but not the key: bibcodes change when a preprint is
  published, and a surrogate key makes that a one-field update.
- `bibtex` is verbatim from ADS and authoritative; the extracted fields exist
  so rendering needs no BibTeX parser.

## Contributions

### users, sessions

```sql
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    github_id INTEGER NOT NULL UNIQUE,
    login TEXT NOT NULL,
    name TEXT,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'pending'
        CHECK (role IN ('pending', 'contributor', 'reviewer', 'admin')),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    access_requested_at TEXT,
    access_request_note TEXT
);

CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY CHECK (length(token_digest) = 64),
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
```

- Identity is `github_id`, never `login`: logins are renameable and reusable.
- Roles are ordered, each doing everything the one before can — `pending` may
  browse and ask; `contributor` may submit; `reviewer` may decide submissions
  and grant `contributor`; `admin` may grant `reviewer` and `admin`.
- `access_requested_at` is an open request, cleared on promotion. A column
  rather than a table: one request at a time, and no interesting history.
- Sessions store the SHA-256 of the token, never the token, so the table is
  worth nothing to anyone who reads it. Browser cookie and CLI bearer token are
  the same row.

### submissions, submission_parts

```sql
CREATE TABLE submissions (
    submission_id INTEGER PRIMARY KEY,
    submitted_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'approved', 'rejected')),
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewer_note TEXT,

    -- what is being asked for
    user_id INTEGER REFERENCES users(user_id),
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    data_type TEXT NOT NULL,
    licence TEXT,
    citations TEXT,
    notes TEXT,
    submitter_name TEXT NOT NULL,
    submitter_email TEXT NOT NULL,
    release_of_dataset_id INTEGER REFERENCES datasets(dataset_id),

    -- the file
    upload_token TEXT NOT NULL UNIQUE,
    upload_id TEXT,
    filename TEXT,
    r2_key TEXT,
    uploaded_at TEXT,
    uploaded_size_bytes INTEGER,
    declared_sha256 TEXT
        CHECK (declared_sha256 IS NULL OR length(declared_sha256) = 64),

    -- what the checker made of it
    detected_data_type TEXT,
    validation_state TEXT CHECK (validation_state IS NULL
        OR validation_state IN ('running', 'passed', 'failed', 'ambiguous')),
    validation_report_json TEXT,
    validated_at TEXT,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64)
);

CREATE TABLE submission_parts (
    submission_id INTEGER NOT NULL REFERENCES submissions(submission_id),
    part_number INTEGER NOT NULL CHECK (part_number > 0),
    etag TEXT NOT NULL,
    PRIMARY KEY (submission_id, part_number)
);
```

- `upload_token` is minted at registration and is what authorises a write. It
  names one prefix of the submissions bucket.
- `filename` and `uploaded_size_bytes` are read back from R2, not taken from
  the form, so nothing depends on the submitter describing the file correctly.
- `upload_id` and `submission_parts` are the in-progress multipart upload:
  parts arrive through the Worker, are recorded by number, and are assembled on
  completion. Both are spent once the file is complete.
- `sha256` is computed by the validation runner and is what finds duplicates.
  `declared_sha256` is whatever the submitter claimed, and is not checked here.
- `release_of_dataset_id` set means this is a new release of an existing
  dataset rather than a new one.

## Indexes

```sql
CREATE INDEX releases_dataset_id ON releases(dataset_id);
CREATE INDEX datasets_classification ON datasets(data_type, is_test);
CREATE INDEX datasets_is_ci ON datasets(is_ci);
CREATE INDEX grid_metadata_classification ON grid_metadata(grid_type, emission_type);
CREATE INDEX grid_metadata_content ON grid_metadata(has_spectra, has_lines);
CREATE INDEX instruments_instrument_type ON instruments(instrument_type);
CREATE INDEX file_citations_citation ON file_citations(citation_id);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX submissions_pending ON submissions(state, submitted_at);
CREATE INDEX submissions_user ON submissions(user_id, state);
CREATE INDEX releases_known_bug ON releases(known_bug) WHERE known_bug = 1;
CREATE INDEX files_preview ON files(preview_path) WHERE preview_path IS NOT NULL;
CREATE INDEX submissions_sha256 ON submissions(sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX submissions_release_of ON submissions(release_of_dataset_id)
    WHERE release_of_dataset_id IS NOT NULL;
CREATE INDEX submissions_reviewed_by ON submissions(reviewed_by, reviewed_at)
    WHERE reviewed_by IS NOT NULL;
CREATE INDEX users_waiting ON users(access_requested_at)
    WHERE access_requested_at IS NOT NULL;
CREATE UNIQUE INDEX submissions_pending_name ON submissions(name)
    WHERE state = 'pending';
```

| Index | Serves |
|---|---|
| `releases_dataset_id` | A dataset's release history |
| `datasets_classification` | Every tab, which is a `data_type` filter |
| `datasets_is_ci` | The CI badge, and Synthesizer's fixtures |
| `grid_metadata_classification` | The stellar/AGN and emission facets |
| `grid_metadata_content` | The spectra and lines facets |
| `instruments_instrument_type` | The instrument type facet |
| `file_citations_citation` | Which files cite one paper |
| `sessions_user` | Signing out everywhere |
| `submissions_pending` | The review queue, oldest first |
| `submissions_user` | Somebody's own submissions |
| `releases_known_bug` | Flagged releases; partial, few rows qualify |
| `files_preview` | Reconciling previews against the bucket |
| `submissions_sha256` | Duplicate detection against the queue |
| `submissions_release_of` | Other submissions against one dataset |
| `submissions_reviewed_by` | What a reviewer has decided |
| `users_waiting` | Who is waiting for access |
| `submissions_pending_name` | A constraint, not a lookup: one pending submission per name, so two contributors cannot collide in a reviewer's lap |

`grid_axes` has no index: it is small enough that an axis filter is an `EXISTS`
subquery over a scan.

## Conventions

- **Times** are ISO-8601 UTC text (`2026-09-17T12:34:56.789Z`). SQLite has no
  date type, and this sorts and compares correctly as text.
- **Booleans** are `INTEGER` 0/1 with a `CHECK`.
- **`*_json` columns** hold whole JSON documents, for things that vary by model
  or are only ever returned. Promote a field to a column when it needs
  filtering or indexing.
- **Keys** are surrogate integers. Natural identifiers (`sha256`, `bibcode`,
  `github_id`, `name`) are `UNIQUE` instead, so a corrected one is a field
  update rather than a rewrite of every row referring to it.
- **Deletes** do not happen. Files, releases and citations accumulate;
  correction means a new row and a moved `current_release_id`.

## Recovery

D1 backups and time travel cover normal operation. Scientific metadata can be
re-extracted from the files, so what is worth exporting before bulk migration
is the curated part: descriptions, licences, `is_recommended`, citations.
