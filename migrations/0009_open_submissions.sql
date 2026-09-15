-- Let the submission queue accept files, and bound what it can be made to
-- hold.
--
-- The write path existed and was deliberately shut, because as built it was
-- unbounded storage that anyone could fill: the presigned PUT signed no
-- content-length, so the advertised size limit was advertising; the URL was
-- signed for whatever filename it was handed, so one token could write any
-- number of objects; and viewing a submission page minted twelve hours of
-- prefix-scoped write credentials. See "Why it is shut" in docs/website.md.
--
-- Most of that is not fixed here so much as removed. The bytes now arrive
-- through the Worker in parts and it writes them to R2 itself, so it chooses
-- the key rather than signing whatever it is given, and the ceiling is a part
-- count it enforces rather than a header it hopes was signed correctly. There
-- are no temporary credentials to leak because none are minted.
--
-- What is left needs recording: which multipart upload a submission is part
-- way through, which parts have landed, and who is responsible for it.

-- Who submitted. Nullable because the rows that predate accounts have no
-- answer, and inventing one would be worse than admitting it. Every new
-- submission has one, which is what makes a per-person limit expressible at
-- all: before accounts there was nothing to count against.
ALTER TABLE submissions ADD COLUMN user_id INTEGER REFERENCES users(user_id);

-- The R2 multipart upload this submission's file is arriving through, while
-- it is arriving. Cleared on completion: its presence is what distinguishes a
-- transfer in progress from one that never started.
ALTER TABLE submissions ADD COLUMN upload_id TEXT;

-- What `syndex check` made of the file. Written by the validation run rather
-- than by the submitter, and null until one has happened.
--
-- `detected_data_type` is deliberately separate from `data_type`: one is what
-- the contributor says the file is and the other is what the file says it is,
-- and a reviewer wants to see both, particularly when they disagree. A file
-- that identifies nothing leaves this null and is categorised by hand, which
-- is the 'ambiguous' state rather than a failure.
ALTER TABLE submissions ADD COLUMN detected_data_type TEXT;
ALTER TABLE submissions ADD COLUMN validation_state TEXT
    CHECK (validation_state IS NULL
           OR validation_state IN ('running', 'passed', 'failed', 'ambiguous'));
ALTER TABLE submissions ADD COLUMN validation_report_json TEXT;
ALTER TABLE submissions ADD COLUMN validated_at TEXT;

-- Counting what somebody already has open, which is the cap that stops one
-- account filling the bucket on its own.
CREATE INDEX submissions_user ON submissions(user_id, state);

-- Which parts of a multipart upload have landed, and what R2 called each one.
--
-- A table rather than a JSON column on the submission, because a client is
-- free to send parts concurrently and two of them finishing at once would
-- otherwise race on a read-modify-write of the same row. A primary key on the
-- pair also makes re-sending a part idempotent, which is what makes a retry
-- after a dropped connection safe rather than a way to end up with two
-- entries for part 7.
CREATE TABLE submission_parts (
    submission_id INTEGER NOT NULL REFERENCES submissions(submission_id),
    part_number INTEGER NOT NULL CHECK (part_number > 0),
    etag TEXT NOT NULL,
    PRIMARY KEY (submission_id, part_number)
);
