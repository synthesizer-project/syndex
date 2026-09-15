-- Give the portal accounts, so that submitting is something a known person
-- does rather than something anyone can do.
--
-- Until now the portal had one credential: a shared username and password on
-- the review page, and nothing at all on the submission form, which was why
-- the form had to stay shut. Turnstile can tell a script from a person but not
-- one person from a thousand, so the only bound on how much unreviewed data
-- could be pushed into R2 was how long somebody was willing to sit there.
-- An account is what makes a per-person limit expressible, and what lets a
-- reviewer answer a question by replying to the person who asked it.
--
-- Identity comes from GitHub. Synthesizer is developed there and its
-- contributors are already there, so the alternative -- storing passwords,
-- hashing them correctly, sending verification and reset mail, and running an
-- email provider to do it -- would be a large amount of security-sensitive
-- code written to establish something GitHub has already established.
--
-- Nothing here is required to read the catalogue. Browsing, searching and
-- downloading stay anonymous; an account is needed only to contribute, and to
-- review what has been contributed.

CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,

    -- GitHub's numeric id, not the login, is the identity. Logins are
    -- renameable and reusable: someone who changes theirs is the same person
    -- and must keep their role and their submissions, and someone who takes a
    -- freed-up login is a different person and must not inherit them.
    github_id INTEGER NOT NULL UNIQUE,
    -- Recorded as it was at the last sign-in, for display and for a reviewer
    -- to recognise who they are looking at. Not an identifier.
    login TEXT NOT NULL,
    name TEXT,
    -- May be null: GitHub accounts can keep their address private, and the
    -- catalogue has no business insisting otherwise. The submission form asks
    -- for a contact address separately and prefills this when there is one.
    email TEXT,

    -- Four roles, ordered. Each can do everything the one before it can:
    --
    --   pending      may browse, and may ask for access. The state every new
    --                account starts in, since an account that could submit on
    --                creation would leave the queue as open as it was before.
    --   contributor  may submit datasets.
    --   reviewer     may read the queue, decide submissions, and promote a
    --                pending account to contributor.
    --   admin        may also grant the reviewer and admin roles.
    --
    -- The split between the last two is deliberate. Letting someone submit is
    -- a small decision a reviewer should not have to escalate; letting someone
    -- publish into the catalogue is not.
    role TEXT NOT NULL DEFAULT 'pending'
        CHECK (role IN ('pending', 'contributor', 'reviewer', 'admin')),

    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,

    -- An outstanding request for submit access, and what the person said when
    -- they made it. A column rather than a table: a person has at most one
    -- request open at a time, and its history is not interesting once it has
    -- been granted. Cleared on promotion.
    access_requested_at TEXT,
    access_request_note TEXT
);

-- The two questions the portal asks of this table: who holds this session,
-- and who is waiting. The second is a partial index because the waiting are
-- always a handful and everyone else is permanently irrelevant to it.
CREATE INDEX users_waiting ON users(access_requested_at)
    WHERE access_requested_at IS NOT NULL;

-- Sessions are rows rather than signed cookies carrying the role.
--
-- A signed cookie needs no table and no read, but it states the role as it was
-- when it was issued, so promoting somebody would not take effect until they
-- signed out and demoting somebody would not take effect at all. Roles here
-- change by design, and a revocation that does not revoke is not one. The role
-- is therefore read from `users` on every request, which is one indexed join
-- on a page that already runs several statements.
--
-- The token is stored as its SHA-256 digest, never raw. What the browser holds
-- is a bearer credential, so a copy of this table should not be enough to sign
-- in as anybody in it.
CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY CHECK (length(token_digest) = 64),
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Signing out everywhere, and clearing a demoted account's sessions, are both
-- "every session for this user".
CREATE INDEX sessions_user ON sessions(user_id);
