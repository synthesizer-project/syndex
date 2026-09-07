-- Make the presence of spectra and lines filterable.
--
-- available_spectra_json and available_lines_json already record what a grid
-- contains, but answering "which grids have no spectra?" meant decoding JSON
-- for every row. Grids holding only line luminosities, or only ionising
-- luminosities, are a normal product and need to be findable as such, so the
-- two facts worth filtering on become columns.

ALTER TABLE grid_metadata ADD COLUMN has_spectra INTEGER NOT NULL DEFAULT 0
    CHECK (has_spectra IN (0, 1));
ALTER TABLE grid_metadata ADD COLUMN has_lines INTEGER NOT NULL DEFAULT 0
    CHECK (has_lines IN (0, 1));

CREATE INDEX grid_metadata_content ON grid_metadata(has_spectra, has_lines);

-- Existing rows already carry the answer in their JSON.
UPDATE grid_metadata
SET has_spectra = CASE WHEN available_spectra_json IN ('[]', '') THEN 0 ELSE 1 END,
    has_lines = CASE WHEN available_lines_json IN ('[]', '') THEN 0 ELSE 1 END;
