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
import { HTTPException } from "hono/http-exception";
import { trimTrailingSlash } from "hono/trailing-slash";

import {
  atLeast,
  authConfigured,
  beginSignIn,
  consumeState,
  currentUser,
  endSession,
  endSessions,
  profileForCode,
  recordSignIn,
  safeReturn,
  startSession,
} from "./auth.js";
import {
  TABS,
  dataset as fetchDataset,
  isFiltered,
  parseFilters,
  search,
  tabCounts,
} from "./catalogue.js";
import { notifyAccessRequest, notifySubmission } from "./notify.js";
import {
  ACCOUNTS_SHOWN,
  Accounts,
  Browse,
  Dataset,
  Landing,
  NotFound,
  NothingArrived,
  PreviousSubmissions,
  RequestAccess,
  Review,
  ChooseDataset,
  SUBMISSION_TYPES,
  SignInRequired,
  SubmissionReview,
  Submit,
  Truncated,
  Upload,
} from "./pages.jsx";
import {
  duplicatesOf,
  validationConfigured,
  fetchAuthorised,
  fetchUrl,
  readReport,
  reportAuthorised,
  requestValidation,
} from "./validation.js";
import {
  MAX_PARTS,
  MAX_UPLOAD_BYTES,
  PART_SIZE,
  finishUpload,
  submissionRefusal,
  submissionsOpen,
  writePart,
} from "./submissions.js";
import { BASE, Panel, ViewerContext } from "./views.jsx";

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

// Who is reading, established once per request. The role is read from the
// database rather than from the cookie, so a promotion or a demotion takes
// effect on the next page load.
app.use("*", async (c, next) => {
  c.set("viewer", { user: await currentUser(c) });
  await next();
});

/**
 * How much is waiting for a reviewer's attention.
 *
 * Counted when the page is rendered rather than when the request arrives.
 * Deciding a submission is a POST that renders the queue back, and a count
 * taken before the handler ran would still include the thing just decided --
 * so the badge kept its number until the page was reloaded by hand.
 *
 * Both halves are counted: a person waiting for access is as much a thing to
 * attend to as a file waiting to be read. Only a reviewer is shown it and
 * only a reviewer can act on it, so nobody else pays for the query.
 *
 * @param {import("hono").Context} c Request context.
 * @param {object | null} user Who is reading.
 * @returns {Promise<number>} What is waiting, or zero.
 */
