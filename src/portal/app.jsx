/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The Syndex portal: server-rendered pages over the same D1 and R2
 * bindings the API uses.
 *
 * Search state lives in URL query parameters, so every filtered view is
 * shareable, citable, back-button-correct and works with JavaScript
 * disabled. htmx then upgrades a filter change into a background request
 * that swaps the panel and rewrites the URL; the plain form submission it
 * replaces still works, and is what the no-JavaScript path uses.
 */

import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import { trimTrailingSlash } from "hono/trailing-slash";

import {
  TABS,
  dataset as fetchDataset,
  isFiltered,
  parseFilters,
  search,
  tabCounts,
} from "./catalogue.js";
import {
  Browse,
  Dataset,
  DATA_TYPES,
  Landing,
  NotFound,
  NothingArrived,
  Review,
  Submit,
  Upload,
} from "./pages.jsx";
import {
  BROWSER_UPLOAD_LIMIT,
  presignUpload,
  submissionsOpen,
  temporaryCredentials,
  uploadedFile,
  uploadPrefix,
  verifyChallenge,
} from "./submissions.js";
import { BASE, Panel } from "./views.jsx";

/** What a tab's rows are called in a count. */
const NOUNS = {
  grids: "grid",
  dust: "dust grid",
  instruments: "instrument",
  data: "dataset",
};

const app = new Hono().basePath(BASE);

// /syndex/ and /syndex are the same page, and only one of them should
// be the URL anybody shares or cites.
app.use(trimTrailingSlash());

/**
 * Send one rendered page.
 *
 * Hono's JSX renders a document fragment, so the doctype is prepended here
 * rather than being smuggled into a component.
 *
 * @param {import("hono").Context} c Request context.
 * @param {unknown} node The rendered tree.
 * @param {object} options Status code and cache policy.
 * @returns {Response} An HTML response.
 */
function page(c, node, { status = 200, cache = "public, max-age=60" } = {}) {
  return c.html(`<!doctype html>\n${node.toString()}`, status, {
    "cache-control": cache,
  });
}

/**
 * Send one fragment of a page, for htmx to swap in.
 *
 * @param {import("hono").Context} c Request context.
 * @param {unknown} node The rendered tree.
 * @returns {Response} An HTML response with no document around it.
 */
function fragment(c, node) {
  return c.html(node.toString(), 200, { "cache-control": "no-store" });
}

