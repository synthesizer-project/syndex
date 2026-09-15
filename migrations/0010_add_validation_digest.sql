-- Record the digest of what actually arrived, computed rather than claimed.
--
-- `declared_sha256` was what a submitter typed into the form, unchecked, and
-- the form asked for it so that a truncated transfer could be spotted. Almost
-- nobody is going to hash 30 GB by hand to fill in an optional box, and the
-- ones who would are not the ones whose uploads break, so the field was
-- removed: the sizes answer the same question automatically, since the
-- browser knows what it set out to send and R2 knows what it holds.
--
-- What is worth having is a digest nobody had to be asked for. The validation
-- run already reads every byte of the file to check it, so hashing costs it
-- nothing, and the result is worth more than truncation-catching:
--
--   * `files.sha256` is NOT NULL UNIQUE, so publication needs one anyway and
--     this is it, computed once instead of twice.
--   * It answers "have we already got these exact bytes?" -- against what is
--     published and against everything else waiting -- which is the one
--     question that can end a review before it starts.
--
-- `declared_sha256` is left in place rather than dropped. Nothing writes it
-- now, the rows that have one are telling the truth about what they were
-- told, and dropping a column a deployed Worker might still select is a way
-- to break the portal for however long separates this migration from the
-- deploy that stops selecting it.

ALTER TABLE submissions ADD COLUMN sha256 TEXT
    CHECK (sha256 IS NULL OR length(sha256) = 64);

-- Finding the twin of a submission, in the catalogue and in the queue. Both
-- halves of "have we seen these bytes before" are one lookup each.
CREATE INDEX submissions_sha256 ON submissions(sha256)
    WHERE sha256 IS NOT NULL;
