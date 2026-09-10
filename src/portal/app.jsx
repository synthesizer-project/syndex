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
  presignUpload,
  submissionsOpen,
  temporaryCredentials,
  uploadedFile,
} from "./submissions.js";
import { BASE, Panel } from "./views.jsx";

/** What a tab's rows are called in a count. */
const NOUNS = {
  search: "dataset",
  grids: "grid",
  dust: "dust grid",
  instruments: "instrument",
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
    vary: "HX-Request",
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
  return c.html(node.toString(), 200, {
    "cache-control": "no-store",
    vary: "HX-Request",
  });
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

app.get("/search", async (c) => {
  const filters = parseFilters(new URL(c.req.url).searchParams);
  const tab =
    TABS.find((candidate) => candidate.types?.includes(filters.type[0])) ?? TABS[0];
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
    <Browse tab={tab} counts={counts} filters={filters}>
      {panel}
    </Browse>,
    // A filtered view is cheap to recompute and awkward to cache: the URL
    // carries the filters, so a cached copy would be one arbitrary search.
    { cache: isFiltered(filters) ? "no-store" : "public, max-age=60" },
  );
});

app.get("/:tab{grids|dust|instruments|data}", (c) => {
  const params = new URL(c.req.url).searchParams;
  const type = {
    grids: "grid",
    dust: "dust_grid",
    instruments: "instrument",
  }[c.req.param("tab")];
  if (type === undefined) {
    params.delete("type");
  } else {
    params.set("type", type);
  }
  return c.redirect(`${BASE}/search${params.size === 0 ? "" : `?${params}`}`, 308);
});

app.get("/datasets/:name", async (c) => {
  const name = c.req.param("name");
  const requestedReturn = c.req.query("return");
  const returnTo =
    requestedReturn === `${BASE}/search` ||
    requestedReturn?.startsWith(`${BASE}/search?`)
      ? requestedReturn
      : null;
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

  return page(c, <Dataset dataset={record} counts={counts} returnTo={returnTo} />);
});

app.get("/submit", async (c) =>
  page(
    c,
    <Submit
      counts={await tabCounts(c.env.DB)}
      open={false}
      sitekey={c.env.TURNSTILE_SITEKEY}
    />,
    { cache: "no-store" },
  ),
);

// Deliberately shut, and not merely unconfigured. The write path is built but
// not yet safe to expose: the presigned PUT signs no content-length, so the
// advertised size limit is advisory only; `upload-url` signs a new key for
// every filename it is handed, so one token can write any number of objects;
// and `/submit/:token` mints twelve hours of prefix-scoped credentials just by
// being viewed. With no lifecycle rule on the submissions bucket, each of
// those is unbounded storage that bills monthly. See "Submissions" in
// docs/website.md for what has to land before this returns anything but 503.
app.post("/submit", async (c) =>
  page(
    c,
    <Submit
      counts={await tabCounts(c.env.DB)}
      open={false}
      sitekey={c.env.TURNSTILE_SITEKEY}
    />,
    { status: 503, cache: "no-store" },
  ),
);

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
  // Deliberately not a JSX page: whatever just failed may be the renderer
  // itself, so this is a complete document with no dependencies but the
  // stylesheet, and it still offers a way out.
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Something went wrong \u00b7 Syndex</title>` +
      `<link rel="stylesheet" href="${BASE}/static/app.css"></head>` +
      `<body class="bg-bg text-text">` +
      `<main class="mx-auto max-w-2xl px-6 py-12">` +
      `<h1 class="text-3xl">Something went wrong</h1>` +
      `<p class="mt-3 text-muted">This page could not be rendered. The ` +
      `failure has been logged.</p>` +
      `<p class="mt-4"><a href="${BASE}">Back to the catalogue</a></p>` +
      `</main></body></html>`,
    500,
    { "cache-control": "no-store" },
  );
});

export default app;
