# Syndicate

Synthesizer data catalogue, distribution service, publication tooling, and
future catalogue website. The name reflects the repository's role in curating
and distributing shared project data.

## Status

Initial production storage is provisioned in Western Europe:

- R2 bucket: `synthesizer-data` (Standard, private)
- D1 database: `synthesizer-database`
- D1 database ID: `6504c716-2065-4b31-8618-453ac12a1144`

Worker deployment and `data.synthesizer-project.org` remain pending. Interfaces
remain subject to discussion. Initial batch inspection/publication tooling and
the first D1 migration are implemented locally but have not been applied to the
remote database.

## Scope

This repository will own:

- Cloudflare R2, D1, and Worker configuration.
- Database migrations and public read API.
- Catalogue metadata and validation.
- HDF5 metadata extraction and publication tooling.
- Incremental migration from Box.
- Future catalogue website.

Syncretize generates grid files but does not own publication infrastructure.
Synthesizer owns only downloader integration and user-facing download
documentation.

## Planning Documents

- [`docs/plan.md`](docs/plan.md): architecture, ownership, API, and delivery.
- [`docs/schema.md`](docs/schema.md): R2 layout and D1 schema.
- [`docs/publishing.md`](docs/publishing.md): publication and Box migration.