async function waitingCount(c, user) {
  if (!atLeast(user?.role, "reviewer")) {
    return 0;
  }
  const row = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM submissions
             WHERE state = 'pending' AND uploaded_at IS NOT NULL)
          + (SELECT COUNT(*) FROM users WHERE access_requested_at IS NOT NULL)
            AS waiting`,
  ).first();
  return row?.waiting ?? 0;
}

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
async function page(c, node, { status = 200, cache = "public, max-age=60" } = {}) {
  const { user } = c.get("viewer") ?? { user: null };
  const viewer = { user, waiting: await waitingCount(c, user) };
  const tree = (
    <ViewerContext.Provider value={viewer}>{node}</ViewerContext.Provider>
  );

  return c.html(`<!doctype html>\n${tree.toString()}`, status, {
    // A signed-in page says who is signed in, so it belongs to one person and
    // to no shared cache. The anonymous rendering is still cacheable, which is
    // what keeps the catalogue cheap to serve to the people who only read it.
    "cache-control": viewer.user === null ? cache : "private, no-store",
    vary: "Cookie, HX-Request, HX-History-Restore-Request",
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
    vary: "HX-Request, HX-History-Restore-Request",
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
  //
  // Except on a history restore. When htmx has no cached snapshot for a URL
  // the back button lands on, it re-fetches it with both HX-Request and
  // HX-History-Restore-Request set, and replaces the whole body with what
  // comes back -- so answering that with a fragment leaves the page as a bare
  // results panel with none of the layout around it.
  const restoring = c.req.header("HX-History-Restore-Request") === "true";
  if (!restoring && c.req.header("HX-Request") === "true") {
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

// The tab paths the portal used to have, kept because they were shareable.
//
// Registered as four literal routes rather than one `:tab{grids|dust|...}`
// pattern. That pattern is composed into a regex where `|` binds loosest, so
// it read as "starts with /syndex/grids, OR contains dust, OR contains
// instruments, OR ends with data" -- and every dataset with `dust` in its name
// was redirected to the dust tab instead of opening.
const TAB_PATHS = {
  "/grids": "grid",
  "/dust": "dust_grid",
  "/instruments": "instrument",
  "/data": null,
};

app.on("GET", Object.keys(TAB_PATHS), (c) => {
  const params = new URL(c.req.url).searchParams;
  const type = TAB_PATHS[new URL(c.req.url).pathname.slice(BASE.length)];
  if (type === null) {
    params.delete("type");
  } else {
    params.set("type", type);
  }
  // 307 and no-store, not 308. A 308 is cacheable for ever by default, so
  // when this route's pattern was wrong every browser that touched a dust
  // grid's page learned the redirect permanently and kept honouring it long
  // after the server stopped sending it. An alias is not worth a redirect
  // nobody can take back.
  const target = `${BASE}/search${params.size === 0 ? "" : `?${params}`}`;
  return c.body(null, 307, {
    location: target,
    "cache-control": "no-store",
  });
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

/**
 * Refuse a page to someone who is not allowed it, in the way that helps most.
 *
 * A visitor who is not signed in is offered the sign-in, since that is what
 * they are missing. Someone signed in but without the role is told what they
 * would need, which for a pending account is the access request rather than a
 * dead end. Neither is a 404: pretending the page does not exist would be a
 * worse answer to a person who is one step away from being allowed it.
 *
 * @param {string} required The role the route needs.
 * @returns {Function} Middleware enforcing it.
 */
function requireRole(required) {
  return async (c, next) => {
    const { user } = c.get("viewer");

    if (user === null) {
      return page(
        c,
        <SignInRequired
          counts={await tabCounts(c.env.DB)}
          configured={authConfigured(c.env)}
          returnTo={new URL(c.req.url).pathname}
        />,
        { status: 401, cache: "no-store" },
      );
    }

    if (!atLeast(user.role, required)) {
      // A pending account is not being refused so much as told where the
      // queue starts, so send it there rather than explaining twice.
      if (required === "contributor" && user.role === "pending") {
        return c.redirect(`${BASE}/access`, 303);
      }
      return page(
        c,
        <NotFound
          counts={await tabCounts(c.env.DB)}
          message={
            `This page is for ${required}s, and your account is a ` +
            `${user.role}.`
          }
        />,
        { status: 403, cache: "no-store" },
      );
    }

    return next();
  };
}

app.get("/login", (c) => {
  if (!authConfigured(c.env)) {
    return c.text("Signing in is not configured.", 503, {
      "cache-control": "no-store",
    });
  }
  return c.redirect(beginSignIn(c, c.req.query("return")), 302);
});

app.get("/auth/callback", async (c) => {
  const counts = await tabCounts(c.env.DB);

  // The state cookie is consumed whatever happens next, so a failed or
  // replayed callback cannot be retried with the same nonce.
  const returnTo = consumeState(c, c.req.query("state"));
  const code = c.req.query("code");

  if (returnTo === null || !code) {
    return page(
      c,
      <NotFound
        counts={counts}
        message={
          "That sign-in could not be completed. It may have been left too " +
          "long, or started in a different browser. Try signing in again."
        }
      />,
      { status: 400, cache: "no-store" },
    );
  }

  const profile = await profileForCode(
    c.env,
    code,
    // Must be character-for-character what the flow began with, which is why
    // it is derived the same way rather than written out twice.
    new URL(`${BASE}/auth/callback`, c.req.url).toString(),
  );
  if (profile === null) {
    return page(
      c,
      <NotFound
        counts={counts}
        message="GitHub could not confirm that sign-in. Please try again."
      />,
      { status: 502, cache: "no-store" },
    );
  }

  const user = await recordSignIn(c.env, profile);
  await startSession(c, user.user_id);
  return c.redirect(returnTo, 303);
});

app.post("/logout", async (c) => {
  await endSession(c);
  return c.redirect(BASE, 303);
});

// Asking for submit access. Open to anyone signed in, including accounts that
// already have it: an account that has been granted access sees what it can
// do rather than a form it does not need.
app.get("/access", requireRole("pending"), async (c) =>
  page(
    c,
    <RequestAccess counts={await tabCounts(c.env.DB)} user={c.get("viewer").user} />,
    { cache: "no-store" },
  ),
);

app.post("/access", requireRole("pending"), async (c) => {
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
  const release = Number(c.req.query("release") ?? 0);
  let releaseOf = null;
  if (release > 0) {
    releaseOf = await c.env.DB.prepare(
      `SELECT dataset_id, name, display_name, description, data_type, licence
       FROM datasets WHERE dataset_id = ?`,
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

  const [counts, mine] = await Promise.all([
    tabCounts(c.env.DB),
    // Somebody's own submissions, because otherwise there is no way back to
    // one. The upload page is addressed by a token that exists only in the
    // URL, so closing the tab used to lose a half-finished transfer for good.
    c.env.DB.prepare(
      `SELECT submission_id, name, display_name, state, submitted_at,
              uploaded_at, upload_token, validation_state
       FROM submissions WHERE user_id = ?
       ORDER BY submitted_at DESC LIMIT 50`,
    )
      .bind(user.user_id)
      .all(),
  ]);

  return page(
    c,
    <Submit
      counts={counts}
      open={submissionsOpen(c.env)}
      user={user}
      mine={mine.results}
      releaseOf={releaseOf}
      values={values}
      errors={errors}
      limit={MAX_UPLOAD_BYTES}
    />,
    { status, cache: "no-store" },
  );
}

app.get("/submit/release", requireRole("contributor"), async (c) => {
  const query = String(c.req.query("q") ?? "").trim();

  // Matched on both names, because somebody looking for a grid they made
  // knows what they called it and not necessarily how it was catalogued.
  const { results } = query
    ? await c.env.DB.prepare(
        `SELECT dataset_id, name, display_name, data_type
         FROM datasets
         WHERE name LIKE ?1 OR display_name LIKE ?1
         ORDER BY name LIMIT 25`,
      )
        .bind(`%${query}%`)
        .all()
    : { results: [] };

  return page(
    c,
    <ChooseDataset
      counts={await tabCounts(c.env.DB)}
      query={query}
      datasets={results}
    />,
    { cache: "no-store" },
  );
});

app.get("/submit", requireRole("contributor"), (c) => submitPage(c));

app.post("/submit", requireRole("contributor"), async (c) => {
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

app.get("/submit/:token", requireRole("contributor"), async (c) => {
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
      maxParts={MAX_PARTS}
      duplicate={await duplicateOf(c, submission)}
    />,
    { cache: "no-store" },
  );
});

app.post("/submit/:token/part/:number{[0-9]+}", requireRole("contributor"), async (c) => {
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

/**
 * Whatever already holds these bytes, shaped for a page to say so.
 *
 * @param {import("hono").Context} c Request context.
 * @param {object} submission The submission to check.
 * @returns {Promise<object | null>} The twin, or null.
 */
async function duplicateOf(c, submission) {
  const twin = await duplicatesOf(
    c.env,
    submission.submission_id,
    submission.sha256,
  );
  if (twin.published !== null) {
    return { name: twin.published, published: true };
  }
  return twin.pending === null ? null : { name: twin.pending, published: false };
}

app.get("/submit/:token/check", requireRole("contributor"), async (c) => {
  const submission = await ownSubmission(c);
  if (submission === null) {
    return c.text("", 404, { "cache-control": "no-store" });
  }
  return fragment(
    c,
    <CheckReport
      submission={submission}
      duplicate={await duplicateOf(c, submission)}
      forContributor
    />,
  );
});

app.post("/submit/:token/complete", requireRole("contributor"), async (c) => {
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

/**
 * Hand the runner the object to check.
 *
 * Signed rather than session-guarded: a GitHub runner has no account here and
 * should not be given one. The link says "this object, until this time" and
 * nothing else, which is the whole of what a validation run needs.
 */
app.get("/validate/:id{[0-9]+}/file", async (c) => {
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
app.post("/validate/:id{[0-9]+}", async (c) => {
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

// The review queue was guarded by one shared username and password, which
// said that somebody with the credential was reviewing and never which
// somebody. Roles replace it: a decision is now attributable, and granting or
// withdrawing the ability to make one does not mean telling everybody a new
// password.
app.use("/review", requireRole("reviewer"));
app.use("/review/*", requireRole("reviewer"));

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
      `SELECT * FROM submissions
       WHERE state = 'pending' AND uploaded_at IS NOT NULL
       ORDER BY submitted_at LIMIT 100`,
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

app.get("/review", async (c) =>
  page(
    c,
    <Review {...(await reviewState(c))} viewer={c.get("viewer").user} />,
    { cache: "no-store" },
  ),
);

app.get("/review/previous", async (c) => {
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

app.get("/review/:id{[0-9]+}", async (c) => {
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
      duplicate={await duplicateOf(c, submission)}
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

app.get("/accounts", requireRole("reviewer"), async (c) =>
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

app.post("/review/users/:id{[0-9]+}/revoke", async (c) => {
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

app.post("/review/users/:id{[0-9]+}", async (c) => {
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
