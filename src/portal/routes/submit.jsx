/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Making a submission: describing it, sending the bytes, and assembling them.
 *
 * A submission is a row before it is a file. The description is checked and
 * stored first, which is what makes it possible to refuse a name that is
 * taken or a queue that is full before thirty gigabytes have moved, and the
 * file then arrives in pieces against the token that row carries.
 *
 * The browser and `syndex-submit` use these same routes. The Worker cannot
 * tell them apart and does not try to: one limit, one assembly, one place
 * where a truncated transfer is caught.
 */

import { Hono } from "hono";

import { BASE } from "../base.js";
import { atLeast } from "../data/auth.js";
import { search, tabCounts } from "../data/catalogue.js";
import { notifySubmission } from "../data/notify.js";
import {
  BROWSER_MAX_PARTS,
  BROWSER_UPLOAD_BYTES,
  MAX_PARTS,
  MAX_UPLOAD_BYTES,
  PART_SIZE,
  finishUpload,
  submissionRefusal,
  submissionsOpen,
  writePart,
} from "../data/submissions.js";
import {
  duplicateOf,
  requestValidation,
  validationConfigured,
} from "../data/validation.js";
import { NotFound } from "../pages/refusals.jsx";
import {
  NothingArrived,
  SUBMISSION_TYPES,
  Submissions,
  Submit,
  SubmitChoice,
  Truncated,
  Upload,
} from "../pages/submit.jsx";
import { CheckReport } from "../pages/validation.jsx";
import { fragment, page, requireRole } from "./respond.jsx";

/** The routes this module contributes, mounted by `app.jsx`. */
export const routes = new Hono();

/**
 * What the form asks for, checked before anything is stored.
 *
 * Written as one pass over the fields rather than as validation scattered
 * through the handler, so that a submission comes back with everything that
 * is wrong with it at once instead of one problem per attempt.
 *
 * @param {object} form The parsed form body.
 * @returns {{values: object, errors: string[]}} What was submitted, and what
 *     is wrong with it.
 */
function readSubmission(form) {
  const values = Object.fromEntries(
    ["name", "display_name", "data_type", "description", "notes"].map(
      (field) => [field, String(form[field] ?? "").trim()],
    ),
  );
  const errors = [];

  // Citations and the licence are behind questions, and a hidden field still
  // submits: somebody who fills them in and then unticks the question has
  // changed their mind, and the answer to honour is the tick.
  //
  // The rows arrive as repeated fields, which `parseBody({ all: true })`
  // collects into an array -- except when there is exactly one, which stays a
  // string. Both are the same thing with a different number of rows filled in.
  // Which dataset this is a new release of, if any. A number or nothing: the
  // page renders it as a hidden field, so a value that is not one of ours is
  // somebody editing the form rather than a mistake.
  const releaseOf = Number(form.release_of ?? 0);
  values.release_of = releaseOf > 0 ? releaseOf : null;

  const rows = form.has_citations
    ? [form.citation ?? []]
        .flat()
        .map((value) => String(value).trim())
        .filter(Boolean)
    : [];
  values.citations = rows.join("\n");
  values.licence = form.has_licence ? String(form.licence ?? "").trim() : "";
  // Kept so that unticking a question does not silently discard what was
  // typed: the form comes back with the boxes still open and still filled.
  values.has_citations = Boolean(form.has_citations);
  values.has_licence = Boolean(form.has_licence);
  values.citation_rows = rows;

  // The catalogue name is what people download by, so it has to survive being
  // typed into a shell and a URL without quoting.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(values.name)) {
    errors.push(
      "The catalogue name must be lowercase letters, digits and hyphens, " +
        "starting with a letter or digit.",
    );
  }
  if (values.name.length > 128) {
    errors.push("The catalogue name is too long.");
  }
  if (values.display_name === "") {
    errors.push("A display name is needed.");
  }
  if (!SUBMISSION_TYPES.includes(values.data_type)) {
    errors.push("Choose one of the listed data types.");
  }

  // Citations are ADS bibcodes, which are a fixed nineteen characters: four
  // of year, five of journal, then volume, qualifier, page and the first
  // letter of the author's surname. Checked here because a typo found now is
  // a correction, and one found at publication is an archaeology exercise.
  const malformed = rows.filter(
    (bibcode) => !/^[0-9]{4}[A-Za-z.&+]{5}[0-9A-Za-z.&+]{9}[A-Z.]$/.test(bibcode),
  );
  if (malformed.length > 0) {
    errors.push(
      `Not an ADS bibcode: ${malformed.join(", ")}. A bibcode looks like ` +
        "2017PASA...34...58E.",
    );
  }
  // Answering "yes, this should be cited" and then giving nothing is a
  // question left half answered rather than a decision.
  if (values.has_citations && rows.length === 0) {
    errors.push("Add at least one bibcode, or say this data needs no citation.");
  }

  return { values, errors };
}