app.get("/", async (c) => {
  const [counts, totals] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS datasets, SUM(f.size_bytes) AS bytes
       FROM datasets d
       JOIN releases r ON r.release_id = d.current_release_id
       JOIN files f ON f.file_id = r.file_id`,
    ).first(),
  ]);

  return page(
    c,
    <Landing
      counts={counts}
      datasets={totals.datasets}
      bytes={totals.bytes}
    />,
  );
});

app.get("/:tab{grids|dust|instruments|data}", async (c) => {
  const tab = TABS.find((candidate) => candidate.id === c.req.param("tab"));
  const filters = parseFilters(new URL(c.req.url).searchParams);
  const result = await search(c.env.DB, tab, filters);
  const panel = (
    <Panel tab={tab} filters={filters} result={result} noun={NOUNS[tab.id]} />
  );

  // htmx asks for the panel alone. Everything else about the request is the
  // same, which is what keeps the two paths from drifting apart.
  if (c.req.header("HX-Request") === "true") {
    return fragment(c, panel);
  }

  const counts = await tabCounts(c.env.DB);
  return page(
    c,
    <Browse tab={tab} counts={counts}>
      {panel}
    </Browse>,
    // A filtered view is cheap to recompute and awkward to cache: the URL
    // carries the filters, so a cached copy would be one arbitrary search.
    { cache: isFiltered(filters) ? "no-store" : "public, max-age=60" },
  );
});

app.get("/datasets/:name", async (c) => {
  const name = c.req.param("name");
  const [record, counts] = await Promise.all([
    fetchDataset(c.env.DB, name),
    tabCounts(c.env.DB),
  ]);

  if (record === null) {
    return page(
      c,
      <NotFound counts={counts} message={`There is no dataset named ${name}.`} />,
      { status: 404, cache: "no-store" },
    );
  }

  return page(c, <Dataset dataset={record} counts={counts} />);
});

app.get("/submit", async (c) =>
  page(
    c,
    <Submit
      counts={await tabCounts(c.env.DB)}
      open={submissionsOpen(c.env)}
      sitekey={c.env.TURNSTILE_SITEKEY}
    />,
    { cache: "no-store" },
  ),
);

app.post("/submit", async (c) => {
  // The form is small and every field is capped, so a body this large is
  // not a submission and is refused before it is parsed.
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > 64 * 1024) {
    return c.text("Submission too large", 413);
  }

  if (!submissionsOpen(c.env)) {
    return c.text("Submissions are not open.", 503);
  }

  const form = await c.req.parseBody();
  const counts = await tabCounts(c.env.DB);

  const passed = await verifyChallenge(
    c.env,
    String(form["cf-turnstile-response"] ?? ""),
    c.req.header("cf-connecting-ip") ?? null,
  );

  const { values, errors } = await validate(c.env.DB, form);
  if (!passed) {
    errors.unshift(
      "The anti-robot check did not pass. Reload the page and try again.",
    );
  }

  if (errors.length > 0) {
    return page(
      c,
      <Submit
        counts={counts}
        open
        sitekey={c.env.TURNSTILE_SITEKEY}
        values={values}
        errors={errors}
      />,
      { status: 422, cache: "no-store" },
    );
  }

  // The token is the only thing that will authorise the upload, so it comes
  // from the platform's cryptographic source rather than from anything
  // guessable like the row's own id.
  const token = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    `INSERT INTO submissions (
       submitted_at, state, name, display_name, description, data_type,
       licence, citations, upload_token, submitter_name, submitter_email,
       notes
     ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING submission_id`,
  )
    .bind(
      new Date().toISOString(),
      values.name,
      values.display_name,
      values.description,
      values.data_type,
      values.licence,
      values.citations,
      token,
      values.submitter_name,
      values.submitter_email,
      values.notes,
    )
    .first();

  // Redirect rather than render, so reloading the upload page does not
  // resubmit the metadata behind it.
  console.log(
    JSON.stringify({
      message: "Submission registered",
      submission_id: inserted.submission_id,
      data_type: values.data_type,
    }),
  );
  return c.redirect(`${BASE}/submit/${token}`, 303);
});

/**
 * Find a submission by the token that authorises its upload.
 *
 * @param {D1Database} db Catalogue database.
 * @param {string} token The upload token from the path.
 * @returns {Promise<object | null>} The submission, or null.
 */
function bySubmissionToken(db, token) {
  return db
    .prepare("SELECT * FROM submissions WHERE upload_token = ?")
    .bind(token)
    .first();
}

app.get("/submit/:token", async (c) => {
  const submission = await bySubmissionToken(c.env.DB, c.req.param("token"));
  const counts = await tabCounts(c.env.DB);

  if (submission === null) {
    return page(
      c,
      <NotFound counts={counts} message="That submission does not exist." />,
      { status: 404, cache: "no-store" },
    );
  }

  // Credentials are minted per view and expire on their own, so a stale
  // page is useless rather than dangerous.
  const credentials =
    submission.uploaded_at === null && c.env.SYNTHESIZER_SUBMISSIONS_API_TOKEN
      ? await temporaryCredentials(c.env, submission.upload_token)
      : null;

  return page(c, <Upload counts={counts} submission={submission} credentials={credentials} />, {
    cache: "no-store",
  });
});

app.post("/submit/:token/upload-url", async (c) => {
  const submission = await bySubmissionToken(c.env.DB, c.req.param("token"));
  if (submission === null) {
    return c.json({ error: "No such submission" }, 404);
  }
  if (submission.uploaded_at !== null) {
    return c.json({ error: "This submission already has its file" }, 409);
  }
  if (!submissionsOpen(c.env)) {
    return c.json({ error: "Submissions are not open" }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const { url, key } = await presignUpload(
    c.env,
    submission.upload_token,
    String(body.filename ?? "submission.bin"),
  );

  return c.json({ url, key }, 200, { "cache-control": "no-store" });
});

app.post("/submit/:token/complete", async (c) => {
  const submission = await bySubmissionToken(c.env.DB, c.req.param("token"));
  const counts = await tabCounts(c.env.DB);

  if (submission === null) {
    return page(
      c,
      <NotFound counts={counts} message="That submission does not exist." />,
      { status: 404, cache: "no-store" },
    );
  }

  // What is in the bucket is the only account of the upload that cannot be
  // wrong, so it is read from R2 rather than taken from the form that says
  // the transfer finished.
  const file = await uploadedFile(c.env, submission.upload_token);
  if (file === null) {
    return page(c, <NothingArrived counts={counts} submission={submission} />, {
      status: 404,
      cache: "no-store",
    });
  }

  const digest = String((await c.req.parseBody())["declared_sha256"] ?? "")
    .trim()
    .toLowerCase();

  await c.env.DB.prepare(
    `UPDATE submissions
     SET uploaded_at = ?, uploaded_size_bytes = ?, filename = ?, r2_key = ?,
         declared_sha256 = COALESCE(?, declared_sha256)
     WHERE upload_token = ?`,
  )
    .bind(
      new Date().toISOString(),
      file.size,
      file.filename,
      file.key,
      /^[0-9a-f]{64}$/.test(digest) ? digest : null,
      submission.upload_token,
    )
    .run();

  return c.redirect(`${BASE}/submit/${submission.upload_token}`, 303);
});

/**
 * Guard the one page that writes.
 *
 * Submitters need no account, since a human reads every submission before
 * anything is published, but the page doing that reading is a write
 * endpoint. With no credentials configured it refuses to serve rather than
 * standing open.
 *
 * @param {import("hono").Context} c Request context.
 * @param {Function} next The next handler.
 * @returns {Promise<Response | void>} A refusal, or the guarded handler.
 */
const requireReviewer = (c, next) => {
  const username = c.env.SYNDEX_REVIEW_USER;
  const password = c.env.SYNDEX_REVIEW_PASSWORD;
  if (!username || !password) {
    return c.text("The review queue is not configured.", 503);
  }
  return basicAuth({ username, password })(c, next);
};

app.use("/review", requireReviewer);
app.use("/review/*", requireReviewer);

app.get("/review", async (c) => {
  const [counts, { results }] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT * FROM submissions
       ORDER BY state = 'pending' DESC, submitted_at DESC
       LIMIT 200`,
    ).all(),
  ]);

  return page(
    c,
    <Review
      counts={counts}
      submissions={results}
      bucket={c.env.SYNTHESIZER_SUBMISSIONS_BUCKET}
    />,
    { cache: "no-store" },
  );
});

