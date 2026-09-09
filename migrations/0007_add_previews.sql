-- Record an indicative preview image for each file.
--
-- A table of axis ranges does not answer "what does this grid look like", and
-- that is the first thing anyone wants to know. One plot per file answers it
-- immediately: every spectrum in the grid for a grid, the filter bandpasses
-- for an instrument, a map of ionising luminosity for the grids that carry
-- nothing else.
--
-- The image itself lives in R2 alongside the data, content addressed under a
-- preview/ prefix, because it is bytes and D1 is for metadata. Only the path
-- is recorded here.
--
-- Previews attach to files rather than datasets for the same reason citations
-- do: the file is what the plot depicts, and a corrected or superseded file
-- needs its own plot rather than inheriting a stale one.

ALTER TABLE files ADD COLUMN preview_path TEXT;

-- What the plot actually shows, so a page can caption it without inferring
-- from the data type. Not every file has a preview: the 62 datasets that are
-- neither grids nor instruments have nothing indicative to draw, and a few
-- grids hold no plottable quantity at all. Those keep both columns null,
-- which is a deliberate absence rather than a gap to backfill.
ALTER TABLE files ADD COLUMN preview_kind TEXT
    CHECK (preview_kind IN ('spectra', 'filters', 'ionising'));

CREATE INDEX files_preview ON files(preview_path) WHERE preview_path IS NOT NULL;