/**
 * Render the submission form, however it is being reached.
 *
 * @param {import("hono").Context} c Request context.
 * @param {object} options What to show and why.
 * @returns {Promise<Response>} The rendered form.
 */
async function submitPage(c, { values = {}, errors = [], status = 200 } = {}) {
  const { user } = c.get("viewer");

  // Starting from one already sent. A rejected submission is usually one
  // detail away from being right, and retyping six fields to change one of
  // them is how a contributor is put off trying again.
  //
  // Their own only: the token addresses a submission and does not authorise
  // reading it, here as everywhere else.
  // A new release of something already published. The dataset supplies
  // everything but the file, and the name is fixed: it is what makes this a
  // release of that dataset rather than a second one beside it.
  // Named rather than numbered, because the catalogue's search returns what
  // the catalogue is keyed by and the name is unique. The submission still
  // records the id, which is what the foreign key needs.
  const release = String(c.req.query("release") ?? "");
  let releaseOf = null;
  if (release !== "") {
    releaseOf = await c.env.DB.prepare(
      `SELECT dataset_id, name, display_name, description, data_type, licence
       FROM datasets WHERE name = ?`,
    )
      .bind(release)
      .first();
    if (releaseOf !== null && Object.keys(values).length === 0) {
      values = { ...releaseOf, release_of: releaseOf.dataset_id };
    }
  }

  const like = c.req.query("like");
  if (like && Object.keys(values).length === 0) {
    const previous = await c.env.DB.prepare(
      `SELECT name, display_name, description, data_type, licence, citations,
              notes
       FROM submissions WHERE upload_token = ? AND user_id = ?`,
    )
      .bind(like, user.user_id)
      .first();

    if (previous !== null) {
      const rows = String(previous.citations ?? "")
        .split(/\s+/)
        .filter(Boolean);
      values = {
        ...previous,
        citation_rows: rows,
        // The questions answer themselves from what was answered last time.
        has_citations: rows.length > 0,
        has_licence: Boolean(previous.licence),
      };
    }
  }

  return page(
    c,
    <Submit
      counts={await tabCounts(c.env.DB)}
      open={submissionsOpen(c.env)}
      user={user}
      releaseOf={releaseOf}
      values={values}
      errors={errors}
      limit={MAX_UPLOAD_BYTES}
    />,
    { status, cache: "no-store" },
  );
}

// Picking a dataset to release is the catalogue's own search with the results
// pointing somewhere else, so it is that page rather than a copy of it. The
// mode rides in the filters, which means every rail link, sort header and
// htmx swap carries it without knowing it exists.
routes.get("/submit/release", requireRole("contributor"), (c) =>
  c.redirect(`${BASE}/search?pick=release`, 302),
);

/**
 * Somebody's own submissions, because otherwise there is no way back to one.
 *
 * The upload page is addressed by a token that exists only in the URL, so
 * closing the tab used to lose a half-finished transfer for good.
 *
 * @param {import("hono").Context} c Request context.
 * @param {object} user Whose submissions to fetch.
 * @returns {Promise<object[]>} Their submissions, newest first.
 */