app.post("/review/:id{[0-9]+}", async (c) => {
  const form = await c.req.parseBody();
  const decision = form.decision === "approved" ? "approved" : "rejected";

  const submission = await c.env.DB.prepare(
    `UPDATE submissions
     SET state = ?, reviewed_at = ?, reviewer_note = ?
     WHERE submission_id = ? AND state = 'pending'
     RETURNING name`,
  )
    .bind(
      decision,
      new Date().toISOString(),
      String(form.reviewer_note ?? "").slice(0, 1000) || null,
      Number(c.req.param("id")),
    )
    .first();

  const [counts, { results }] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT * FROM submissions
       ORDER BY state = 'pending' DESC, submitted_at DESC
       LIMIT 200`,
    ).all(),
  ]);

  return page(
    c,
    <Review
      counts={counts}
      submissions={results}
      bucket={c.env.SYNTHESIZER_SUBMISSIONS_BUCKET}
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

app.notFound(async (c) =>
  page(
    c,
    <NotFound
      counts={await tabCounts(c.env.DB)}
      message={`There is no page at ${new URL(c.req.url).pathname}.`}
    />,
    { status: 404, cache: "no-store" },
  ),
);

app.onError((error, c) => {
  // A challenge or a deliberate refusal is already a complete answer, and
  // must not be turned into a 500 that hides it.
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  console.error(
    JSON.stringify({
      message: "Unhandled portal error",
      path: new URL(c.req.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.html(
    "<!doctype html><title>Syndex</title><p>Something went wrong " +
      "rendering this page. The failure has been logged.",
    500,
    { "cache-control": "no-store" },
  );
});

/**
 * Check a submission, and hand back what the form should redisplay.
 *
 * The form echoes user input back, so every value here reaches the page as
 * text and is escaped by JSX on the way. Validation is about whether a
 * reviewer can act on the submission at all: a name they cannot publish
 * under, or a URL they cannot fetch, wastes their time and the submitter's.
 *
 * @param {D1Database} db Catalogue database.
 * @param {Record<string, unknown>} form Parsed form body.
 * @returns {Promise<{values: object, errors: string[]}>} Cleaned values and
 *     every problem found, so the form can report them all at once.
 */
async function validate(db, form) {
  const text = (key, limit) =>
    String(form[key] ?? "")
      .trim()
      .slice(0, limit);

  const values = {
    name: text("name", 128).toLowerCase(),
    display_name: text("display_name", 256),
    description: text("description", 4000) || null,
    data_type: text("data_type", 32),
    licence: text("licence", 128) || null,
    citations: text("citations", 4000) || null,
    submitter_name: text("submitter_name", 128),
    submitter_email: text("submitter_email", 256),
    notes: text("notes", 4000) || null,
  };

  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(values.name)) {
    errors.push(
      "The catalogue name must be lowercase letters, digits and hyphens.",
    );
  }
  if (values.display_name === "") {
    errors.push("A display name is required.");
  }
  if (!DATA_TYPES.includes(values.data_type)) {
    errors.push("Choose one of the listed data types.");
  }
  if (values.submitter_name === "") {
    errors.push("A name to reply to is required.");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.submitter_email)) {
    errors.push("An email address is required, so the review can ask questions.");
  }

  if (errors.length === 0) {
    const taken = await db
      .prepare(
        `SELECT 1 FROM datasets WHERE name = ?
         UNION ALL
         SELECT 1 FROM submissions WHERE name = ? AND state = 'pending'`,
      )
      .bind(values.name, values.name)
      .first();
    if (taken !== null) {
      errors.push(
        `${values.name} is already in the catalogue or already waiting for` +
          " review. Pick another name, or send a note asking for the existing" +
          " one to be updated.",
      );
    }
  }

  return { values, errors };
}

export default app;
