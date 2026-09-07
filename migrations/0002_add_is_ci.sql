-- Separate "used by CI" from "deliberately reduced".
--
-- is_test originally conflated two independent facts: that a file is a
-- reduced fixture, and that CI downloads it. Production data such as the
-- Draine & Li dust grids and the Euclid NISP instrument cache are fetched by
-- CI while being complete, science-grade files, so one flag could not
-- describe both. is_ci now records what CI downloads, leaving is_test to mean
-- what it always should have: deliberately reduced or incomplete, and not
-- suitable for science.

ALTER TABLE datasets ADD COLUMN is_ci INTEGER NOT NULL DEFAULT 0
    CHECK (is_ci IN (0, 1));

CREATE INDEX datasets_is_ci ON datasets(is_ci);
