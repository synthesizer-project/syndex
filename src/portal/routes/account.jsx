/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Somebody's own account: asking for access, and what they have done with it.
 *
 * Both pages are about the reader rather than about anybody else. Managing
 * other people's accounts is `routes/review.jsx`, because it is part of the
 * same job as reading the queue.
 */

import { Hono } from "hono";

import { atLeast } from "../data/auth.js";
import { tabCounts } from "../data/catalogue.js";
import { notifyAccessRequest } from "../data/notify.js";
import { Account, RequestAccess } from "../pages/account.jsx";
import { page, requireRole } from "./respond.jsx";

/** The routes this module contributes, mounted by `app.jsx`. */
export const routes = new Hono();

// Asking for submit access. Open to anyone signed in, including accounts that
// already have it: an account that has been granted access sees what it can
// do rather than a form it does not need.
routes.get("/access", requireRole("pending"), async (c) =>
  page(
    c,
    <RequestAccess counts={await tabCounts(c.env.DB)} user={c.get("viewer").user} />,
    { cache: "no-store" },
  ),
);

routes.post("/access", requireRole("pending"), async (c) => {
  const { user } = c.get("viewer");
  const note = String((await c.req.parseBody()).note ?? "")
    .trim()
    .slice(0, 2000);

  if (note === "") {
    return page(
      c,
      <RequestAccess
        counts={await tabCounts(c.env.DB)}
        user={user}
        error="Please say what you would like to contribute."
      />,
      { status: 400, cache: "no-store" },
    );
  }

  // Recorded only while the account is still pending. Re-requesting refreshes
  // the note rather than queueing a second request, and an account that has
  // since been granted access does not reappear in the queue by asking again.
  const updated = await c.env.DB.prepare(
    `UPDATE users
     SET access_requested_at = ?, access_request_note = ?
     WHERE user_id = ? AND role = 'pending'
     RETURNING user_id`,
  )
    .bind(new Date().toISOString(), note, user.user_id)
    .first();

  // Advisory, and deliberately not awaited: whether a maintainer's issue
  // tracker is reachable is not this person's problem.
  if (updated !== null) {
    c.executionCtx.waitUntil(
      notifyAccessRequest(c.env, new URL(c.req.url).origin, user, note),
    );
  }

  return page(
    c,
    <RequestAccess
      counts={await tabCounts(c.env.DB)}
      user={{ ...user, access_requested_at: new Date().toISOString() }}
      sent
    />,
    { cache: "no-store" },
  );
});

routes.get("/account", requireRole("pending"), async (c) => {
  const { user } = c.get("viewer");

  const [counts, submitted, reviewed] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT state, COUNT(*) AS n FROM submissions
       WHERE user_id = ? GROUP BY state`,
    )
      .bind(user.user_id)
      .all(),
    // Only somebody who can review has any, so the query is only worth making
    // for them -- and a contributor being shown an empty "reviewed" list
    // would be told about a job they do not have.
    atLeast(user.role, "reviewer")
      ? c.env.DB.prepare(
          `SELECT submission_id, name, state, reviewed_at FROM submissions
           WHERE reviewed_by = ? ORDER BY reviewed_at DESC LIMIT 10`,
        )
          .bind(user.user_id)
          .all()
      : { results: [] },
  ]);

  return page(
    c,
    <Account
      counts={counts}
      user={user}
      submitted={submitted.results}
      reviewed={reviewed.results}
    />,
    { cache: "no-store" },
  );
});
