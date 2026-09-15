-- Record who decided a submission, not only when.
--
-- `reviewed_at` and `reviewer_note` have been here since submissions were,
-- and between them they say a decision happened and what was said about it.
-- Neither says who made it. That was fine while the review page was guarded
-- by one shared password -- there was nothing to record, since "whoever knew
-- the password" is not an answer -- but roles replaced that precisely so a
-- decision could be attributable, and the column that would attribute it was
-- never added.
--
-- It is wanted in two places. An account page should be able to show somebody
-- what they have reviewed, which is the only view of their own work they have;
-- and a queue where two reviewers disagree about a submission is one where
-- knowing which of them said what is the difference between a conversation and
-- an argument with the database.
--
-- Nullable, and null on every row that predates it. Those decisions were made
-- by somebody holding a shared password, and inventing an account to hang them
-- on would be recording a guess as a fact.

ALTER TABLE submissions ADD COLUMN reviewed_by INTEGER
    REFERENCES users(user_id);

-- "What have I reviewed?", which is the account page's question and is asked
-- newest first.
CREATE INDEX submissions_reviewed_by
    ON submissions(reviewed_by, reviewed_at)
    WHERE reviewed_by IS NOT NULL;
