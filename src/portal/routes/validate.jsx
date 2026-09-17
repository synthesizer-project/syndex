/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The two routes a validation run talks to.
 *
 * Checking a file means reading HDF5, which needs h5py, which a Worker has
 * no way to run -- so the check happens in a GitHub Actions job. These are
 * the only things that job needs: somewhere to fetch the object from, and
 * somewhere to post what it found.
 *
 * Neither is session-guarded: a runner has no account here and should not be
 * given one. The fetch is authorised by a signature over the object and an
 * expiry, so the link grants one file for a short while and nothing else; the
 * report is authorised by a shared secret, compared in constant time.
 */

import { Hono } from "hono";

import { fetchAuthorised, readReport, reportAuthorised } from "../data/validation.js";

/** The routes this module contributes, mounted by `app.jsx`. */
export const routes = new Hono();

/**
 * Hand the runner the object to check.
 *
 * Signed rather than session-guarded: a GitHub runner has no account here and
 * should not be given one. The link says "this object, until this time" and
 * nothing else, which is the whole of what a validation run needs.
 */
routes.get("/validate/:id{[0-9]+}/file", async (c) => {
  const id = Number(c.req.param("id"));
  const allowed = await fetchAuthorised(
    c.env,
    id,
    c.req.query("expires"),
    c.req.query("signature"),
  );
  if (!allowed) {
    return c.text("That link is not valid.", 403, { "cache-control": "no-store" });
  }

  const submission = await c.env.DB.prepare(
    "SELECT r2_key FROM submissions WHERE submission_id = ?",
  )
    .bind(id)
    .first();
  const object =
    submission?.r2_key == null
      ? null
      : await c.env.SUBMISSIONS.get(submission.r2_key);

  if (object === null) {
    return c.text("There is no file for that submission.", 404, {
      "cache-control": "no-store",
    });
  }

  // Streamed straight out of R2, the same way parts are streamed in: the
  // bytes never pass through any JavaScript here.
  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "no-store",
    },
  });
});

/**
 * Take the runner's verdict.
 *
 * Authenticated by a shared secret rather than a session, for the same reason
 * as the fetch above. What arrives is confirmed rather than trusted: it comes
 * from a version of the checker this Worker did not install.
 */
routes.post("/validate/:id{[0-9]+}", async (c) => {
  if (!reportAuthorised(c.env, c.req.header("authorization")?.slice(7))) {
    return c.json({ error: "Not authorised" }, 403);
  }

  const id = Number(c.req.param("id"));
  const report = await c.req.json().catch(() => null);
  if (report === null) {
    return c.json({ error: "That is not a report" }, 400);
  }

  const { state, dataType, sha256 } = readReport(report);
  const updated = await c.env.DB.prepare(
    `UPDATE submissions
     SET validation_state = ?, validation_report_json = ?,
         detected_data_type = ?, sha256 = ?, validated_at = ?
     WHERE submission_id = ?
     RETURNING submission_id`,
  )
    .bind(
      state,
      JSON.stringify(report).slice(0, 100_000),
      dataType,
      sha256,
      new Date().toISOString(),
      id,
    )
    .first();

  if (updated === null) {
    return c.json({ error: "No such submission" }, 404);
  }
  return c.json({ recorded: state }, 200, { "cache-control": "no-store" });
});
