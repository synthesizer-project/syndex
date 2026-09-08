-- Record the papers a file should be cited with.
--
-- A grid is not usable in a paper without knowing what to cite for it, and the
-- answer is rarely a single reference: a BPASS grid needs the BPASS model
-- paper, the paper the grid was released in, and the Cloudy release it was
-- run through. Nothing in the catalogue recorded any of that.
--
-- Citations attach to files rather than to datasets or models. A file is the
-- artifact somebody downloads and cites, and it is the level at which the
-- answer actually varies: two releases of one dataset can need different
-- references, and the c25.00 grids cite a different Cloudy release from their
-- c23.01 siblings despite sharing a model. Attaching at any coarser level
-- cannot express that.
--
-- Each paper is stored once and pointed at, so the release paper shared by
-- every grid is one row rather than a fact repeated 163 times.

CREATE TABLE citations (
    citation_id INTEGER PRIMARY KEY,
    -- The ADS bibcode, which is how contributors identify a paper and how
    -- duplicates are detected. Unique rather than the primary key because it
    -- changes: an arXiv bibcode becomes a journal one on publication, and ADS
    -- canonicalises. Junction rows must survive that.
    bibcode TEXT UNIQUE,
    doi TEXT,
    -- Verbatim, as supplied or as ADS returned it. This is the authoritative
    -- record and what a user ultimately wants back.
    bibtex TEXT NOT NULL,
    -- Extracted at ingest purely so that rendering a citation needs no BibTeX
    -- parser in the Worker or the portal.
    authors TEXT,
    title TEXT,
    year INTEGER,
    journal TEXT,
    added_at TEXT NOT NULL
);

CREATE TABLE file_citations (
    file_id INTEGER NOT NULL REFERENCES files(file_id),
    citation_id INTEGER NOT NULL REFERENCES citations(citation_id),
    -- Citation order, since "cite these four papers" has a conventional
    -- sequence: model first, then the release, then the processing code.
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (file_id, citation_id)
);

-- Answering "which files cite this paper?" is how the portal will offer to
-- list everything covered by a reference.
CREATE INDEX file_citations_citation ON file_citations(citation_id);

-- datasets.citations_json predates this and is empty on every row. It is left
-- in place deliberately: dropping a column the deployed Worker still selects
-- would break the API for however long separates applying this migration from
-- deploying the Worker. A later migration can remove it once no released
-- Worker reads it.