async function ownSubmissions(c, user) {
  const { results } = await c.env.DB.prepare(
    `SELECT s.submission_id, s.name, s.display_name, s.state, s.submitted_at,
            s.uploaded_at, s.upload_token, s.validation_state,
            EXISTS (SELECT 1 FROM files f WHERE f.sha256 = s.sha256)
              AS duplicate
     FROM submissions s WHERE s.user_id = ?
     ORDER BY s.submitted_at DESC LIMIT 50`,
  )
    .bind(user.user_id)
    .all();
  return results;
}

/** How many of somebody's submissions the chooser shows before a page of them. */
const RECENT_SUBMISSIONS = 5;

routes.get("/submit", requireRole("contributor"), async (c) => {
  const { user } = c.get("viewer");
  const mine = await ownSubmissions(c, user);
  return page(
    c,
    <SubmitChoice
      counts={await tabCounts(c.env.DB)}
      open={submissionsOpen(c.env)}
      user={user}
      limit={MAX_UPLOAD_BYTES}
      mine={mine.slice(0, RECENT_SUBMISSIONS)}
      more={mine.length > RECENT_SUBMISSIONS}
    />,
    { cache: "no-store" },
  );
});

routes.get("/submissions", requireRole("pending"), async (c) =>
  page(
    c,
    <Submissions
      counts={await tabCounts(c.env.DB)}
      mine={await ownSubmissions(c, c.get("viewer").user)}
    />,
    { cache: "no-store" },
  ),
);

routes.get("/submit/new", requireRole("contributor"), (c) => submitPage(c));

routes.post("/submit/new", requireRole("contributor"), async (c) => {
  const { user } = c.get("viewer");

  if (!submissionsOpen(c.env)) {
    return submitPage(c, { status: 503 });
  }

  // `all` so that repeated citation rows arrive as an array rather than as
  // whichever one happened to be last.
  const { values, errors } = readSubmission(
    await c.req.parseBody({ all: true }),
  );

  // The queue's ceilings, checked before the name collision so that a full
  // queue is reported as a full queue rather than as whatever else is also
  // true about the submission.
  const refusal = await submissionRefusal(c.env, user.user_id);
  if (refusal !== null) {
    errors.push(refusal);
  }

  // A name already in the catalogue, or already waiting under somebody else,
  // is a collision somebody would otherwise have to untangle by hand after
  // both files had been uploaded.
  //
  // One waiting under *this* account is not a collision. It is the same
  // person submitting the same dataset again, which is what the resubmit
  // route exists for -- and refusing it leaves them blocked by a row they
  // created a minute earlier and cannot see a way past.
  let mine = null;
  if (errors.length === 0) {
    const [published, waiting] = await Promise.all([
      c.env.DB.prepare("SELECT dataset_id FROM datasets WHERE name = ?")
        .bind(values.name)
        .first(),
      c.env.DB.prepare(
        `SELECT submission_id, upload_token, user_id FROM submissions
         WHERE name = ? AND state = 'pending'`,
      )
        .bind(values.name)
        .first(),
    ]);

    // A release has to be a release of the dataset whose name it carries.
    // Without this the field is a way to attach a file to any dataset in the
    // catalogue by naming a different one.
    if (values.release_of !== null && published?.dataset_id !== values.release_of) {
      errors.push(
        "A new release has to keep the name of the dataset it belongs to.",
      );
    } else if (published !== null && values.release_of === null) {
      errors.push(
        `${values.name} is already in the catalogue. To replace or add to it,` +
          " submit a new release of it instead.",
      );
    } else if (waiting !== null && waiting.user_id !== user.user_id) {
      errors.push(`Somebody else is already submitting ${values.name}.`);
    } else {
      mine = waiting;
    }
  }

  if (errors.length > 0) {
    return submitPage(c, { values, errors, status: 400 });
  }

  // Their own submission of this name, brought up to date rather than
  // duplicated. The row keeps its token and whatever file it already has, so
  // a transfer part way through is not thrown away by an edit to the
  // description.
  if (mine !== null) {
    await c.env.DB.prepare(
      `UPDATE submissions
       SET display_name = ?, description = ?, data_type = ?, licence = ?,
           citations = ?, notes = ?, submitted_at = ?
       WHERE submission_id = ?`,
    )
      .bind(
        values.display_name,
        values.description || null,
        values.data_type,
        values.licence || null,
        values.citations || null,
        values.notes || null,
        new Date().toISOString(),
        mine.submission_id,
      )
      .run();
    return c.redirect(`${BASE}/submit/${mine.upload_token}`, 303);
  }

  // The token names the prefix this submission may write, and is unguessable
  // so that knowing a submission exists is not the same as being able to
  // interfere with it. Ownership is still checked separately: the token is
  // how the file is addressed, not how it is authorised.
  const token = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const submission = await c.env.DB.prepare(
    `INSERT INTO submissions (submitted_at, name, display_name, description,
                              data_type, licence, citations, upload_token,
                              filename, submitter_name, submitter_email,
                              notes, user_id, release_of_dataset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING upload_token`,
  )
    .bind(
      new Date().toISOString(),
      values.name,
      values.display_name,
      values.description || null,
      values.data_type,
      values.licence || null,
      values.citations || null,
      token,
      // The key is fixed now, from the catalogue name rather than from
      // whatever the file happens to be called. One submission, one object,
      // decided before a single byte is accepted -- and with no extension,
      // since the file has not been chosen yet and guessing one would be
      // wrong for everything that is not a grid.
      values.name,
      user.name ?? user.login,
      user.email ?? "",
      values.notes || null,
      user.user_id,
      values.release_of,
    )
    .first();

  return c.redirect(`${BASE}/submit/${submission.upload_token}`, 303);
});

