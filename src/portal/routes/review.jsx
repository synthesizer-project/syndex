/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Reviewing: the queue, deciding a submission, and granting access.
 *
 * Both halves of a reviewer's job, together because they are the same queue
 * -- a person waiting for access is as much a thing to attend to as a file
 * waiting to be read, and the review page shows them side by side.
 *
 * Deciding is recorded, not acted on. Approving a submission publishes
 * nothing: that stays a deliberate run of `syndex-upload` by somebody who
 * has the file in front of them.
 */

import { Hono } from "hono";

import { endSessions } from "../data/auth.js";
import { tabCounts } from "../data/catalogue.js";
import { duplicateOf } from "../data/validation.js";
import { ACCOUNTS_SHOWN, Accounts } from "../pages/people.jsx";
import { PreviousSubmissions, Review, SubmissionReview } from "../pages/review.jsx";
import { NotFound } from "../pages/refusals.jsx";
import { page, requireRole } from "./respond.jsx";

/** The routes this module contributes, mounted by `app.jsx`. */
export const routes = new Hono();

// The review queue was guarded by one shared username and password, which
// said that somebody with the credential was reviewing and never which
// somebody. Roles replace it: a decision is now attributable, and granting or
// withdrawing the ability to make one does not mean telling everybody a new
// password.
routes.use("/review", requireRole("reviewer"));
routes.use("/review/*", requireRole("reviewer"));

/**
 * Everything the review queue shows, gathered the same way however it is
 * reached.
 *
 * A decision re-renders the queue, so both routes need the identical set; a
 * helper is what stops them drifting apart when one gains a column.
 *
 * Only what is waiting is fetched in full. Settled submissions are counted
 * and the last few named, because the queue is a way in to the things that
 * need deciding and the rest is a page of its own.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {Promise<object>} Counts, what is waiting, and who is waiting.
 */
async function reviewState(c) {
  const [counts, submissions, decided, people, accounts] = await Promise.all([
    tabCounts(c.env.DB),
    // Only those with a file. A submission registered and then abandoned is
    // not something a reviewer can do anything about, and a queue that fills
    // with them is one nobody trusts to be a list of work. The contributor
    // still sees theirs, marked as having sent nothing.
    c.env.DB.prepare(
      `SELECT s.*,
              EXISTS (SELECT 1 FROM files f WHERE f.sha256 = s.sha256)
                AS duplicate
       FROM submissions s
       WHERE s.state = 'pending' AND s.uploaded_at IS NOT NULL
       ORDER BY s.submitted_at LIMIT 100`,
    ).all(),
    c.env.DB.prepare(
      `SELECT submission_id, name, state, reviewed_at FROM submissions
       WHERE state != 'pending' ORDER BY reviewed_at DESC LIMIT 5`,
    ).all(),
    // Everyone waiting, and the first page of everyone who holds a role. The
    // queue is the point of this page, so the account list is cut short here
    // and continues on one of its own rather than pushing the queue down.
    c.env.DB.prepare(
      `SELECT user_id, login, name, role, created_at, access_requested_at,
              access_request_note
       FROM users
       WHERE access_requested_at IS NOT NULL OR role != 'pending'
       ORDER BY access_requested_at IS NULL, access_requested_at, login
       LIMIT ?`,
    )
      .bind(ACCOUNTS_SHOWN + 1)
      .all(),
    // Split by outcome rather than totalled. "Nine decided" says how busy the
    // queue has been; "seven approved, two rejected" says what happens to a
    // submission, which is the thing anybody looking at this wants to know.
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role != 'pending') AS accounts,
         (SELECT COUNT(*) FROM submissions WHERE state = 'approved')
           AS approved,
         (SELECT COUNT(*) FROM submissions WHERE state = 'rejected')
           AS rejected`,
    ).first(),
  ]);

  return {
    counts,
    submissions: submissions.results,
    recent: decided.results,
    people: people.results,
    accountCount: accounts.accounts,
    approvedCount: accounts.approved,
    rejectedCount: accounts.rejected,
  };
}

/**
 * Everyone who has ever signed in.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {Promise<object[]>} The accounts, those with a role first.
 */
function allAccounts(c) {
  return c.env.DB.prepare(
    `SELECT user_id, login, name, role, created_at, last_seen_at,
            access_requested_at, access_request_note
     FROM users
     -- Accounts with no role first. Somebody who has signed in and not asked
     -- for anything is invisible everywhere else in the portal, and is
     -- exactly who this page exists to find: a request through the form is
     -- not the only way somebody says they would like to contribute.
     ORDER BY role = 'pending' DESC, last_seen_at DESC
     LIMIT 500`,
  ).all();
}

routes.get("/review", async (c) =>
  page(
    c,
    <Review {...(await reviewState(c))} viewer={c.get("viewer").user} />,
    { cache: "no-store" },
  ),
);

routes.get("/review/previous", async (c) => {
  const [counts, { results }] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT * FROM submissions WHERE state != 'pending'
       ORDER BY reviewed_at DESC LIMIT 200`,
    ).all(),
  ]);

  return page(
    c,
    <PreviousSubmissions
      counts={counts}
      submissions={results}
      bucket={c.env.SYNTHESIZER_SUBMISSIONS_BUCKET}
    />,
    { cache: "no-store" },
  );
});

