# Architecture and Delivery Plan

This document records agreed design decisions and unfinished work. For current
commands and operational warnings, see [publishing.md](publishing.md).

## Goal

Replace the Box-hosted collection with one catalogue and distribution service
for grids, instruments, test data, generation data, and synference data. Users
should be able to discover, inspect, download, and verify data without first
opening large HDF5 files.

## Architecture

```text
Synthesizer downloader       Catalogue website
          |                         |
          +-------- HTTPS ----------+
                      |
              Cloudflare Worker
                /           \
              D1             R2
          catalogue        files
```

Phase 1 uses one read-only Worker, one D1 database, and one R2 Standard bucket
under `synthesizer-project.org`. Publication is a local or HPC batch operation,
not an always-on service.

The website is Phase 2 but lives in this repository so API and frontend can
evolve together. It consumes the same public API as Synthesizer.

## Ownership

This repository owns:

- Cloudflare deployment and database migrations.
- Worker API and future website.
- Catalogue metadata and validation.
- HDF5 inspection, R2 upload, and Box migration tooling.
- Maintainer deployment and publication documentation.

Syncretize owns grid generation and HDF5 writing conventions. This repository
reads those files without making Syncretize responsible for storage or service
deployment.

Synthesizer owns:

- Existing `synthesizer-download` aliases, groups, flags, and destinations.
- API resolution, streamed downloads, SHA-256 verification, and atomic file
  installation.
- User-facing download documentation.

## Publication Model

```text
local/HPC file
    -> validate and extract metadata
    -> calculate SHA-256
    -> upload immutable R2 object
    -> verify upload
    -> register metadata in one D1 transaction
    -> verify through the public API
```

R2 is authoritative for immutable file bytes. D1 is authoritative for
catalogue metadata and publication state. Publication tooling performs both
operations directly and idempotently; CI tests and deploys code and schema but
does not publish catalogue entries.

R2 and D1 cannot share a transaction, so files are uploaded and verified before
D1 is changed. A D1 failure can leave an unreferenced R2 object but can never
leave D1 pointing to a missing object. Retrying completes registration, and a
later reconciliation command can report orphaned objects.

## API

Implemented, and documented in [api.md](api.md):

```text
GET /v1/datasets
GET /v1/datasets/{name}
GET /v1/releases/{id}/download
```

Deferred until the catalogue website needs them, since they serve browsing
rather than downloading:

```text
GET /v1/datasets/{name}/releases
GET /v1/releases/{id}
GET /v1/facets
```

Responses support catalogue filtering, cursor pagination, CORS, ETags, and
appropriate cache headers. Files stream from R2 through the Worker, keeping the
bucket private. The Worker never parses HDF5. The dataset detail response
assembles the complete stored metadata from D1, so clients receive the useful
output a manifest would have provided without a second persisted
representation.

## Delivery Order

1. **Done:** schema vocabulary settled against the pilot, including
   `dust_grid` as a type distinct from `grid`.
2. **Done:** D1 migration applied locally and to the remote database.
3. **Done:** HDF5 inspection and transactional publication CLI.
4. **Done:** test-data pilot published; nine objects in R2 and nine datasets in
   D1, each with a current release.
5. **Done:** read-only Worker deployed at `data.synthesizer-project.org`.
6. **Next:** integrate test paths in `synthesizer-download`.
7. Migrate remaining categories incrementally and update their downloader paths.
8. Compare catalogues and retain Box through a transition period.
9. Build the catalogue website against the stable API.

## Cost and Operational Constraints

- Keep large immutable files in R2.
- Keep catalogue metadata, including complete grid-axis values, in D1.
- Serve metadata and downloads through one Worker.
- Cache immutable content at the edge.
- Use batch publication rather than runtime jobs.
- Add queues, search infrastructure, or scheduled reconciliation only when
  measured needs justify them.

## Deferred

Phase 1 excludes an ORM, write API, authentication service, queue, separate
search engine, persisted metadata manifests, browser-side HDF5 parsing,
spectral previews, MCP endpoint, and recommendation engine.