/**
 * Find a submission, and check it belongs to whoever is asking.
 *
 * The token addresses the submission; the session authorises it. Before
 * accounts the token was both, which meant anybody who came by one could
 * write to somebody else's submission.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {Promise<object | null>} The submission, or null when there is
 *     none or it is not theirs.
 */
async function ownSubmission(c) {
  const { user } = c.get("viewer");
  const submission = await c.env.DB.prepare(
    "SELECT * FROM submissions WHERE upload_token = ?",
  )
    .bind(c.req.param("token"))
    .first();

  if (submission === null) {
    return null;
  }
  // A reviewer may open anybody's, since reading them is the job.
  if (atLeast(user.role, "reviewer") || submission.user_id === user.user_id) {
    return submission;
  }
  return null;
}

routes.get("/submit/:token", requireRole("contributor"), async (c) => {
  const submission = await ownSubmission(c);
  if (submission === null) {
    return page(
      c,
      <NotFound
        counts={await tabCounts(c.env.DB)}
        message="That submission does not exist."
      />,
      { status: 404, cache: "no-store" },
    );
  }

  return page(
    c,
    <Upload
      counts={await tabCounts(c.env.DB)}
      submission={submission}
      partSize={PART_SIZE}
      browserParts={BROWSER_MAX_PARTS}
      browserLimit={BROWSER_UPLOAD_BYTES}
      limit={MAX_UPLOAD_BYTES}
      duplicate={await duplicateOf(c.env, submission)}
    />,
    { cache: "no-store" },
  );
});

