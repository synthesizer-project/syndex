-- Record whether an approved submission has been published, and how.
--
-- Approving used to record a decision and nothing else: publishing was a
-- separate run of `syndex-upload` by whoever approved, and nothing noticed when
-- it never happened. Two grids sat approved for a week with nothing in the
-- catalogue, and the review page said they were done.
--
-- Approving now asks a GitHub Actions run to publish the file, the same way an
-- upload asks one to validate it, and these columns are what that run reports.
-- Kept separate from `state`: "approved" is a person's decision and is never
-- undone, where publishing is a machine's attempt and can fail and be retried.
--
-- Null on every row that predates it, and on an approved submission that
-- could not be sent to a runner (no type chosen, or runs not configured): the
-- review page then shows the commands to publish it by hand.

ALTER TABLE submissions ADD COLUMN publication_state TEXT
    CHECK (publication_state IS NULL
           OR publication_state IN ('running', 'published', 'failed'));
ALTER TABLE submissions ADD COLUMN publication_report_json TEXT;
ALTER TABLE submissions ADD COLUMN published_at TEXT;

-- Which run the current state belongs to, and when it was asked for. A report
-- is only taken from the run named here, so one from a run that was replaced
-- cannot overwrite the state of the run that replaced it; and a run that never
-- reports back can be asked for again once it has had longer than the
-- workflow's own time limit.
ALTER TABLE submissions ADD COLUMN publication_attempt TEXT;
ALTER TABLE submissions ADD COLUMN publication_started_at TEXT;
