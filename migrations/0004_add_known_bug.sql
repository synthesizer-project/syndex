-- Record known defects against the release that carries them.
--
-- Some published files have real problems that were only found after
-- publication: an axis whose Units attribute is dimensionally impossible, or
-- axis names that violate the plural convention the rest of the catalogue
-- follows. A corrected file supersedes the old one, but the old release stays
-- in the catalogue because releases are immutable and something may already
-- depend on it.
--
-- Anyone still resolving an old release therefore needs to be told what is
-- wrong with it, which makes this a property of the release rather than of the
-- dataset: the same dataset's next release is clean.

ALTER TABLE releases ADD COLUMN known_bug INTEGER NOT NULL DEFAULT 0
    CHECK (known_bug IN (0, 1));
ALTER TABLE releases ADD COLUMN known_bug_description TEXT;

-- Flagged releases are the rare case and are queried as a set, both to warn
-- a resolving client and to list them in the portal, so the index is partial.
CREATE INDEX releases_known_bug ON releases(known_bug) WHERE known_bug = 1;