routes.get("/review/:id{[0-9]+}", async (c) => {
  const [counts, submission] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT s.*, d.name AS release_of_name
       FROM submissions s
       LEFT JOIN datasets d ON d.dataset_id = s.release_of_dataset_id
       WHERE s.submission_id = ?`,
    )
      .bind(Number(c.req.param("id")))
      .first(),
  ]);

  if (submission === null) {
    return page(
      c,
      <NotFound counts={counts} message="There is no such submission." />,
      { status: 404, cache: "no-store" },
    );
  }

  return page(
    c,
    <SubmissionReview
      counts={counts}
      submission={submission}
      bucket={c.env.SYNTHESIZER_SUBMISSIONS_BUCKET}
      duplicate={await duplicateOf(c.env, submission)}
    />,
    { cache: "no-store" },
  );
});

/**
 * Which roles this account may grant.
 *
 * A reviewer may let somebody submit, which is a small decision that should
 * not need escalating. Only an admin may grant the ability to publish into
 * the catalogue, or the ability to grant it.
 *
 * @param {object} viewer The account making the change.
 * @returns {string[]} The roles it may set.
 */
function grantableRoles(viewer) {
  return viewer.role === "admin"
    ? ["pending", "contributor", "reviewer", "admin"]
    : ["pending", "contributor"];
}

routes.get("/accounts", requireRole("reviewer"), async (c) =>
  page(
    c,
    <Accounts
      counts={await tabCounts(c.env.DB)}
      people={(await allAccounts(c)).results}
      viewer={c.get("viewer").user}
    />,
    { cache: "no-store" },
  ),
);

/**
 * Answer with whichever list the action was taken from.
 *
 * An overlay opened on the accounts page that answered by rendering the
 * review queue would read as having lost the page rather than as having saved
 * the change.
 *
 * @param {import("hono").Context} c Request context.
 * @param {object} viewer The account that acted.
 * @param {unknown} from Which page the overlay was opened on.
 * @param {string} note What happened.
 * @returns {Promise<Response>} The rendered page.
 */
async function accountsOrQueue(c, viewer, from, note) {
  if (from === "accounts") {
    return page(
      c,
      <Accounts
        counts={await tabCounts(c.env.DB)}
        people={(await allAccounts(c)).results}
        viewer={viewer}
        note={note}
      />,
      { cache: "no-store" },
    );
  }

  return page(
    c,
    <Review {...(await reviewState(c))} viewer={viewer} note={note} />,
    { cache: "no-store" },
  );
}

/**
 * Whether this account may act on that one, and why not when it may not.
 *
 * The same answer governs granting a role and revoking access, so it is asked
 * once: two copies of this would be two things to keep in step, and the one
 * that fell behind would be a way to do by one route what the other refuses.
 *
 * @param {object} viewer The account acting.
 * @param {object | null} target The account being acted on.
 * @returns {string | null} Why not, or null when they may.
 */
function refusalFor(viewer, target) {
  if (target === null) {
    return "There is no such account.";
  }
  if (!grantableRoles(viewer).includes(target.role)) {
    // What the account already holds has to be within the actor's gift, not
    // only what they are trying to give it -- otherwise a reviewer could
    // strip an admin of authority they could not themselves confer.
    return `Only an admin can change a ${target.role}.`;
  }
  if (target.user_id === viewer.user_id) {
    // Otherwise the last admin can remove their own authority and leave
    // nobody able to restore it -- recoverable only through the configured
    // administrator list, which is a worse way to find out about this.
    return "You cannot change your own role.";
  }
  return null;
}

/**
 * Find the account an action names.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {Promise<object | null>} The account, or null.
 */
function targetAccount(c) {
  return c.env.DB.prepare(
    "SELECT user_id, login, role FROM users WHERE user_id = ?",
  )
    .bind(Number(c.req.param("id")))
    .first();
}

routes.post("/review/users/:id{[0-9]+}/revoke", async (c) => {
  const viewer = c.get("viewer").user;
  const form = await c.req.parseBody();
  const target = await targetAccount(c);

  let note = refusalFor(viewer, target);
  if (note === null) {
    // Both halves, because either alone leaves something behind: a role with
    // no session is an account that can sign straight back in with what it
    // had, and a session with no role is somebody still holding a key to a
    // door that has been locked.
    await c.env.DB.prepare(
      `UPDATE users
       SET role = 'pending', access_requested_at = NULL,
           access_request_note = NULL
       WHERE user_id = ?`,
    )
      .bind(target.user_id)
      .run();
    await endSessions(c.env, target.user_id);
    note = `${target.login} has been signed out and left with no role.`;
  }

  return accountsOrQueue(c, viewer, form.from, note);
});

routes.post("/review/users/:id{[0-9]+}", async (c) => {
  const viewer = c.get("viewer").user;
  const form = await c.req.parseBody();
  const role = String(form.role ?? "");
  const subject = Number(c.req.param("id"));

  const grantable = grantableRoles(viewer);
  const target = await targetAccount(c);

  let note;
  if (target === null) {
    note = "There is no such account.";
  } else if (!grantable.includes(role)) {
    note = `You cannot grant the ${role || "requested"} role.`;
  } else if (!grantable.includes(target.role)) {
    // The role being granted is not the only thing that needs checking. A
    // reviewer may grant `contributor`, and without this could set an admin
    // to `contributor` and strip the authority they could not confer -- so
    // what the account already holds has to be within their gift too.
    note = `Only an admin can change a ${target.role}.`;
  } else if (subject === viewer.user_id) {
    // Otherwise the last admin can remove their own authority and leave
    // nobody able to restore it -- recoverable only through the configured
    // administrator list, which is a worse way to find out about this.
    note = "You cannot change your own role.";
  } else {
    await c.env.DB.prepare(
      `UPDATE users
       SET role = ?,
           -- Granting or refusing answers the request either way, so it
           -- stops being something waiting to be attended to.
           access_requested_at = NULL,
           access_request_note = NULL
       WHERE user_id = ?`,
    )
      .bind(role, subject)
      .run();
    note = `${target.login} is now a ${role}.`;
  }

  return accountsOrQueue(c, viewer, form.from, note);
});

routes.post("/review/:id{[0-9]+}", async (c) => {
  const form = await c.req.parseBody();
  const decision = form.decision === "approved" ? "approved" : "rejected";

  const submission = await c.env.DB.prepare(
    `UPDATE submissions
     SET state = ?, reviewed_at = ?, reviewer_note = ?, reviewed_by = ?
     WHERE submission_id = ? AND state = 'pending'
     RETURNING name`,
  )
    .bind(
      decision,
      new Date().toISOString(),
      String(form.reviewer_note ?? "").slice(0, 1000) || null,
      c.get("viewer").user.user_id,
      Number(c.req.param("id")),
    )
    .first();

  return page(
    c,
    <Review
      {...(await reviewState(c))}
      viewer={c.get("viewer").user}
      note={
        submission === null
          ? "That submission has already been reviewed."
          : `${submission.name} marked ${decision}. Publishing it is still a` +
            " deliberate run of syndex-upload."
      }
    />,
    { cache: "no-store" },
  );
});
