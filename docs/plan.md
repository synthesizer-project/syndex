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

Phase 1 uses one Worker, one D1 database, and one R2 Standard bucket under
`synthesizer-project.org`. The `/v1` API is read-only; the portal's submission
and review queue is the one path that writes. Publication is a local or HPC
batch operation, not an always-on service.

The website is Phase 2 but lives in this repository so API and frontend can
evolve together. It shares the Worker's D1 and R2 bindings and queries them in
process rather than calling `/v1` over HTTP.

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

## Publication model

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
GET /v1/datasets/{name}/releases
GET /v1/releases/{id}
GET /v1/releases/{id}/download
GET /v1/releases/{id}/preview.png
GET /v1/releases/{id}/citations.bib
```

A facets endpoint was considered for browsing rather than downloading, and is
not being built. The portal server-renders its pages and computes facet counts
from D1 directly, so an endpoint with no caller outside the site would be
speculative. See `website.md`.

Responses support catalogue filtering, cursor pagination, CORS, ETags, and
appropriate cache headers. Files stream from R2 through the Worker, keeping the
bucket private. The Worker never parses HDF5. The dataset detail response
assembles the complete stored metadata from D1, so clients receive the useful
output a manifest would have provided without a second persisted
representation.

## Delivery order

1. **Done:** schema vocabulary settled against the pilot, including
   `dust_grid` as a type distinct from `grid`.
2. **Done:** D1 migration applied locally and to the remote database.
3. **Done:** HDF5 inspection and transactional publication CLI.
4. **Done:** the whole catalogue published; 244 datasets and 248 releases in
   D1, backed by 430 objects and 168.3 GiB in R2.
5. **Done:** read-only Worker deployed at `data.synthesizer-project.org`.
6. **Done:** `synthesizer-download` resolves datasets through the API rather
   than through Box links.
7. **Done:** the portal, on the same Worker at `/syndex`, reading D1
   through the binding rather than through its own API. See
   [website.md](website.md).
8. **Next:** retire the Box collection, once the transition period has run.

## Cost and operational constraints

- Keep large immutable files in R2.
- Keep catalogue metadata, including complete grid-axis values, in D1.
- Serve metadata and downloads through one Worker.
- Cache immutable content at the edge.
- Use batch publication rather than runtime jobs.
- Add queues, search infrastructure, or scheduled reconciliation only when
  measured needs justify them.

## Deferred

Phase 1 excludes an ORM, write API, authentication service, queue, separate
search engine, persisted metadata manifests, browser-side HDF5 parsing, MCP
endpoint, and recommendation engine.