routes.post("/submit/:token/part/:number{[0-9]+}", requireRole("contributor"), async (c) => {
  const submission = await ownSubmission(c);
  if (submission === null) {
    return c.json({ error: "No such submission" }, 404);
  }
  if (submission.uploaded_at !== null) {
    return c.json({ error: "This submission already has its file" }, 409);
  }
  if (!submissionsOpen(c.env)) {
    return c.json({ error: "Submissions are not open" }, 503);
  }

  // The ceiling. A part larger than the platform's request body limit never
  // reaches this code, so bounding the count bounds the total -- and unlike a
  // declared size, it is not something a client can misreport.
  const partNumber = Number(c.req.param("number"));
  if (partNumber > MAX_PARTS) {
    return c.json(
      {
        error:
          `A submission may be at most ${MAX_PARTS} parts of ` +
          `${PART_SIZE} bytes. This file is larger than the catalogue ` +
          "accepts through the portal.",
      },
      413,
    );
  }

  if (c.req.raw.body === null) {
    return c.json({ error: "That part carried no data" }, 400);
  }

  await writePart(c.env, submission, partNumber, c.req.raw.body);
  return c.json({ part: partNumber }, 200, { "cache-control": "no-store" });
});

routes.get("/submit/:token/check", requireRole("contributor"), async (c) => {
  const submission = await ownSubmission(c);
  if (submission === null) {
    return c.text("", 404, { "cache-control": "no-store" });
  }
  return fragment(
    c,
    <CheckReport
      submission={submission}
      duplicate={await duplicateOf(c.env, submission)}
      forContributor
    />,
  );
});

routes.post("/submit/:token/complete", requireRole("contributor"), async (c) => {
  const submission = await ownSubmission(c);
  const counts = await tabCounts(c.env.DB);

  if (submission === null) {
    return page(
      c,
      <NotFound counts={counts} message="That submission does not exist." />,
      { status: 404, cache: "no-store" },
    );
  }

  // Assembling the parts is what turns them into an object, and the size
  // comes back from R2 rather than from the form that says it finished.
  const file = await finishUpload(c.env, submission);
  if (file === null) {
    return page(c, <NothingArrived counts={counts} submission={submission} />, {
      status: 404,
      cache: "no-store",
    });
  }

  // What the sender says it sent, against what the bucket says it holds. A
  // transfer that stopped part way is the failure this has to catch, and a
  // size that does not match catches it without asking anybody to run
  // shasum -- which was the old answer, and one most people skipped.
  const expected = Number((await c.req.parseBody()).expected_size ?? 0);
  if (expected > 0 && expected !== file.size) {
    return page(
      c,
      <Truncated counts={counts} submission={submission} arrived={file.size} expected={expected} />,
      { status: 409, cache: "no-store" },
    );
  }

  // The check is marked as running in the same statement that completes the
  // upload, rather than when the dispatch comes back. Asking GitHub happens
  // after the response is sent, so a page that set this afterwards would be
  // rendered before it was set -- and would tell a contributor no check had
  // run, seconds after starting one.
  const checking = validationConfigured(c.env);
  const complete = await c.env.DB.prepare(
    `UPDATE submissions
     SET uploaded_at = ?, uploaded_size_bytes = ?, r2_key = ?, upload_id = NULL,
         validation_state = ?
     WHERE upload_token = ?
     RETURNING *`,
  )
    .bind(
      new Date().toISOString(),
      file.size,
      file.key,
      checking ? "running" : null,
      submission.upload_token,
    )
    .first();

  const origin = new URL(c.req.url).origin;
  // Both advisory, and neither awaited: a contributor's upload does not
  // become slower, or fail, because GitHub is having an afternoon.
  c.executionCtx.waitUntil(notifySubmission(c.env, origin, complete));
  c.executionCtx.waitUntil(
    requestValidation(c.env, origin, complete).then(async (asked) => {
      // Nobody is going to run one, so stop saying one is on its way.
      if (!asked && checking) {
        await c.env.DB.prepare(
          "UPDATE submissions SET validation_state = NULL WHERE submission_id = ?",
        )
          .bind(complete.submission_id)
          .run();
      }
    }),
  );

  return c.redirect(`${BASE}/submit/${submission.upload_token}`, 303);
});
