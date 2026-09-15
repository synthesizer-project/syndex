-- Let a submission be a new release of a dataset that is already published.
--
-- Until now every submission was a new dataset, and the name check enforced
-- it: a catalogue name already in `datasets` was refused outright. That is the
-- right answer for somebody about to publish a second, separate copy of an
-- existing grid, and the wrong one for the commonest reason anybody submits at
-- all -- a corrected or regenerated version of a file that is already there.
-- With no way to say "this replaces that", the only routes open were to invent
-- a slightly different name, which is how a catalogue ends up with
-- `bpass-2p2p1-fixed` and `bpass-2p2p1-fixed-2`, or to email a maintainer.
--
-- Releases are what the schema already has for this: `releases` holds many
-- rows per dataset, and `datasets.current_release_id` names the one people get
-- by default. `syndex-upload` keys on the dataset name and adds a release when
-- it finds one, so nothing about publishing changes. What was missing was the
-- portal being able to say which dataset a submission belongs to.
--
-- A foreign key rather than the name. The name is what the publishing command
-- needs and what the pages show, and it is reachable by joining; storing it
-- instead would leave a dangling string if a dataset were ever renamed or
-- removed, and this way the database refuses to record a release of something
-- that does not exist.

ALTER TABLE submissions ADD COLUMN release_of_dataset_id INTEGER
    REFERENCES datasets(dataset_id);

-- "Is anybody submitting a new release of this?" -- asked on a dataset's own
-- page eventually, and partial because the overwhelming majority of
-- submissions are new datasets and have nothing here.
CREATE INDEX submissions_release_of
    ON submissions(release_of_dataset_id)
    WHERE release_of_dataset_id IS NOT NULL;
