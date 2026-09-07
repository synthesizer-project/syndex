-- Hold contributed datasets until a human has read them.
--
-- A submission is metadata plus the bytes, and a request for a maintainer to
-- check and publish them. It is deliberately separate from `datasets`:
-- nothing here has been validated, hashed, opened, or agreed to, and a
-- rejected submission should leave no trace in the catalogue proper.
--
-- The bytes never pass through the Worker. A submission is registered first,
-- which mints an unguessable upload token and the one R2 key that token is
-- allowed to write, and the file then goes straight to the submissions
-- bucket: under 1 GiB from the browser through a presigned PUT, above it with
-- an S3 client driven by prefix-scoped temporary credentials. 233 of the 241
-- datasets in the catalogue are under 1 GiB, and the eight that are not are
-- grids that live on an HPC filesystem where such a client already exists.
--
-- Submitters have no account. Every submission is read by a person before
-- anything is published, so the review is the gate; the columns describing a
-- submitter exist so a reviewer can ask a question and credit the work.
--
-- Approving records a decision. It does not publish: publication stays with
-- the tooling that opens the HDF5, verifies the digest, and registers R2 and
-- D1 in one transaction.

CREATE TABLE submissions (
    submission_id INTEGER PRIMARY KEY,
    submitted_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'approved', 'rejected')),
    reviewed_at TEXT,
    reviewer_note TEXT,

    -- What the contributor is asking to have published.
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    data_type TEXT NOT NULL,
    licence TEXT,
    citations TEXT,

    -- The file. `upload_token` is minted at registration and is the only
    -- thing that authorises a write; it names a prefix of the submissions
    -- bucket, and the submitter may put exactly one file under it. What
    -- actually arrived is discovered by listing that prefix, so nothing here
    -- depends on the submitter having described the file correctly, and the
    -- filename and size are recorded from R2 rather than from a form.
    upload_token TEXT NOT NULL UNIQUE,
    filename TEXT,
    r2_key TEXT,
    uploaded_at TEXT,
    uploaded_size_bytes INTEGER,

    -- What the submitter says the file hashes to, if they said. Unchecked
    -- here: the digest is verified where the bytes are opened, by the same
    -- publishing path that verifies every other release.
    declared_sha256 TEXT
        CHECK (declared_sha256 IS NULL OR length(declared_sha256) = 64),

    submitter_name TEXT NOT NULL,
    submitter_email TEXT NOT NULL,
    notes TEXT
);

-- The queue is read as "what is waiting", oldest question first.
CREATE INDEX submissions_pending ON submissions(state, submitted_at);

-- Two people submitting the same name at once is a collision a reviewer
-- should never have to untangle by hand, so only one may be pending.
CREATE UNIQUE INDEX submissions_pending_name ON submissions(name)
    WHERE state = 'pending';
