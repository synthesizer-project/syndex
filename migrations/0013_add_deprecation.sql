-- Let a whole dataset be retired, and say why anything was.
--
-- `releases.deprecated_at` has been here since the first migration and has
-- never been set: it marks one version as no longer the one to use, which is
-- the right grain for a file that was regenerated and the wrong one for a
-- dataset nobody should start using at all. A model that has been withdrawn,
-- or a grid kept only because old papers cite it, has no good release to
-- point at instead, so the flag belongs to the dataset.
--
-- Both are kept. A deprecated release says "use a newer release of this"; a
-- deprecated dataset says "use something else". Neither removes anything:
-- the bytes stay downloadable, because something already published may
-- depend on them.
--
-- A reason beside each, for the same reason `known_bug` has a description:
-- a flag with no explanation sends people to a maintainer to ask what it
-- means, and "superseded by bpass-2-3" is the whole of the answer.

ALTER TABLE datasets ADD COLUMN deprecated_at TEXT;
ALTER TABLE datasets ADD COLUMN deprecation_reason TEXT;
ALTER TABLE releases ADD COLUMN deprecation_reason TEXT;
