# Publishing and Migration

This maintainer procedure is provisional until publication tooling exists.

## Normal Publication

The publication command will:

1. Validate the input and identify its format.
2. Extract HDF5 metadata using Synthesizer grid conventions.
3. Apply curated display metadata, citations, licences, provenance, and
   corrections.
4. Calculate SHA-256 and size while reading.
5. Validate the complete catalogue record in memory.
6. Upload the content-addressed R2 object idempotently.
7. Verify the uploaded object.
8. Insert all catalogue rows in one D1 transaction.
9. Verify publication through the public API.

Selecting a current release must be explicit. Re-uploading an identical digest
must verify and reuse the object; any conflict must fail without overwriting.
Non-grid assets use the same file and release model without grid metadata.

R2 is authoritative for file bytes and D1 for catalogue metadata. CI tests and
deploys application code and schema migrations; it does not update catalogue
contents. Publication hosts use credentials scoped to the R2 bucket and D1
database.

R2 and D1 cannot share a transaction. Uploading and verifying R2 first ensures
D1 never references a missing object. If D1 registration fails, the unreferenced
object is harmless and an idempotent retry completes publication. Reconciliation
can report orphaned objects for later cleanup.

## Upload Interface

Install the Python package, then inspect a file or homogeneous directory without
contacting Cloudflare:

```bash
syndicate-upload PATH --data-type simulation_data --is-test --dry-run
```

Physical formats are detected from file contents. Recognized Synthesizer HDF5
grids receive `data_type = grid` automatically, but `grid_type` and
`emission_type` remain explicit scientific metadata. Other files require a
`data_type`. Directories may mix formats and data types.

Use a JSON metadata file for mixed batches or per-file overrides:

```json
{
  "defaults": {
    "is_test": true,
    "r2_prefix": "test-data"
  },
  "files": {
    "test_grid.hdf5": {
      "name": "stellar-test-grid",
      "grid": {
        "grid_type": "sps",
        "emission_type": "photoionised"
      },
      "set_current": true
    },
    "camels_snap.hdf5": {
      "name": "camels-snapshot-test-data",
      "data_type": "simulation_data"
    }
  }
}
```

```bash
syndicate-upload PATH --metadata metadata.json --dry-run
syndicate-upload PATH --metadata metadata.json
```

Metadata precedence is file override, command-line batch default, then metadata
file default. Dry run discovers, hashes, inspects, and validates every file. Any
validation failure aborts the whole batch before cloud access. During real
publication, individual transfer failures are reported after remaining files
have been attempted.

Real publication reads R2 credentials from `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`, and D1 credentials from `CLOUDFLARE_API_TOKEN`.
`CLOUDFLARE_ACCOUNT_ID`, `SYNTHESIZER_R2_BUCKET`, and
`SYNTHESIZER_D1_DATABASE_ID` override repository defaults. Set
`SYNTHESIZER_DATA_API_URL` to enable final public-API verification once the
Worker exists.

## Box Migration

Migration runs from HPC scratch one file at a time:

```text
Box download
    -> temporary file
    -> inspect and hash
    -> upload to R2
    -> verify object
    -> register metadata in D1
    -> record checkpoint
    -> remove temporary file
```

Peak scratch use is the largest individual file plus transfer overhead. The
migration must:

- Persist a checkpoint after every completed file.
- Resume without repeating verified work.
- Verify digest and size before skipping an existing object.
- Remove temporary files only after successful R2 verification.
- Retry interrupted transfers and report failures.
- Bound concurrency by available scratch capacity.
- Avoid changing current releases during bulk transfer.

Direct Box-to-R2 streaming is deferred because metadata extraction needs local
HDF5 access and the final path is unknown until hashing completes.

## Pilot

First migrate the five objects in the current Synthesizer `TestData` category:
the BPASS stellar test grid, QSOSED AGN test grid, CAMELS snapshot, CAMELS
subhalo catalogue, and SC-SAM history. These exercise multiple data types and
the existing mapping of two AGN test aliases onto one object. Verify extracted
metadata, API responses, local filenames, deduplication, and SHA-256 handling
before migrating another category. Measure serialized axis, line, and parameter
metadata during this pilot; normalize a field only if it approaches a D1 limit.

Production instrument files remain separate even when CI downloads them. Being
used by CI does not make an asset test data. Fixed CI selections remain
downloader-side collections unless request overhead becomes measurable.

## Credentials and Safety

Use credentials scoped to the required R2 bucket and D1 database. Never commit
credentials. D1 must never reference an absent R2 object, and Box remains
read-only during a comparison and transition period.
