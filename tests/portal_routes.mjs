/**
 * Smoke test for the portal's routing, filter semantics and form handling.
 *
 * Run with `node tests/portal_routes.mjs`. Like the API's tests it needs no
 * network and no framework: D1 is stubbed, so what is under test is the route
 * split, the SQL the filters generate, what the pages say, and what the
 * submission form accepts.
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { load } from "./jsx_hooks.mjs";

// The portal is JSX, which Node cannot parse unaided.
registerHooks({ load });
const { default: worker } = await import("../src/worker/entry.js");
const { parseFilters, search, toQuery, TABS } = await import(
  "../src/portal/catalogue.js"
);
const { range } = await import("../src/portal/views.jsx");

const ORIGIN = "https://synthesizer-project.org";

const GRID_ROW = {
  name: "bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01",
  display_name: "BPASS 2.2.1 Cloudy SPS grid",
  data_type: "grid",
  is_test: 0,
  is_ci: 1,
  is_recommended: 1,
  release_id: 2,
  published_at: "2026-09-04T16:47:01.550420Z",
  known_bug: 0,
  size_bytes: 203126664,
  format: "hdf5",
  grid_type: "sps",
  emission_type: "photoionised",
  model_name: "BPASS",
  has_spectra: 1,
  has_lines: 1,
  wavelength_min: 1.3e-4,
  wavelength_max: 2.99e11,
  wavelength_units: "Å",
  photoionisation_code: "Cloudy",
  photoionisation_code_version: "23.01",
  instrument_type: null,
  filter_codes_json: null,
  resolving_power: null,
  psfs_json: null,
  noise_maps_json: null,
  depth_json: null,
};

const AXIS_ROWS = [
  {
    release_id: 2,
    axis_index: 0,
    name: "ages",
    units: "yr",
    scale: "log",
    count: 51,
    minimum: 1e6,
    maximum: 1e11,
  },
  {
    release_id: 2,
    axis_index: 1,
    name: "metallicities",
    units: "dimensionless",
    scale: "log",
    count: 13,
    minimum: 1e-5,
    maximum: 0.04,
  },
];

/**
 * Pick the canned result set one statement should return.
 *
 * The portal issues several statements per page, so the stub answers by
 * shape rather than by call order: a test that rearranges a batch should not
 * start failing for that reason alone.
 *
 * @param {string} sql The statement.
 * @param {object} rows Overrides keyed by shape.
 * @returns {object[]} Rows for that statement.
 */
function resultsFor(sql, rows) {
  if (sql.includes("GROUP BY d.data_type")) {
    return rows.tabCounts ?? [{ data_type: "grid", n: 157 }];
  }
  if (sql.includes("SUM(f.size_bytes)")) {
    return [{ datasets: 240, bytes: 67 * 1024 ** 3 }];
  }
  if (sql.includes("GROUP BY x.name")) {
    return rows.axisFacets ?? [{ value: "ages", n: 142, units: "yr" }];
  }
  if (sql.includes("GROUP BY value")) {
    return rows.facets ?? [{ value: "BPASS", n: 47 }];
  }
  // Before the generic count, which would otherwise answer for it.
  if (sql.includes("AS accounts")) {
    return [
      {
        accounts: rows.accountCount ?? 0,
        approved: rows.approvedCount ?? 0,
        rejected: rows.rejectedCount ?? 0,
      },
    ];
  }
  // The published twin of a digest. Narrower than "FROM files f", which the
  // list queries now also contain as an EXISTS subquery.
  if (sql.includes("JOIN releases r ON r.file_id")) {
    return rows.publishedTwin ?? [];
  }
  if (sql.includes("WHERE sha256 = ?")) {
    return rows.pendingTwin ?? [];
  }
  if (sql.includes("ORDER BY reviewed_at DESC")) {
    return rows.decided ?? [];
  }
  // The queue's own list, which is narrower than every other statement that
  // mentions a pending state.
  if (sql.includes("ORDER BY submitted_at LIMIT")) {
    return rows.submissions ?? [];
  }
  if (sql.includes("COUNT(*) AS n")) {
    return [{ n: 3 }];
  }
  // Who holds the session cookie this request carried. `null` for nobody,
  // which is what every test that does not sign in gets.
  if (sql.includes("FROM sessions s")) {
    return rows.viewer === undefined ? [] : [rows.viewer];
  }
  if (sql.includes("AS waiting")) {
    return [{ waiting: rows.waiting ?? 0 }];
  }
  if (sql.includes("UPDATE users")) {
    return rows.roleChange === undefined ? [] : [rows.roleChange];
  }
  // The account a role change is aimed at, looked up before anything is
  // written so that what it already holds can be checked too.
  if (sql.includes("FROM users WHERE user_id")) {
    return rows.target === undefined ? [] : [rows.target];
  }

  if (sql.includes("FROM users")) {
    return rows.people ?? [];
  }
  if (sql.includes("FROM file_citations")) {
    return rows.citations ?? [];
  }
  if (sql.includes("SELECT a.release_id")) {
    return rows.axes ?? AXIS_ROWS;
  }
  if (sql.includes("FROM grid_axes WHERE release_id")) {
    return rows.axes ?? AXIS_ROWS;
  }
  // The dataset a new release is prefilled from. Matched on its whole select
  // list, since "FROM datasets WHERE name = ?" is also the collision check.
  if (sql.includes("SELECT dataset_id, name, display_name")) {
    return rows.releaseOf ?? [];
  }
  // The name collision check, which is two questions: is it published, and
  // is somebody already submitting it.
  if (sql.includes("FROM datasets WHERE name = ?")) {
    return rows.published ?? [];
  }
  // The dataset a new release belongs to, and the search that picks it.

  if (sql.includes("WHERE name = ? AND state = 'pending'")) {
    return rows.waiting ?? [];
  }
  if (sql.includes("AS mine")) {
    return [rows.queue ?? { mine: 0, everyone: 0 }];
  }
  if (sql.includes("FROM submission_parts")) {
    return rows.parts ?? [];
  }
  if (sql.includes("INSERT INTO submissions")) {
    return [{ submission_id: 7 }];
  }
  if (sql.includes("UPDATE submissions")) {
    return rows.reviewed ?? [{ name: "example-new-grid" }];
  }
  if (sql.includes("WHERE upload_token")) {
    return rows.submission === undefined ? [] : [rows.submission];
  }
  if (sql.includes("FROM submissions")) {
    return rows.submissions ?? [];
  }
  if (sql.includes("FROM grid_metadata WHERE release_id")) {
    return rows.grid ?? [];
  }
  if (sql.includes("FROM instruments WHERE release_id")) {
    return rows.instrument ?? [];
  }
  if (sql.includes("FROM releases r JOIN files f")) {
    return rows.releases ?? [];
  }
  return rows.datasets ?? [GRID_ROW];
}

/** A signed-in account, as the session join returns it. */
const USER = {
  user_id: 3,
  github_id: 4242,
  login: "contributor-one",
  name: "A Contributor",
  email: "someone@example.org",
  role: "contributor",
  created_at: "2026-09-01T00:00:00Z",
  last_seen_at: "2026-09-14T00:00:00Z",
  access_requested_at: null,
  access_request_note: null,
};

/** The cookie a signed-in request carries. Any value: the stub answers the join. */
const SESSION_COOKIE = `syndex_session=${"a".repeat(64)}`;

/** Request init carrying that cookie, for a signed-in GET. */
const SIGNED_IN = { headers: { cookie: SESSION_COOKIE } };

/** Request init for a signed-in form post. */
const signedInPost = (fields) => ({
  method: "POST",
  body: new URLSearchParams(fields),
  headers: {
    cookie: SESSION_COOKIE,
    "content-type": "application/x-www-form-urlencoded",
  },
});

/**
 * Build a stub D1 binding that records every statement it is given.
 *
 * @param {object} options Canned rows, and a list to record statements in.
 * @returns {object} Object shaped like a D1Database.
 */
function stubDb({ rows = {}, issued = [] } = {}) {
  const prepare = (sql) => {
    const record = { sql, params: [] };
    issued.push(record);
    return {
      sql,
      bind(...params) {
        record.params = params;
        return this;
      },
      first: async () => resultsFor(sql, rows)[0] ?? null,
      all: async () => ({ results: resultsFor(sql, rows) }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
  };
  return {
    prepare,
    batch: async (statements) =>
      statements.map((statement) => ({
        results: resultsFor(statement.sql, rows),
      })),
  };
}

/**
 * Call the Worker.
 *
 * @param {string} path Request path with optional query string.
 * @param {object} env Stub bindings.
 * @param {object} init Extra fetch init, such as method or body.
 * @returns {Promise<{status: number, body: string, headers: Headers}>} Result.
 */
async function call(path, env, init = {}) {
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, init),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
  };
}

/**
 * Find the statement a test is about.
 *
 * @param {object[]} issued Statements the stub recorded.
 * @param {string} fragment Text the statement contains.
 * @returns {object} The first matching statement.
 */
function statement(issued, fragment) {
  const found = issued.find((record) => record.sql.includes(fragment));
  assert.ok(found !== undefined, `no statement containing ${fragment}`);
  return found;
}

const grids = TABS.find((tab) => tab.id === "grids");

const SUBMISSION = {
  submission_id: 7,
  submitted_at: "2026-09-07T10:00:00.000Z",
  state: "pending",
  reviewed_at: null,
  reviewer_note: null,
  name: "example-grid",
  display_name: "Example grid",
  description: null,
  data_type: "grid",
  licence: null,
  citations: null,
  upload_token: "11111111-2222-3333-4444-555555555555",
  // The key is fixed at registration, from the catalogue name, so one
  // submission is one object whatever a later request calls the file.
  filename: "example-grid",
  upload_id: null,
  user_id: 3,
  r2_key: null,
  uploaded_at: null,
  uploaded_size_bytes: null,
  submitter_name: "A Contributor",
  submitter_email: "a@example.org",
  notes: null,
};

/**
 * Everything the submission path needs to be considered configured.
 *
 * Only the bucket, now that the Worker writes the bytes itself: the R2
 * signing keys, the account id and the token that minted temporary
 * credentials all went with the code that used them.
 *
 * The multipart upload is recorded rather than performed, so a test can ask
 * which parts were written and what was completed without a bucket existing.
 *
 * @param {object} options Rows for the stub database, and R2 contents.
 * @returns {object} Stub bindings, with the recorded upload on `.uploaded`.
 */
function submissionEnv({ rows = {}, objects = [], issued = [] } = {}) {
  const uploaded = { parts: [], completed: null, aborted: false, created: 0 };

  const multipart = (uploadId) => ({
    uploadId,
    uploadPart: async (partNumber, body) => {
      // Drain the body the way R2 would, so a handler that failed to pass a
      // stream through shows up here rather than silently passing.
      const bytes = body === null ? new Uint8Array() : await new Response(body).arrayBuffer();
      uploaded.parts.push({ partNumber, size: bytes.byteLength });
      return { partNumber, etag: `etag-${partNumber}` };
    },
    complete: async (parts) => {
      uploaded.completed = parts;
    },
    abort: async () => {
      uploaded.aborted = true;
    },
  });

  return {
    DB: stubDb({ rows, issued }),
    SUBMISSIONS: {
      createMultipartUpload: async () => {
        uploaded.created += 1;
        return multipart("upload-1");
      },
      resumeMultipartUpload: (_key, uploadId) => multipart(uploadId),
      head: async (key) => objects.find((object) => object.key === key) ?? null,
      list: async ({ prefix }) => ({
        objects: objects.filter((object) => object.key.startsWith(prefix)),
      }),
    },
    uploaded,
  };
}

/**
 * Post one submission form, as a signed-in contributor.
 *
 * @param {object} env Stub bindings.
 * @param {object} fields Field overrides.
 * @returns {Promise<object>} The response.
 */
function postSubmission(env, fields = {}) {
  return call(
    "/syndex/submit/new",
    env,
    signedInPost({
      name: "example-grid",
      display_name: "Example grid",
      data_type: "grid",
      ...fields,
    }),
  );
}

/**
 * Bindings for a signed-in contributor submitting a file.
 *
 * @param {object} options Extra rows, and R2 contents.
 * @returns {object} Stub bindings.
 */
function contributorEnv({ rows = {}, ...rest } = {}) {
  return submissionEnv({ rows: { viewer: USER, ...rows }, ...rest });
}

const tests = {
  async "the api keeps its paths and the portal takes its own"() {
    const env = { DB: stubDb() };

    const api = await call("/v1/datasets?limit=1", env);
    assert.equal(api.status, 200);
    assert.equal(
      api.headers.get("content-type"),
      "application/json; charset=utf-8",
    );

    const portal = await call("/syndex/search", env);
    assert.equal(portal.status, 200);
    assert.match(portal.headers.get("content-type"), /text\/html/);
    assert.match(portal.headers.get("vary"), /^Cookie, HX-Request\b/);
    assert.match(portal.body, /class="bg-layer"/);
    assert.match(portal.body, /viewBox="0 0 1440 900"/);
    const oldTab = await call("/syndex/grids?q=bpass", env);
    assert.equal(oldTab.status, 307);
    assert.equal(
      oldTab.headers.get("location"),
      "/syndex/search?q=bpass&type=grid",
    );

    // The apex serves the portal and nothing else of its own, so everything
    // outside /syndex and /v1 belongs to the org site.
    const root = await call("/", env);
    assert.equal(root.status, 302);
    assert.equal(
      root.headers.get("location"),
      "https://synthesizer-project.github.io/",
    );
    assert.equal(root.headers.get("cache-control"), "no-store");

    const deep = await call("/getting-started?q=1", env);
    assert.equal(
      deep.headers.get("location"),
      "https://synthesizer-project.github.io/getting-started?q=1",
    );

    // The API's own hostname is untouched: it still answers, and still 404s
    // for a path it does not have.
    const onApi = await worker.fetch(
      new Request("https://data.synthesizer-project.org/nope"),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(onApi.status, 404);
    assert.match(await onApi.text(), /No route for/);
  },

  async "a filter URL survives being parsed and rebuilt"() {
    const query =
      "?q=bpass&type=grid&model=BPASS&model=FSPS&emission=photoionised&content=spectra" +
      "&axis=ages&min.ages=1000000&max.ages=10000000000&mode.ages=contain" +
      "&open=model&open=axes";
    const filters = parseFilters(new URLSearchParams(query));

    assert.deepEqual(filters.model, ["BPASS", "FSPS"]);
    assert.deepEqual(filters.axes, [
      { name: "ages", min: 1e6, max: 1e10, mode: "contain" },
    ]);

    // Rebuilding it gives back a URL that parses to the same state, which is
    // what makes every chip and remove link an ordinary href.
    assert.deepEqual(parseFilters(new URLSearchParams(toQuery(filters))), filters);
  },

  async "nonsense in a filter URL narrows nothing rather than failing"() {
    const filters = parseFilters(
      new URLSearchParams("?q=+&model=&axis=&min.ages=banana"),
    );

    assert.equal(filters.q, "");
    assert.deepEqual(filters.model, []);
    assert.deepEqual(filters.axes, []);
  },

  async "an axis with no range filters to grids that have it"() {
    const issued = [];
    const env = { DB: stubDb({ issued }) };

    await search(
      env.DB,
      grids,
      parseFilters(new URLSearchParams("?type=grid&axis=spins")),
    );

    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /EXISTS \(SELECT 1 FROM grid_axes a/);
    // The axis name is the only thing bound beyond the tab's data type.
    assert.deepEqual(rows.params, ["grid", "spins"]);
  },

  async "the range toggle picks the documented comparison"() {
    const overlap = [];
    await search(
      stubDb({ issued: overlap }),
      grids,
      parseFilters(
        new URLSearchParams("?type=grid&axis=ages&min.ages=1e6&max.ages=1e10"),
      ),
    );
    const anyOverlap = statement(overlap, "ORDER BY d.name");
    // gmin <= qmax AND gmax >= qmin, bound in that order.
    assert.match(anyOverlap.sql, /a\.minimum <= \?\s+AND a\.maximum >= \?/);
    assert.deepEqual(anyOverlap.params, ["grid", "ages", 1e10, 1e6]);

    const contain = [];
    await search(
      stubDb({ issued: contain }),
      grids,
      parseFilters(
        new URLSearchParams(
          "?type=grid&axis=ages&min.ages=1e6&max.ages=1e10&mode.ages=contain",
        ),
      ),
    );
    const fullRange = statement(contain, "ORDER BY d.name");
    // gmin <= qmin AND gmax >= qmax.
    assert.match(fullRange.sql, /a\.minimum <= \?\s+AND a\.maximum >= \?/);
    assert.deepEqual(fullRange.params, ["grid", "ages", 1e6, 1e10]);
  },

  async "one bound asks a one-sided question"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(new URLSearchParams("?type=grid&axis=ages&min.ages=1e9")),
    );

    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /AND a\.maximum >= \?/);
    assert.doesNotMatch(rows.sql, /a\.minimum <= \?/);
    assert.deepEqual(rows.params, ["grid", "ages", 1e9]);
  },

  async "a mass range normalises the three spellings of its units"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(new URLSearchParams("?type=grid&axis=masses&min.masses=1e6")),
    );

    // Mass axes record the same quantity in kilogrammes and in solar masses,
    // so the comparison has to convert before it compares.
    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /CASE WHEN a\.units = 'kg' THEN 1\.0 \/ 1\.98/);
    assert.deepEqual(rows.params, ["grid", "masses", 1e6]);
  },

  async "an axis on another axis's scale is compared as stored"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(
        new URLSearchParams("?type=grid&axis=metallicities&max.metallicities=0.02"),
      ),
    );

    // Axis bounds are physical values and `scale` is a display hint, so a
    // range is safe across grids written in log and in linear alike.
    const rows = statement(issued, "ORDER BY d.name");
    assert.doesNotMatch(rows.sql, /CASE WHEN/);
  },

  async "a mass range reads in one unit however it was recorded"() {
    // The same quantity, in the three spellings the catalogue holds, has to
    // come out as one column somebody can read down.
    const asSolarMasses = range({
      name: "masses",
      units: "1.98841586e+30*kg",
      minimum: 1e6,
      maximum: 1e10,
    });
    const asKilogrammes = range({
      name: "masses",
      units: "kg",
      minimum: 1e6 * 1.98841586e30,
      maximum: 1e10 * 1.98841586e30,
    });

    assert.equal(asSolarMasses, "10^6–10^10 M☉");
    assert.equal(asKilogrammes, asSolarMasses);
  },

  async "stellar and AGN are the first cut, and one query"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(new URLSearchParams("?type=grid&kind=agn&model=QSOSED")),
    );

    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /g\.grid_type IN \(\?\)/);
    assert.deepEqual(rows.params, ["agn", "QSOSED", "grid"]);

    // Its own count is of what it would return, so the rail says how many
    // stellar grids are there while AGN is ticked.
    const kinds = statement(issued, "SELECT g.grid_type AS value");
    assert.deepEqual(kinds.params, ["QSOSED", "grid"]);
  },

  async "an unknown kind is ignored rather than bound"() {
    // The two values are the vocabulary; dust grids are their own tab.
    const filters = parseFilters(
      new URLSearchParams("?type=grid&kind=dust&kind=agn"),
    );
    assert.deepEqual(filters.kind, ["agn"]);
  },

  async "a facet counts what it would return, not what is selected"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(
        new URLSearchParams("?type=grid&model=BPASS&emission=incident"),
      ),
    );

    // The model counts are computed without the model filter, so ticking a
    // second model adds to the results rather than replacing them.
    const models = statement(issued, "SELECT g.model_name AS value");
    assert.deepEqual(models.params, ["incident", "grid"]);

    // The tab restriction is not a facet and is never dropped.
    const emissions = statement(issued, "SELECT g.emission_type AS value");
    assert.deepEqual(emissions.params, ["BPASS", "grid"]);
  },

  async "a page names its filters and offers a way out of them"() {
    const env = { DB: stubDb() };
    const { body } = await call(
      "/syndex/search?type=grid&model=BPASS&axis=ages",
      env,
    );

    // The count, the chips, and a link that clears everything.
    assert.match(body, /1 grid</);
    assert.match(body, /clear all/);
    // The added axis is a column as well as a filter, and only once: ages
    // is a column on the grids tab whether or not it is filtered on.
    assert.equal(body.match(/>ages<\/a><\/th>/g).length, 1);
    // And it round-trips through the form without JavaScript.
    assert.match(body, /<input type="hidden" name="axis" value="ages"\/>/);
    assert.match(body, /<form id="filters" method="get"/);
    // Everything about you is behind one control now.
    assert.match(body, /class="header-menu/);
    assert.match(body, /href="\/syndex\/submit"/);
    assert.match(body, /<button type="submit" class="btn mt-2 w-full">Search<\/button>/);
    assert.doesNotMatch(body, /Apply filters/);
    assert.match(body, />select range<\/summary>/);
    assert.match(body, />photoionised<\/a><\/th>/);
    assert.match(body, /title="Photoionised: yes"/);
    assert.match(body, />spectra<\/a><\/th>/);
    assert.match(body, /title="Spectra: yes"/);
    assert.match(body, />lines<\/a><\/th>/);
    assert.match(body, /title="Lines: yes"/);
    assert.doesNotMatch(body, />contents<\/th>/);
    assert.match(body, />tags<\/th><\/tr>/);
  },

  async "a long facet list puts its toggle after the values"() {
    const many = Array.from({ length: 10 }, (unused, index) => ({
      value: `model-${index}`,
      n: 10 - index,
    }));
    const env = { DB: stubDb({ rows: { facets: many } }) };

    const collapsed = (await call("/syndex/search?type=grid", env)).body;
    // Six values, then the link. Never the link, then the values.
    const shown = collapsed.indexOf('value="model-5"');
    const link = collapsed.indexOf("4 more");
    assert.ok(shown > 0 && link > shown, "the toggle comes after the values");
    assert.equal(collapsed.includes('value="model-6"'), false);

    const opened = (await call("/syndex/search?type=grid&more=model", env)).body;
    assert.ok(opened.includes('value="model-9"'), "all values are shown");
    const last = opened.indexOf('value="model-9"');
    assert.ok(opened.indexOf("collapse") > last, "the toggle is still last");
    // And the form keeps it open across a filter change.
    assert.match(opened, /<input type="hidden" name="more" value="model"\/>/);
  },

  async "an expanded list is not a filter"() {
    // It narrows nothing, so it must not make the page look filtered.
    const env = { DB: stubDb() };
    const { body, headers } = await call("/syndex/search?more=model", env);

    assert.doesNotMatch(body, /clear all/);
    assert.equal(headers.get("cache-control"), "public, max-age=60");
  },

  async "the landing search and copy describe the whole catalogue"() {
    const { body } = await call("/syndex", { DB: stubDb() });

    assert.match(body, /An index of stellar population synthesis \(SPS\) and AGN grids/);
    assert.match(body, /action="\/syndex\/search"/);
    assert.match(body, /name, description, type or filename/);
    assert.doesNotMatch(body, /synthesizer-download --dataset NAME/);
    assert.match(body, /aria-label="Menu"/);
    assert.match(body, /Submit a dataset/);
    assert.match(body, /synthesizer-project\.github\.io/);
    assert.doesNotMatch(body, />API<\/a>/);
    assert.match(body, /src="\/syndex\/static\/syndex_logo_2\.png"[^>]*class="mx-auto/);
    assert.match(body, /<footer class="landing-footer[^>]*>[\s\S]*240 datasets · 72 GB/);
  },

  async "generic search includes current file fields"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      TABS[0],
      parseFilters(new URLSearchParams("?q=hdf5")),
    );

    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /f\.filename LIKE/);
    assert.match(rows.sql, /d\.data_type LIKE/);
    assert.match(rows.sql, /f\.format LIKE/);
    assert.deepEqual(rows.params, Array(6).fill("%hdf5%"));
  },

  async "file-size buckets combine as one generic facet"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      TABS[0],
      parseFilters(
        new URLSearchParams("?size=under_10_mib&size=over_10_gib"),
      ),
    );

    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /f\.size_bytes < 10000000/);
    assert.match(rows.sql, / OR /);
    assert.match(rows.sql, /f\.size_bytes >= 10000000000/);
  },

  async "shopping-style filter groups start collapsed"() {
    const { body } = await call("/syndex/search?type=grid", {
      DB: stubDb(),
    });

    assert.match(body, /<summary[^>]*><span>Data type<\/span>/);
    assert.match(body, /<summary[^>]*><span>File size<\/span>/);
    assert.match(body, /<summary[^>]*><span>Model<\/span>/);
    assert.match(body, /data-filter-group="type">/);
    assert.match(body, /data-filter-group="model">/);
    assert.match(body, /<option value="">Axes<\/option>/);
    assert.match(body, /class="sr-only">Add an axis<\/span>/);
    assert.match(body, /data-bulk-command=""/);
    assert.match(body, /data-bulk-command="" class="btn mb-3 w-full" hidden/);
    assert.match(body, /data-select-all=""/);
    assert.match(body, new RegExp(`data-dataset-select="" aria-label="Select ${GRID_ROW.name}`));
    assert.match(body, /data-bulk-command-text=""/);
  },

  async "the result table scrolls horizontally and grows vertically"() {
    const { body } = await call("/syndex/search", { DB: stubDb() });

    assert.match(body, /results card min-w-0 overflow-x-auto/);
    assert.match(body, /grid min-w-0 items-start/);
    assert.match(body, />size<\/a><\/th>/);
    assert.match(body, />format<\/a><\/th>/);
    assert.match(body, />hdf5<\/td>/);
    assert.match(body, />203 MB<\/td>/);
    assert.match(body, />published<\/a><\/th>/);
    assert.match(body, />2026-09-04<\/td>/);
    assert.doesNotMatch(body, /size \(MB\)/);
    assert.doesNotMatch(body, />version<\/a><\/th>/);
    assert.doesNotMatch(body, />what it is<\/th>/);
    assert.doesNotMatch(body, />file<\/a><\/th>/);
  },

  async "dust columns do not repeat their data type"() {
    const dust = {
      ...GRID_ROW,
      name: "dust-curve",
      data_type: "dust_grid",
      grid_type: "dust",
      emission_type: "dust_attenuation",
      model_name: null,
      has_spectra: 0,
      has_lines: 1,
    };
    const { body } = await call("/syndex/search?type=dust_grid", {
      DB: stubDb({ rows: { datasets: [dust] } }),
    });

    assert.match(body, />emission<\/a><\/th>/);
    assert.match(body, />attenuation<\/td>/);
    assert.doesNotMatch(body, />dust attenuation<\/td>/);
    assert.match(body, /title="Spectra: no"/);
    assert.match(body, /title="Lines: yes"/);
  },

  async "an empty tags column is omitted"() {
    const row = {
      ...GRID_ROW,
      known_bug: 0,
      is_recommended: 0,
      is_test: 0,
      is_ci: 0,
    };
    const { body } = await call("/syndex/search?type=grid", {
      DB: stubDb({ rows: { datasets: [row] } }),
    });

    assert.doesNotMatch(body, />tags<\/a><\/th>/);
  },

  async "optional columns require data and flags use ticks and crosses"() {
    const instruments = [
      {
        ...GRID_ROW,
        name: "instrument-one",
        data_type: "instrument",
        instrument_type: "photometric_imager",
        filter_codes_json: '["JWST/NIRCam.F090W"]',
        resolving_power: null,
        psfs_json: "[]",
        noise_maps_json: null,
        depth_json: null,
      },
      {
        ...GRID_ROW,
        name: "instrument-two",
        data_type: "instrument",
        instrument_type: "photometric_imager",
        filter_codes_json: '["JWST/NIRCam.F115W"]',
        resolving_power: null,
        psfs_json: null,
        noise_maps_json: "[]",
        depth_json: null,
      },
    ];
    const { body } = await call("/syndex/search?type=instrument", {
      DB: stubDb({ rows: { datasets: instruments } }),
    });

    assert.doesNotMatch(body, />resolving power<\/a><\/th>/);
    assert.doesNotMatch(body, />depth<\/a><\/th>/);
    assert.match(body, />PSF<\/a><\/th>/);
    assert.match(body, />noise<\/a><\/th>/);
    assert.match(body, /title="PSF: yes"/);
    assert.match(body, /title="PSF: no"/);
    assert.match(body, /title="Noise: yes"/);
    assert.match(body, /title="Noise: no"/);
  },

  async "column headings toggle persistent sorting"() {
    const issued = [];
    const { body } = await call(
      "/syndex/search?type=grid&sort=size&direction=desc",
      { DB: stubDb({ issued }) },
    );

    const rows = statement(issued, "ORDER BY f.size_bytes DESC");
    assert.match(rows.sql, /ORDER BY f\.size_bytes DESC, d\.name ASC/);
    assert.match(body, /aria-sort="descending"/);
    assert.match(body, />size<span aria-hidden="true"> ↓<\/span>/);
    assert.match(body, /sort=size&amp;direction=asc/);
    assert.match(body, /<input type="hidden" name="sort" value="size"\/>/);
    assert.match(body, /<input type="hidden" name="direction" value="desc"\/>/);
    assert.match(body, /name<\/a><\/th>.*model<\/a><\/th>.*size<span/s);
  },

  async "filter disclosure and value order survive a search"() {
    const many = Array.from({ length: 7 }, (unused, index) => ({
      value: `model-${index}`,
      n: 7 - index,
    }));
    const { body } = await call(
      "/syndex/search?type=grid&model=model-4&more=model&open=model&open=size",
      { DB: stubDb({ rows: { facets: many } }) },
    );

    assert.match(body, /data-filter-group="model" open/);
    assert.match(body, /data-filter-group="size" open/);
    assert.ok(
      body.indexOf('value="model-3"') < body.indexOf('value="model-4"'),
      "selecting a value must not move it",
    );
    assert.match(body, /name="open" value="model"/);
    assert.match(body, /\/syndex\/static\/filters\.js/);
  },

  async "htmx gets the panel and nothing around it"() {
    const env = { DB: stubDb() };
    const { body, headers } = await call("/syndex/search?type=grid", env, {
      headers: { "HX-Request": "true" },
    });

    assert.doesNotMatch(body, /<html/);
    assert.doesNotMatch(body, /doctype/i);
    assert.match(body, /^<div id="panel"/);
    // The rail is swapped with the table: its counts describe the search.
    assert.match(body, /id="filters"/);
    assert.equal(headers.get("cache-control"), "no-store");
    // A fragment carries no header, so it does not vary by who asked.
    assert.match(headers.get("vary"), /^HX-Request\b/);
  },

  async "dataset links preserve the filtered result URL"() {
    const { body } = await call(
      "/syndex/search?type=grid&model=BPASS&content=lines",
      { DB: stubDb() },
    );

    assert.match(
      body,
      /return=%2Fsyndex%2Fsearch%3Fmodel%3DBPASS%26content%3Dlines%26type%3Dgrid/,
    );
  },

  async "a dataset page prints the command that fetches it"() {
    const env = {
      DB: stubDb({
        rows: {
          datasets: [
            {
              ...GRID_ROW,
              dataset_id: 1,
              description: "A grid.\nWith another line.",
              licence: "CC-BY-4.0",
              metadata_json: "{}",
              provenance_json: JSON.stringify({
                source: "BPASS binary models",
                hdf5: {
                  date_created: "2025-09-27",
                  synthesizer_version: "0.9.7",
                },
              }),
              current_release_id: 2,
              filename: "bpass.hdf5",
              sha256: "e47f",
              synthesizer_min_version: "1.0.0",
              synthesizer_max_version: null,
              deprecated_at: null,
              known_bug_description: null,
            },
          ],
          citations: [
            {
              bibcode: "2017PASA...34...58E",
              doi: "10.1017/pasa.2017.51",
              authors: "Eldridge, J. J. and Stanway, E. R.",
              title: "Binary Population and Spectral Synthesis Version 2.1",
              year: 2017,
              journal: "PASA",
              bibtex: "@ARTICLE{2017PASA...34...58E, title = {BPASS} }",
            },
          ],
          grid: [
            {
              grid_type: "sps",
              emission_type: "photoionised",
              model_name: "BPASS",
              model_version: "2.2.1",
              model_parameters_json:
                '{"alpha":false,"imf_masses":[0.1,100],"sps_version":false}',
              photoionisation_code: null,
              photoionisation_code_version: null,
              photoionisation_parameters_json: JSON.stringify({
                geometry: "spherical",
                hydrogen_density: 100,
                ionisation_parameter: -2,
                depletion_model: "default",
                depletion_scale: 1,
                grains: true,
                cosmic_rays: true,
              }),
              available_spectra_json: "[]",
              available_lines_json: '["H 1 1215.67A","O 3 5006.84A"]',
              wavelength_min: null,
              wavelength_max: null,
              wavelength_units: null,
              incident_release_id: null,
            },
          ],
          releases: [
            {
              release_id: 2,
              published_at: "2026-09-04T16:47:01.550420Z",
              known_bug: 0,
              known_bug_description: null,
              synthesizer_min_version: "1.0.0",
              synthesizer_max_version: null,
              size_bytes: 203126664,
              sha256: "e47f",
            },
            {
              release_id: 1,
              published_at: "2025-01-02T00:00:00.000000Z",
              known_bug: 1,
              known_bug_description: "Superseded metadata.",
              synthesizer_min_version: "0.9.0",
              synthesizer_max_version: "0.9.9",
              size_bytes: 200000000,
              sha256: "abcd",
            },
          ],
        },
      }),
    };

    const returnTo = "/syndex/search?model=BPASS&content=lines&type=grid";
    const { status, body } = await call(
      `/syndex/datasets/${GRID_ROW.name}?return=${encodeURIComponent(returnTo)}`,
      env,
    );

    assert.equal(status, 200);
    assert.match(
      body,
      /href="\/syndex"[^>]*><img src="\/syndex\/static\/syndex_logo_2\.png"/,
    );
    assert.match(body, /A grid\. With another line\./);
    assert.match(
      body,
      /href="\/syndex\/search\?model=BPASS&amp;content=lines&amp;type=grid"/,
    );
    assert.match(body, /aria-label="Direct download bpass\.hdf5"/);
    assert.match(body, /<span role="tooltip"[^>]*>Direct download bpass\.hdf5<\/span>/);
    assert.match(
      body,
      new RegExp(
        `<span role="tooltip"[^>]*>synthesizer-download --dataset ${GRID_ROW.name}<\/span>`,
      ),
    );
    assert.match(body, /<div class="flex items-center justify-between gap-4">/);
    assert.match(body, /<div class="flex gap-3">/);
    assert.match(body, /<h1 class="mt-8 text-3xl/);
    assert.doesNotMatch(body, /Download directly or use the command-line tool|>\|\|<\/span>/);
    assert.doesNotMatch(body, />Get this dataset<\/h2>/);
    assert.match(body, new RegExp(`synthesizer-download --dataset ${GRID_ROW.name}`));
    assert.match(
      body,
      new RegExp(`data-copy-command="synthesizer-download --dataset ${GRID_ROW.name}"`),
    );
    assert.doesNotMatch(body, /Verifies the download/);
    assert.match(body, />File<\/h2>/);
    assert.match(body, /&gt;= 1\.0\.0<\/dd>/);
    assert.match(body, />SPS model parameters<\/h2>/);
    assert.match(body, />hydrogen density<\/dt>/);
    assert.doesNotMatch(body, />hydrogen_density<\/dt>/);
    assert.match(body, />Available lines \(2\)<\/h2>/);
    assert.match(body, /H 1 1215\.67 Å/);
    assert.match(body, />imf masses<\/dt><dd[^>]*>0\.1, 100<\/dd>/);
    assert.doesNotMatch(body, />alpha<\/dt>|>sps version<\/dt>/);
    assert.match(body, /10<sup class="text-\[0\.72em\] leading-none">11<\/sup>/);
    assert.match(
      body,
      />axis<\/th><th[^>]*>minimum<\/th><th[^>]*>maximum<\/th><th[^>]*>units<\/th><th[^>]*>points<\/th><th[^>]*>scale<\/th>/,
    );
    assert.match(body, />source<\/dt><dd[^>]*>BPASS binary models<\/dd>/);
    assert.match(body, />HDF5 · date created<\/dt><dd[^>]*>2025-09-27<\/dd>/);
    assert.match(body, />HDF5 · synthesizer version<\/dt><dd[^>]*>0\.9\.7<\/dd>/);
    assert.doesNotMatch(body, /&quot;date_created&quot;/);
    assert.match(body, /<div class="dataset-cards">/);
    assert.match(body, /<dl class="fields grid grid-cols-\[max-content_1fr\]/);
    assert.match(body, /<dl class="fields[^>]*many-fields">/);
    assert.equal(body.match(/many-fields/g)?.length, 1);
    assert.doesNotMatch(body, /full-card/);
    const sections = [
      "File",
      "Grid",
      "SPS model parameters",
      "Axes",
      "Photoionisation parameters",
      "Available lines (2)",
      "Releases",
      "Citations",
      "Provenance",
    ].map((title) => body.indexOf(`>${title}</h2>`));
    assert.ok(
      sections.every((position, index) => index === 0 || position > sections[index - 1]),
      "dataset sections follow their information hierarchy",
    );
    // Downloads are absolute: /v1 on this host is the org site, not the API.
    assert.match(
      body,
      /href="https:\/\/data\.synthesizer-project\.org\/v1\/releases\/2\/download"[^>]*aria-label="Direct download bpass\.hdf5"/,
    );
    assert.match(
      body,
      new RegExp(`data-copy-command="synthesizer-download --dataset ${GRID_ROW.name} --release 2"`),
    );
    assert.match(
      body,
      new RegExp(`data-copy-command="synthesizer-download --dataset ${GRID_ROW.name} --release 1"`),
    );
    assert.match(body, /aria-label="Direct download release 2"/);
    assert.match(body, /aria-label="Direct download release 1"/);
    assert.doesNotMatch(body, /synthesizer-download …/);
    // One copy control at the top of the page, one per release row, and one
    // on the citations card.
    assert.equal(
      body.match(/<rect x="8" y="8" width="14" height="14" rx="2"><\/rect>/g)
        ?.length,
      5,
    );
    assert.match(body, /aria-label="Copy the BibTeX entry"/);
    assert.match(body, /data-copy-text="@ARTICLE/);
    assert.match(body, />download<\/th>/);
    assert.match(body, />minimum version<\/th><th[^>]*>maximum version<\/th>/);
    assert.match(body, />0\.9\.0<\/td><td[^>]*>0\.9\.9<\/td>/);
    assert.doesNotMatch(body, />command<\/th>/);
    assert.doesNotMatch(body, />sha256<\/th>/);
    // A reference list shows the first author and year, not the full list,
    // and links out to ADS and the doi rather than reprinting a bibcode.
    assert.match(body, /Eldridge et al\./);
    assert.match(body, /\(2017\)/);
    assert.match(body, /ui\.adsabs\.harvard\.edu\/abs\/2017PASA\.\.\.34\.\.\.58E/);
    assert.match(body, /doi\.org\/10\.1017\/pasa\.2017\.51/);
    assert.match(body, /releases\/2\/citations\.bib/);
  },

  async "instrument filters get their own card"() {
    const name = "jwst-nircam";
    const { body } = await call(`/syndex/datasets/${name}`, {
      DB: stubDb({
        rows: {
          datasets: [{
            ...GRID_ROW,
            dataset_id: 3,
            name,
            display_name: "JWST NIRCam",
            data_type: "instrument",
            description: "NIRCam photometric instrument.",
            metadata_json: "{}",
            provenance_json: "{}",
            current_release_id: 2,
            filename: "nircam.hdf5",
            synthesizer_min_version: null,
            synthesizer_max_version: null,
            preview_path: null,
          }],
          grid: [],
          axes: [],
          releases: [],
          instrument: [{
            instrument_type: "photometric_imager",
            label: "NIRCam",
            filter_codes_json: '["F090W","F150W","F200W"]',
            wavelength_min: 0.6,
            wavelength_max: 5,
            wavelength_units: "μm",
            resolution: null,
            resolution_units: null,
            resolving_power: null,
            depth_json: null,
            psfs_json: null,
            noise_maps_json: null,
            capabilities_json: JSON.stringify({
              can_do_photometry: true,
              can_do_imaging: true,
            }),
          }],
        },
      }),
    });

    assert.match(body, />Instrument<\/h2>/);
    assert.match(body, />Filters \(3\)<\/h2>/);
    assert.match(body, /<li>F090W<\/li><li>F150W<\/li><li>F200W<\/li>/);
    assert.match(body, />Capabilities<\/h2>/);
    assert.match(body, /title="photometry: yes"/);
    assert.match(body, /title="spectroscopy: no"/);
    assert.doesNotMatch(body, />filters<\/dt>/);
    assert.doesNotMatch(body, />resolving power<\/dt>/);
  },

  async "a dataset that is not there says so as a page"() {
    const env = { DB: stubDb({ rows: { datasets: [] } }) };
    const { status, body } = await call("/syndex/datasets/nope", env);

    assert.equal(status, 404);
    assert.match(body, /no dataset named nope/);
    assert.match(body, /<html/);
  },

  async "a dataset page opens whatever the name contains"() {
    // The tab redirects were one regex route, `:tab{grids|dust|...}`, and `|`
    // binds loosest when Hono composes it: the pattern matched any path
    // containing "dust" or "instruments", or ending in "data". Every dust grid
    // redirected to the dust tab instead of opening.
    const env = { DB: stubDb({ rows: { datasets: [GRID_ROW] } }) };
    for (const name of [
      "draine-li-dust-extcurve-mrn",
      "dust",
      "euclid-nisp-instruments",
      "camels-simulation-data",
    ]) {
      const { status } = await call(`/syndex/datasets/${name}`, env);
      assert.equal(status, 200, `${name} should open, not redirect`);
    }

    // The tab shortcuts themselves still redirect onto the canonical search,
    // but temporarily and uncached: as a 308 this route's earlier mistake was
    // learned permanently by every browser that saw it, and no server-side fix
    // could reach them.
    for (const [path, target] of [
      ["/syndex/grids", "/syndex/search?type=grid"],
      ["/syndex/dust", "/syndex/search?type=dust_grid"],
      ["/syndex/instruments", "/syndex/search?type=instrument"],
      ["/syndex/data", "/syndex/search"],
    ]) {
      const reply = await call(path, env);
      assert.equal(reply.status, 307, path);
      assert.equal(reply.headers.get("location"), target, path);
      assert.equal(reply.headers.get("cache-control"), "no-store", path);
    }
  },

  async "a history restore gets a whole page, not a fragment"() {
    // htmx replaces the body with whatever a restore returns, so a fragment
    // there leaves the page as a bare results panel with no layout.
    const env = { DB: stubDb() };
    const fragmentReply = await call("/syndex/search", env, {
      headers: { "HX-Request": "true" },
    });
    assert.doesNotMatch(fragmentReply.body, /<!doctype html>/i);

    const restored = await call("/syndex/search", env, {
      headers: { "HX-Request": "true", "HX-History-Restore-Request": "true" },
    });
    assert.match(restored.body, /<!doctype html>/i);
    assert.match(restored.body, /<title>/);
    assert.match(
      restored.headers.get("vary"),
      /HX-History-Restore-Request/,
    );
  },

  async "a new release keeps the name of the dataset it belongs to"() {
    const dataset = {
      dataset_id: 12,
      name: "bpass-2p2p1-bin-chabrier03-0p1-300p0",
      display_name: "BPASS 2.2.1 binary",
      description: "A grid.",
      data_type: "grid",
      licence: "CC-BY-4.0",
    };

    // The form comes filled in from the dataset, with the name fixed.
    const { body } = await call(
      `/syndex/submit/new?release=${dataset.name}`,
      contributorEnv({ rows: { releaseOf: [dataset] } }),
      SIGNED_IN,
    );
    assert.match(body, /A new release/);
    assert.match(body, /<input type="hidden" name="release_of" value="12"/);
    assert.match(body, /name="name"[^>]*readonly/);

    // And it is accepted under a name that is already in the catalogue,
    // which is the whole point.
    const issued = [];
    const accepted = await postSubmission(
      contributorEnv({ rows: { published: [{ dataset_id: 12 }] }, issued }),
      { name: dataset.name, release_of: "12" },
    );
    assert.equal(accepted.status, 303);
    assert.equal(statement(issued, "INSERT INTO submissions").params.at(-1), 12);
  },

  async "a release cannot be attached to a dataset it does not name"() {
    // Otherwise the hidden field is a way to attach a file to any dataset in
    // the catalogue by naming a different one.
    const { status, body } = await postSubmission(
      contributorEnv({ rows: { published: [{ dataset_id: 99 }] } }),
      { name: "some-other-dataset", release_of: "12" },
    );

    assert.equal(status, 400);
    assert.match(body, /keep the name of the dataset it belongs to/);
  },

  async "an existing name is pointed at the release route, not just refused"() {
    const { status, body } = await postSubmission(
      contributorEnv({ rows: { published: [{ dataset_id: 12 }] } }),
    );

    assert.equal(status, 400);
    assert.match(body, /submit a new release of it instead/);
  },

  async "picking a dataset to release is the catalogue's own search"() {
    // Not a second search beside it. The mode rides in the filters, so every
    // rail link, sort header and htmx swap carries it without knowing it
    // exists -- and the only thing it changes is where a result goes.
    const redirect = await call(
      "/syndex/submit/release",
      contributorEnv(),
      SIGNED_IN,
    );
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "/syndex/search?pick=release");

    const { body } = await call(
      "/syndex/search?pick=release",
      { DB: stubDb({ rows: { viewer: USER } }) },
      SIGNED_IN,
    );

    assert.match(body, /Which dataset/);
    // A result goes to the submission form rather than to a dataset page.
    assert.match(
      body,
      new RegExp(`href="/syndex/submit/new\\?release=${GRID_ROW.name}"`),
    );
    assert.doesNotMatch(body, new RegExp(`/syndex/datasets/${GRID_ROW.name}`));
    // And the mode travels with everything that changes the list: the rail's
    // links, and the filter form's own hidden state.
    assert.match(body, /pick=release/);
    assert.match(body, /<input type="hidden" name="pick" value="release"/);

    // Nothing to select and nothing to download: the boxes are what would
    // otherwise say "tick these" when the thing to do is click a name.
    assert.doesNotMatch(body, /data-dataset-select/);
    assert.doesNotMatch(body, /data-select-all/);
    assert.doesNotMatch(body, /Get download command/);
  },

  async "browsing keeps the selection controls the picker drops"() {
    const { body } = await call("/syndex/search", { DB: stubDb() });

    assert.match(body, /data-dataset-select/);
    assert.match(body, /data-select-all/);
    assert.match(body, /Get download command/);
  },

  async "a submission can be started again from one already sent"() {
    const previous = {
      name: "example-grid",
      display_name: "Example grid",
      description: "A grid.",
      data_type: "dust_grid",
      licence: "CC-BY-4.0",
      citations: ["2017PASA...34...58E", "2020MNRAS.491..944C"].join("\n"),
      notes: "Replacing a truncated file.",
    };
    const { body } = await call(
      "/syndex/submit/new?like=tok-1",
      contributorEnv({ rows: { submission: previous } }),
      SIGNED_IN,
    );

    // Everything comes back, so changing one detail does not mean retyping
    // six -- which is how somebody is put off fixing a rejected submission.
    assert.match(body, /value="example-grid"/);
    assert.match(body, /<option value="dust_grid" selected/);
    assert.match(body, /value="CC-BY-4.0"/);
    assert.match(body, /value="2017PASA...34...58E"/);
    assert.match(body, /value="2020MNRAS.491..944C"/);
    // And the questions answer themselves from what was answered last time.
    assert.match(body, /id="has_citations"[^>]*checked/);
    assert.match(body, /id="has_licence"[^>]*checked/);
    // A type is chosen, so the rest of the form is not hidden.
    assert.doesNotMatch(body, /<option value="" disabled="" selected=""/);
  },

  async "one contributor cannot start again from another's submission"() {
    // The token addresses a submission and does not authorise reading it.
    const { body } = await call(
      "/syndex/submit/new?like=somebody-elses",
      contributorEnv({ rows: { submission: undefined } }),
      SIGNED_IN,
    );

    assert.match(body, /<option value="" disabled="" selected=""/);
    assert.doesNotMatch(body, /value="example-grid"/);
  },

  async "the form asks nothing until it knows what it is being told about"() {
    const { body } = await call("/syndex/submit/new", contributorEnv(), SIGNED_IN);

    // No type is chosen, and the placeholder is what is selected -- so the
    // CSS that hides everything below it applies.
    assert.match(body, /<option value="" disabled="" selected="">Select a data/);
    assert.doesNotMatch(body, /<option value="grid" selected/);
    assert.match(body, /class="needs-type contents"/);

    // The example sits in the box as placeholder text, starting on the
    // commonest type; submit.js swaps it when another is chosen.
    assert.match(body, /placeholder="bpass-2p2p1-bin-chabrier03-0p1-300p0"/);
    assert.match(body, /No spaces/);
    // Every type's example travels with the form, so the swap needs no
    // request and works the moment the select changes.
    assert.match(body, /data-examples="/);
    assert.match(body, /svo-filter-cache/);

    // Citation and licence are separate questions and separate cards.
    assert.match(body, /<legend[^>]*>Citation<\/legend>/);
    assert.match(body, /<legend[^>]*>Licence<\/legend>/);
  },

  async "the form can describe every kind of data the catalogue holds"() {
    // reference_data was in the catalogue and missing from this list, so
    // there was a kind of dataset nobody could submit.
    const { body } = await call("/syndex/submit/new", contributorEnv(), SIGNED_IN);
    for (const type of [
      "grid",
      "dust_grid",
      "instrument",
      "simulation_data",
      "generation_data",
      "synference_data",
      "reference_data",
      "cache",
      // Not a catalogue type: a submission saying "this is none of those",
      // which beats a contributor picking whichever listed type is least
      // wrong and a reviewer then having to work out that they did.
      "other",
    ]) {
      assert.match(body, new RegExp(`<option value="${type}"`));
    }
  },

  async "other is accepted, and does not reach syndex-upload as a type"() {
    const accepted = await postSubmission(contributorEnv(), {
      data_type: "other",
    });
    assert.equal(accepted.status, 303);

    const { body } = await call(
      "/syndex/review/1",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "reviewer" },
          submissions: [
            {
              ...SUBMISSION,
              data_type: "other",
              uploaded_at: "2026-09-14T10:00:00Z",
              uploaded_size_bytes: 10,
            },
          ],
        },
      }),
      SIGNED_IN,
    );

    // Publishing it as "other" would put a non-type into the catalogue, so
    // the command asks the reviewer for one instead of offering a default.
    assert.match(body, /--data-type CHOOSE-A-TYPE/);
    assert.doesNotMatch(body, /--data-type other/);
    assert.match(body, /the type is yours to choose/);
  },

  async "a contributor is told what the checker found and what was decided"() {
    // Being told a submission was rejected and not why is the one thing worse
    // than not being told at all.
    const { body } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}`,
      contributorEnv({
        rows: {
          submission: {
            ...SUBMISSION,
            state: "rejected",
            uploaded_at: "2026-09-14T10:00:00Z",
            uploaded_size_bytes: 10,
            reviewed_at: "2026-09-15T09:00:00Z",
            reviewer_note: "The axes are named in the singular.",
            validation_state: "failed",
            validation_report_json: JSON.stringify({
              state: "failed",
              errors: ["the grid does not say what kind of grid it is"],
            }),
          },
        },
      }),
      SIGNED_IN,
    );

    assert.match(body, /Not accepted/);
    assert.match(body, /The axes are named in the singular/);
    assert.match(body, /does not say what kind of grid it is/);
    // And a way to act on it rather than starting from nothing.
    assert.match(body, /submit\/new\?like=/);
    // The reviewer's prompt to run the checker themselves is not for them.
    assert.doesNotMatch(body, /Fetch the file and run/);
  },

  async "a contributor can find their way back to a submission"() {
    // The upload page is addressed by a token that exists only in its URL, so
    // without this list closing the tab loses a half-finished transfer.
    const { body } = await call(
      "/syndex/submit",
      contributorEnv({
        rows: {
          submissions: [
            {
              ...SUBMISSION,
              upload_token: "tok-1",
              name: "half-sent",
              uploaded_at: null,
            },
          ],
        },
      }),
      SIGNED_IN,
    );

    assert.match(body, /Your submissions/);
    assert.match(body, /href="\/syndex\/submit\/tok-1"/);
    assert.match(body, /no file sent yet/);
  },

  async "an unconfigured portal says so rather than taking a file"() {
    // The bucket is the only configuration left. Without it the form renders
    // closed and the handler refuses, instead of accepting a file it has
    // nowhere to put.
    const env = { DB: stubDb({ rows: { viewer: USER } }) };
    const { body } = await call("/syndex/submit/new", env, SIGNED_IN);
    assert.match(body, />Not open yet<\/p>/);
    // A closed door still has to say where to knock.
    assert.match(body, /github\.com\/synthesizer-project\/synthesizer\/issues/);
    assert.doesNotMatch(body, /action="\/syndex\/submit\/new"/);
    assert.equal((await postSubmission(env)).status, 503);

    // The chooser says the same thing, since neither route can take a file.
    const chooser = await call("/syndex/submit", env, SIGNED_IN);
    assert.match(chooser.body, />Not open yet<\/p>/);
    assert.doesNotMatch(chooser.body, /New release/);

    // Configured, the form is there.
    const open = contributorEnv();
    const offered = await call("/syndex/submit/new", open, SIGNED_IN);
    assert.match(offered.body, /action="\/syndex\/submit\/new"/);
    assert.doesNotMatch(offered.body, />Not open yet<\/p>/);
    // Turnstile told a script from a person on an anonymous form. There is
    // no anonymous form.
    assert.doesNotMatch(offered.body, /cf-turnstile/);
    // And it no longer asks for a name and address the account already has.
    assert.doesNotMatch(offered.body, /name="submitter_email"/);
  },

  async "the upload page leads with the browser and folds the CLI away"() {
    const env = contributorEnv({ rows: { submission: SUBMISSION } });
    const { body } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}`,
      env,
      SIGNED_IN,
    );

    // The browser is the way most files go up, so it is the open one; the
    // command line is folded away until a file needs it.
    assert.match(body, /id="browser-upload"/);
    assert.match(body, /Upload the file/);
    assert.match(body, /<details id="cli-upload"/);
    assert.doesNotMatch(body, /<details id="cli-upload" open/);
    assert.match(body, /Upload with the CLI/);

    // Both limits are stated, from the same constants.
    assert.match(body, /Up to 10 GB from a browser/);
    assert.match(body, /up to 189 GB rather than 10 GB/);

    // The token is what attaches the file to this submission.
    assert.match(
      body,
      new RegExp(`syndex-submit ${SUBMISSION.upload_token}`),
    );
    assert.match(body, /data-part-size="94371840"/);
    assert.match(body, /data-max-parts="106"/);
    assert.doesNotMatch(body, /AWS_ACCESS_KEY_ID/);
    assert.doesNotMatch(body, /sha256/i);
  },

  async "a part is streamed into storage and recorded by number"() {
    const issued = [];
    const env = contributorEnv({ rows: { submission: SUBMISSION }, issued });
    const { status } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/part/3`,
      env,
      { method: "POST", body: "0123456789", headers: { cookie: SESSION_COOKIE } },
    );

    assert.equal(status, 200);
    // The bytes reached R2 as a stream, not as something this code read.
    assert.deepEqual(env.uploaded.parts, [{ partNumber: 3, size: 10 }]);
    // Recorded so that re-sending the same part replaces it rather than
    // adding a second entry for it.
    const recorded = statement(issued, "INSERT INTO submission_parts");
    assert.match(recorded.sql, /ON CONFLICT \(submission_id, part_number\)/);
    assert.deepEqual(recorded.params, [SUBMISSION.submission_id, 3, "etag-3"]);
  },

  async "the ceiling is a part count, which a client cannot misreport"() {
    // The service's ceiling, not the browser's. A terminal client resumes, so
    // it is allowed files a tab would be the wrong tool for.
    const env = contributorEnv({ rows: { submission: SUBMISSION } });
    const { status, body } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/part/2001`,
      env,
      { method: "POST", body: "x", headers: { cookie: SESSION_COOKIE } },
    );

    assert.equal(status, 413);
    assert.match(body, /at most 2000 parts/);
    assert.deepEqual(env.uploaded.parts, []);
  },

  async "a submission that already has its file takes no more parts"() {
    const env = contributorEnv({
      rows: {
        submission: {
          ...SUBMISSION,
          uploaded_at: "2026-09-14T10:00:00Z",
        },
      },
    });
    const { status } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/part/1`,
      env,
      { method: "POST", body: "x", headers: { cookie: SESSION_COOKIE } },
    );

    assert.equal(status, 409);
    assert.deepEqual(env.uploaded.parts, []);
  },

  async "one submission belongs to one account"() {
    // The token addresses a submission; it does not authorise it. Someone
    // else's token is not a way into their upload.
    const env = contributorEnv({
      rows: { submission: { ...SUBMISSION, user_id: 99 } },
    });

    assert.equal(
      (await call(`/syndex/submit/${SUBMISSION.upload_token}`, env, SIGNED_IN))
        .status,
      404,
    );
    assert.equal(
      (
        await call(`/syndex/submit/${SUBMISSION.upload_token}/part/1`, env, {
          method: "POST",
          body: "x",
          headers: { cookie: SESSION_COOKIE },
        })
      ).status,
      404,
    );

    // A reviewer may open anybody's, since reading them is the job.
    const reviewer = contributorEnv({
      rows: {
        viewer: { ...USER, role: "reviewer" },
        submission: { ...SUBMISSION, user_id: 99 },
      },
    });
    assert.equal(
      (
        await call(
          `/syndex/submit/${SUBMISSION.upload_token}`,
          reviewer,
          SIGNED_IN,
        )
      ).status,
      200,
    );
  },

  async "completion assembles the parts and believes the bucket"() {
    const issued = [];
    const key = `submissions/${SUBMISSION.upload_token}/example-grid`;
    const env = contributorEnv({
      rows: {
        submission: SUBMISSION,
        parts: [
          { part_number: 1, etag: "etag-1" },
          { part_number: 2, etag: "etag-2" },
        ],
      },
      objects: [{ key, size: 4096 }],
      issued,
    });

    const { status, headers } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/complete`,
      env,
      signedInPost({ expected_size: "4096" }),
    );

    assert.equal(status, 303);
    assert.equal(
      headers.get("location"),
      `/syndex/submit/${SUBMISSION.upload_token}`,
    );
    assert.deepEqual(env.uploaded.completed, [
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
    ]);

    // The size is what R2 says, not what anything else claimed.
    const update = statement(issued, "SET uploaded_at");
    assert.equal(update.params[1], 4096);
    assert.equal(update.params[2], key);
  },

  async "a transfer that stopped part way is not marked as complete"() {
    const issued = [];
    const key = `submissions/${SUBMISSION.upload_token}/example-grid`;
    const env = contributorEnv({
      rows: { submission: SUBMISSION, parts: [{ part_number: 1, etag: "e" }] },
      objects: [{ key, size: 1024 }],
      issued,
    });

    const { status, body } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/complete`,
      env,
      // The browser knows what it set out to send; the bucket knows what it
      // holds. A mismatch is the one failure a transfer this long has.
      signedInPost({ expected_size: "8192" }),
    );

    assert.equal(status, 409);
    assert.match(body, /1 kB arrived, out of 8.2 kB/);
    assert.throws(() => statement(issued, "SET uploaded_at"));
  },

  async "an upload that never arrived says so"() {
    const env = contributorEnv({
      rows: { submission: { ...SUBMISSION, filename: "example-grid.hdf5" } },
      objects: [],
    });
    const { status, body } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/complete`,
      env,
      signedInPost({}),
    );

    assert.equal(status, 404);
    assert.match(body, /Nothing arrived/);
  },

  async "an unknown token is not a way to browse the queue"() {
    const env = contributorEnv({ rows: { submission: undefined } });
    const { status, body } = await call("/syndex/submit/nope", env, SIGNED_IN);

    assert.equal(status, 404);
    assert.doesNotMatch(body, /example-grid/);
  },

  async "the form refuses what the catalogue could not store"() {
    const env = contributorEnv();

    const badName = await postSubmission(env, { name: "Not A Name" });
    assert.equal(badName.status, 400);
    assert.match(badName.body, /lowercase letters, digits and hyphens/);

    const badType = await postSubmission(env, { data_type: "nonsense" });
    assert.equal(badType.status, 400);
    assert.match(badType.body, /one of the listed data types/);

    const badBibcode = await postSubmission(env, {
      has_citations: "yes",
      citation: "not-a-bibcode",
    });
    assert.equal(badBibcode.status, 400);
    assert.match(badBibcode.body, /Not an ADS bibcode/);

    // Saying yes and then giving nothing is a question half answered.
    const empty = await postSubmission(env, { has_citations: "yes" });
    assert.equal(empty.status, 400);
    assert.match(empty.body, /at least one bibcode/);

    // A real one is accepted, which is what stops the check being a nuisance.
    const good = await postSubmission(env, {
      has_citations: "yes",
      citation: "2017PASA...34...58E",
    });
    assert.equal(good.status, 303);
  },

  async "a question unticked is the answer, whatever the hidden boxes hold"() {
    const issued = [];
    const env = contributorEnv({ issued });

    // A hidden field still submits. Somebody who fills a box and then unticks
    // the question has changed their mind, and the tick is what to honour --
    // so this must be accepted rather than refused for a bad bibcode, and
    // must store neither the bibcode nor the licence.
    const { status } = await call(
      "/syndex/submit/new",
      env,
      signedInPost({
        name: "example-grid",
        display_name: "Example grid",
        data_type: "grid",
        citation: "not-a-bibcode",
        licence: "whatever",
      }),
    );

    assert.equal(status, 303);
    const insert = statement(issued, "INSERT INTO submissions");
    assert.ok(!insert.params.includes("not-a-bibcode"));
    assert.ok(!insert.params.includes("whatever"));
  },

  async "several citation rows arrive as several citations"() {
    const issued = [];
    const env = contributorEnv({ issued });
    const body = new URLSearchParams([
      ["name", "example-grid"],
      ["display_name", "Example grid"],
      ["data_type", "grid"],
      ["has_citations", "yes"],
      // Repeated, which is how the form sends one box per reference.
      ["citation", "2017PASA...34...58E"],
      ["citation", "2020MNRAS.491..944C"],
      ["citation", ""],
    ]);
    const { status } = await call("/syndex/submit/new", env, {
      method: "POST",
      body,
      headers: {
        cookie: SESSION_COOKIE,
        "content-type": "application/x-www-form-urlencoded",
      },
    });

    assert.equal(status, 303);
    // Empty rows are not citations, and the rest are stored one per line.
    const insert = statement(issued, "INSERT INTO submissions");
    assert.ok(
      insert.params.includes("2017PASA...34...58E\n2020MNRAS.491..944C"),
    );
  },

  async "a name already in the catalogue is refused before any bytes are sent"() {
    const { status, body } = await postSubmission(
      contributorEnv({ rows: { published: [{ 1: 1 }] } }),
    );

    assert.equal(status, 400);
    assert.match(body, /is already in the catalogue/);
  },

  async "somebody else's pending name is refused, your own is not"() {
    const theirs = await postSubmission(
      contributorEnv({
        rows: {
          waiting: [{ submission_id: 5, upload_token: "tok-5", user_id: 99 }],
        },
      }),
    );
    assert.equal(theirs.status, 400);
    assert.match(theirs.body, /Somebody else is already submitting/);

    // Your own is the same person submitting the same dataset again, which is
    // what resubmitting is. It updates the row rather than refusing, so an
    // abandoned registration cannot block the thing it was created for.
    const issued = [];
    const ours = await postSubmission(
      contributorEnv({
        rows: {
          waiting: [
            { submission_id: 5, upload_token: "tok-5", user_id: USER.user_id },
          ],
        },
        issued,
      }),
      { display_name: "A better name" },
    );

    assert.equal(ours.status, 303);
    assert.equal(ours.headers.get("location"), "/syndex/submit/tok-5");
    // Brought up to date rather than duplicated: no second row, and the token
    // and whatever file it already has are kept.
    assert.throws(() => statement(issued, "INSERT INTO submissions"));
    const update = statement(issued, "UPDATE submissions\n       SET display_name");
    assert.equal(update.params[0], "A better name");
  },

  async "one account may not fill the queue on its own"() {
    const mine = contributorEnv({ rows: { queue: { mine: 10, everyone: 10 } } });
    const refused = await postSubmission(mine);
    assert.equal(refused.status, 400);
    assert.match(refused.body, /most one account may have at a time/);

    const everyone = contributorEnv({ rows: { queue: { mine: 0, everyone: 50 } } });
    const full = await postSubmission(everyone);
    assert.equal(full.status, 400);
    assert.match(full.body, /review queue is full/);
  },

  async "a registered submission fixes its own key"() {
    const issued = [];
    const env = contributorEnv({ issued });
    await postSubmission(env, { name: "example-grid" });

    // The key comes from the catalogue name, decided before a byte is
    // accepted, so one submission is one object whatever a later request says
    // the file is called.
    const insert = statement(issued, "INSERT INTO submissions");
    assert.ok(insert.params.includes("example-grid"));
    // And it is owned, which is what makes the per-account cap mean anything.
    // The last column is the dataset a release belongs to: nothing, here.
    assert.equal(insert.params.at(-2), USER.user_id);
    assert.equal(insert.params.at(-1), null);
  },

  async "the review queue needs a reviewer, not a shared password"() {
    // Nobody signed in: offered the sign-in rather than a 404, since that is
    // the step they are missing.
    const anonymous = await call("/syndex/review", { DB: stubDb() });
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.body, /Sign in/);

    // Signed in, but without the role. Refused, and told what it would take.
    const contributor = await call("/syndex/review", {
      DB: stubDb({ rows: { viewer: USER } }),
    }, SIGNED_IN);
    assert.equal(contributor.status, 403);
    assert.match(contributor.body, /for reviewers, and your account is a/);

    const reviewer = await call("/syndex/review", {
      DB: stubDb({ rows: { viewer: { ...USER, role: "reviewer" } } }),
    }, SIGNED_IN);
    assert.equal(reviewer.status, 200);
    assert.match(reviewer.body, /Nothing waiting to be read/);
    // An empty queue shows nothing but that it is empty: the access section
    // and the decided list are only there when they hold something.
    assert.doesNotMatch(reviewer.body, /Waiting for access/);
    assert.doesNotMatch(reviewer.body, /Already decided/);
  },

  async "the queue summarises, and the deciding happens on its own page"() {
    const { body } = await call(
      "/syndex/review",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "reviewer" },
          submissions: [
            {
              ...SUBMISSION,
              submission_id: 1,
              uploaded_at: "2026-09-14T10:00:00Z",
              uploaded_size_bytes: 6969264,
            },
          ],
          decided: [
            {
              submission_id: 2,
              name: "older-grid",
              state: "rejected",
              reviewed_at: "2026-09-13T10:00:00Z",
            },
          ],
          approvedCount: 3,
          rejectedCount: 1,
        },
      }),
      SIGNED_IN,
    );

    // A card per waiting submission, carrying what decides whether to open it.
    assert.match(body, /Waiting to be read \(1\)/);
    assert.match(body, /href="\/syndex\/review\/1"/);
    assert.match(body, />grid</);
    assert.match(body, />7 MB</);
    assert.match(body, /A Contributor/);

    // And nothing that belongs on the submission's own page.
    assert.doesNotMatch(body, /Approve/);
    assert.doesNotMatch(body, /wrangler r2 object get/);

    // One card for everything settled. What happens to a submission is the
    // useful summary; how many have been looked at is not.
    assert.match(body, /Past submissions/);
    assert.match(body, />3<\/span><span class="label-caps">approved/);
    assert.match(body, />1<\/span><span class="label-caps">rejected/);
    assert.match(body, /older-grid/);
    assert.match(body, /href="\/syndex\/review\/previous"/);
  },

  async "a submission is decided on a page of its own"() {
    const env = submissionEnv({
      rows: {
        viewer: { ...USER, role: "reviewer" },
        submissions: [
          {
            ...SUBMISSION,
            uploaded_at: "2026-09-14T10:00:00Z",
            uploaded_size_bytes: 6969264,
          },
        ],
      },
    });
    const { status, body } = await call("/syndex/review/1", env, SIGNED_IN);

    assert.equal(status, 200);
    // Everything the card left out.
    assert.match(body, /Approve/);
    assert.match(body, /Reject/);
    assert.match(body, /wrangler r2 object get/);
    assert.match(body, /Back to the queue/);
    // Three steps, each acknowledged before its command is shown: approving
    // without having opened the file is approving something nobody has read.
    assert.match(body, /Fetch the file/);
    assert.match(body, /Check it yourself/);
    assert.match(body, /Publish it/);
    assert.match(body, /id="fetch-7"[^>]*class="peer/);
    // Steps in one list, so the CSS that gates each on the one before it has
    // siblings to walk.
    assert.match(body, /class="review-steps/);
    assert.equal(body.match(/class="review-step"/g).length, 3);
  },

  async "the checker's verdict reaches the reviewer"() {
    const report = {
      state: "failed",
      data_type: "grid",
      reason: "axes plus spectra, but nothing identifying which kind of grid",
      format: "hdf5",
      errors: ["the grid does not say what kind of grid it is"],
      warnings: ["axis 'age' is singular"],
      detected: { grid_type: null, axes: [{ name: "age", count: 2 }] },
    };
    const { body } = await call(
      "/syndex/review/1",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "reviewer" },
          submissions: [
            {
              ...SUBMISSION,
              uploaded_at: "2026-09-14T10:00:00Z",
              uploaded_size_bytes: 10,
              validation_state: "failed",
              validation_report_json: JSON.stringify(report),
              detected_data_type: "grid",
              sha256: "b".repeat(64),
              validated_at: "2026-09-14T10:02:00Z",
            },
          ],
        },
      }),
      SIGNED_IN,
    );

    // The error is the reason a submission gets sent back, so it is in the
    // open rather than behind something to expand.
    assert.match(body, /does not say what kind of grid it is/);
    assert.match(body, />failed</);
    assert.match(body, /1 warning/);
    assert.match(body, /b{64}/);
  },

  async "bytes already in the catalogue are said so before anything else"() {
    const { body } = await call(
      "/syndex/review/1",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "reviewer" },
          submissions: [
            {
              ...SUBMISSION,
              uploaded_at: "2026-09-14T10:00:00Z",
              sha256: "c".repeat(64),
            },
          ],
          publishedTwin: [{ name: "bpass-2p2p1-bin-chabrier03-0p1-300p0" }],
        },
      }),
      SIGNED_IN,
    );

    assert.match(body, /byte for byte the same file as/);
    assert.match(body, /bpass-2p2p1-bin-chabrier03-0p1-300p0/);
    assert.match(body, /Already in the catalogue/);
    // A file that is already published passes every check there is -- it is
    // a valid grid, because it is a grid that was published. It still cannot
    // go anywhere, so the verdict must not read as a pass.
    assert.match(body, /<h2[^>]*>Validation<\/h2><span[^>]*>failed</);
    assert.doesNotMatch(body, />passed</);
  },

  async "a verdict is only taken from the runner that was asked"() {
    const env = submissionEnv({ rows: {} });
    env.SYNDEX_REPORT_SECRET = "a-shared-secret";

    const unsigned = await call("/syndex/validate/1", env, {
      method: "POST",
      body: JSON.stringify({ state: "passed" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(unsigned.status, 403);

    const wrong = await call("/syndex/validate/1", env, {
      method: "POST",
      body: JSON.stringify({ state: "passed" }),
      headers: {
        authorization: "Bearer not-the-secret",
        "content-type": "application/json",
      },
    });
    assert.equal(wrong.status, 403);
  },

  async "a report of an unexpected shape is read as a failure"() {
    const issued = [];
    const env = submissionEnv({ rows: { roleChange: { submission_id: 1 } }, issued });
    env.SYNDEX_REPORT_SECRET = "a-shared-secret";

    // The runner installs a version of the checker this Worker did not, so a
    // state it does not recognise has to mean "a person should look", never
    // "let it through".
    await call("/syndex/validate/1", env, {
      method: "POST",
      body: JSON.stringify({ state: "brilliant", sha256: "not-a-digest" }),
      headers: {
        authorization: "Bearer a-shared-secret",
        "content-type": "application/json",
      },
    });

    const update = statement(issued, "SET validation_state");
    assert.equal(update.params[0], "failed");
    assert.equal(update.params[3], null);
  },

  async "a submission that is not there says so"() {
    const { status } = await call(
      "/syndex/review/999",
      submissionEnv({
        rows: { viewer: { ...USER, role: "reviewer" }, submissions: [] },
      }),
      SIGNED_IN,
    );

    assert.equal(status, 404);
  },

  async "the waiting badge counts after the decision, not before it"() {
    const issued = [];
    await call(
      "/syndex/review/7",
      submissionEnv({
        rows: { viewer: { ...USER, role: "reviewer" } },
        issued,
      }),
      signedInPost({ decision: "approved" }),
    );

    // The count used to be taken when the request arrived, so a queue
    // rendered back after a decision still included the thing just decided
    // and the badge kept its number until the page was reloaded by hand.
    const decided = issued.findIndex((one) => one.sql.includes("UPDATE submissions"));
    const counted = issued.findIndex((one) => one.sql.includes("AS waiting"));
    assert.ok(decided !== -1, "the decision was written");
    assert.ok(counted !== -1, "the badge was counted");
    assert.ok(counted > decided, "counted after the write, not before it");
  },

  async "an issue says where to act and who it will work for"() {
    // The issue is read by everyone who can see the repository, which is a
    // wider group than the people who can act on it.
    const { notifySubmission } = await import("../src/portal/notify.js");
    const sent = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      sent.push(JSON.parse(init.body));
      return Response.json({}, { status: 201 });
    };
    try {
      await notifySubmission(
        { GITHUB_ISSUE_REPO: "o/r", GITHUB_ISSUE_TOKEN: "t" },
        "https://synthesizer-project.org",
        { ...SUBMISSION, uploaded_size_bytes: 10 },
      );
    } finally {
      globalThis.fetch = real;
    }

    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /https:\/\/synthesizer-project\.org\/syndex\/review/);
    assert.match(sent[0].body, /needs the reviewer role/);
    // An address given to a reviewer is not for a repository's readers.
    assert.doesNotMatch(sent[0].body, /@example\.org/);
  },

  async "reviewing records a decision and does not publish anything"() {
    const { status, body } = await call("/syndex/review/7", {
      DB: stubDb({ rows: { viewer: { ...USER, role: "reviewer" } } }),
    }, signedInPost({ decision: "approved", reviewer_note: "Fine" }));

    assert.equal(status, 200);
    assert.match(body, /marked approved/);
  },

  async "the tabs are in the bar on a wide screen and the menu on a narrow one"() {
    const { body } = await call("/syndex/search", {
      DB: stubDb({ rows: { viewer: { ...USER, role: "admin" }, waiting: 2 } }),
      ...{},
    }, SIGNED_IN);

    // One definition, placed twice: the bar hides below sm, the menu's copy
    // shows only there. Four tabs beside four buttons is mostly header.
    assert.match(body, /aria-label="Data types" class="hidden[^"]*sm:flex"/);
    assert.match(body, /<span class="label-caps px-3 pt-1 sm:hidden">Catalogue/);

    // And everything about the reader is in the one control, with the count
    // on the button so it is visible without opening it.
    assert.match(body, /class="header-menu/);
    // The one thing a details element cannot do for itself.
    assert.match(body, /static\/header\.js/);
    assert.match(body, /href="\/syndex\/review"/);
    assert.match(body, /href="\/syndex\/accounts"/);
    assert.match(body, /href="\/syndex\/account"/);
    assert.match(body, /action="\/syndex\/logout"/);
  },

  async "a signed-in page is never cached by anything shared"() {
    const anonymous = await call("/syndex/search", { DB: stubDb() });
    assert.equal(anonymous.headers.get("cache-control"), "public, max-age=60");

    const signedIn = await call("/syndex/search", {
      DB: stubDb({ rows: { viewer: USER } }),
    }, SIGNED_IN);
    assert.equal(signedIn.headers.get("cache-control"), "private, no-store");
  },

  async "the header offers what the reader can actually do"() {
    const anonymous = (await call("/syndex/search", { DB: stubDb() })).body;
    assert.match(anonymous, /Sign in/);
    assert.doesNotMatch(anonymous, /syndex\/account/);
    assert.doesNotMatch(anonymous, /Sign out/);
    assert.doesNotMatch(anonymous, /href="\/syndex\/review"/);

    const contributor = (
      await call("/syndex/search", {
        DB: stubDb({ rows: { viewer: USER } }),
      }, SIGNED_IN)
    ).body;
    // The menu holds everything about you, the account page included.
    assert.match(contributor, /href="\/syndex\/account"/);
    assert.match(contributor, /Sign out/);
    assert.doesNotMatch(contributor, /href="\/syndex\/review"/);

    const reviewer = (
      await call("/syndex/search", {
        DB: stubDb({ rows: { viewer: { ...USER, role: "reviewer" }, waiting: 4 } }),
      }, SIGNED_IN)
    ).body;
    assert.match(reviewer, /href="\/syndex\/review"/);
    // The badge says how much is waiting, so it is seen without going looking.
    assert.match(reviewer, />4</);
  },

  async "submitting needs access, and a pending account is told where to ask"() {
    const anonymous = await call("/syndex/submit", { DB: stubDb() });
    assert.equal(anonymous.status, 401);

    const pending = await call("/syndex/submit", {
      DB: stubDb({ rows: { viewer: { ...USER, role: "pending" } } }),
    }, SIGNED_IN);
    assert.equal(pending.status, 303);
    assert.equal(pending.headers.get("location"), "/syndex/access");

    const contributor = await call("/syndex/submit", {
      DB: stubDb({ rows: { viewer: USER } }),
    }, SIGNED_IN);
    assert.equal(contributor.status, 200);
  },

  async "a full list of submissions has a page rather than a link back"() {
    // "All your submissions" used to point at the page that starts a new one,
    // which read like a way out and was a way back to where you already were.
    const mine = Array.from({ length: 7 }, (_, index) => ({
      ...SUBMISSION,
      submission_id: index + 1,
      name: `grid-${index}`,
      upload_token: `tok-${index}`,
    }));

    const chooser = await call(
      "/syndex/submit",
      contributorEnv({ rows: { submissions: mine } }),
      SIGNED_IN,
    );
    // The chooser shows the last few, because getting back to a transfer part
    // way through is the common reason to look.
    assert.match(chooser.body, /grid-4/);
    assert.doesNotMatch(chooser.body, /grid-5/);
    assert.match(chooser.body, /href="\/syndex\/submissions"/);

    const all = await call(
      "/syndex/submissions",
      contributorEnv({ rows: { submissions: mine } }),
      SIGNED_IN,
    );
    assert.equal(all.status, 200);
    assert.match(all.body, /7 in total/);
    assert.match(all.body, /grid-6/);
  },

  async "an account page says who you are and what that lets you do"() {
    const { body } = await call(
      "/syndex/account",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "reviewer" },
          // Counts by state, and what this reviewer has decided.
          submissions: [{ state: "approved", n: 2 }],
          decided: [
            {
              submission_id: 4,
              name: "older-grid",
              state: "rejected",
              reviewed_at: "2026-09-13T00:00:00Z",
            },
          ],
        },
      }),
      SIGNED_IN,
    );

    assert.match(body, /contributor-one/);
    assert.match(body, /Read the review queue and decide submissions/);
    // A contributor is never told about a job they do not have.
    assert.doesNotMatch(body, /Grant and withdraw any role/);
    assert.match(body, /What you have reviewed/);
    assert.match(body, /older-grid/);
    assert.match(body, /href="\/syndex\/submissions"/);
    assert.match(body, /action="\/syndex\/logout"/);
  },

  async "a decision records who made it"() {
    const issued = [];
    await call(
      "/syndex/review/7",
      submissionEnv({
        rows: { viewer: { ...USER, role: "reviewer" } },
        issued,
      }),
      signedInPost({ decision: "approved" }),
    );

    // Roles replaced a shared password precisely so a decision could be
    // attributed; the column that attributes it was missing until now.
    const update = statement(issued, "SET state = ?");
    assert.equal(update.params[3], USER.user_id);
  },

  async "an access request is recorded once and reported"() {
    const issued = [];
    const { status, body } = await call("/syndex/access", {
      DB: stubDb({
        rows: { viewer: { ...USER, role: "pending" }, roleChange: { user_id: 3 } },
        issued,
      }),
    }, signedInPost({ note: "A BPASS grid at higher resolution." }));

    assert.equal(status, 200);
    assert.match(body, /Request sent/);
    // Only while still pending: an account that has since been granted access
    // does not rejoin the queue by asking again.
    const update = statement(issued, "SET access_requested_at");
    assert.match(update.sql, /role = 'pending'/);
    assert.deepEqual(update.params.slice(1), [
      "A BPASS grid at higher resolution.",
      3,
    ]);
  },

  async "an empty access request is refused"() {
    const { status, body } = await call("/syndex/access", {
      DB: stubDb({ rows: { viewer: { ...USER, role: "pending" } } }),
    }, signedInPost({ note: "   " }));

    assert.equal(status, 400);
    assert.match(body, /say what you would like to contribute/);
  },

  async "signing in refuses a callback whose state does not match"() {
    const env = {
      DB: stubDb(),
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    };

    // No state cookie at all: nothing to have started this flow.
    const unsolicited = await call("/syndex/auth/callback?code=x&state=y", env);
    assert.equal(unsolicited.status, 400);

    // A cookie for a different nonce than the one echoed back.
    const mismatched = await call("/syndex/auth/callback?code=x&state=y", env, {
      headers: { cookie: "syndex_oauth=other:/syndex" },
    });
    assert.equal(mismatched.status, 400);
  },

  async "signing in sends the visitor to GitHub and back to where they were"() {
    const { status, headers } = await call(
      "/syndex/login?return=%2Fsyndex%2Fsearch%3Ftype%3Dgrid",
      { DB: stubDb(), GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" },
    );

    assert.equal(status, 302);
    const target = new URL(headers.get("location"));
    assert.equal(target.origin + target.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(target.searchParams.get("client_id"), "id");
    assert.equal(
      target.searchParams.get("redirect_uri"),
      "https://synthesizer-project.org/syndex/auth/callback",
    );
    // The destination rides in the cookie, not in a parameter the caller of
    // the callback could rewrite.
    const cookie = headers.get("set-cookie");
    assert.match(cookie, /syndex_oauth=[0-9a-f]{64}%3A%2Fsyndex%2Fsearch%3Ftype%3Dgrid/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  },

  async "a return path outside the portal is refused"() {
    const { headers } = await call(
      "/syndex/login?return=https%3A%2F%2Fexample.com%2Fphish",
      { DB: stubDb(), GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" },
    );
    assert.match(headers.get("set-cookie"), /syndex_oauth=[0-9a-f]{64}%3A%2Fsyndex;/);

    const schemeRelative = await call("/syndex/login?return=%2F%2Fexample.com", {
      DB: stubDb(),
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    });
    assert.match(
      schemeRelative.headers.get("set-cookie"),
      /syndex_oauth=[0-9a-f]{64}%3A%2Fsyndex;/,
    );
  },

  async "signing in is unavailable rather than broken when unconfigured"() {
    const { status } = await call("/syndex/login", { DB: stubDb() });
    assert.equal(status, 503);
  },

  async "an access request is answered from an overlay, not a buried form"() {
    const person = {
      user_id: 9,
      login: "someone",
      name: "Someone",
      role: "pending",
      created_at: "2026-09-01T00:00:00Z",
      last_seen_at: "2026-09-13T00:00:00Z",
      access_requested_at: "2026-09-13T00:00:00Z",
      access_request_note: "A BPASS grid at higher resolution.",
    };
    const { body } = await call(
      "/syndex/review",
      submissionEnv({
        rows: { viewer: { ...USER, role: "admin" }, people: [person] },
      }),
      SIGNED_IN,
    );

    // The row carries who and when; a Respond button opens the rest.
    assert.match(body, /popovertarget="request-9"/);
    assert.match(body, /popover="auto"/);
    // The overlay has to centre, which Tailwind's reset breaks without m-auto.
    assert.match(body, /popover="auto" class="card m-auto/);
    // What they wrote is what the decision turns on, so it sits next to the
    // control that decides rather than in the row.
    assert.match(body, /A BPASS grid at higher resolution/);
    assert.match(body, /name="from" value="review"/);
  },

  async "the account list stops at ten and continues on its own page"() {
    const many = Array.from({ length: 12 }, (_, index) => ({
      user_id: index + 10,
      login: `person-${index}`,
      name: null,
      role: "contributor",
      created_at: "2026-09-01T00:00:00Z",
      last_seen_at: "2026-09-01T00:00:00Z",
      access_requested_at: null,
      access_request_note: null,
    }));
    const { body } = await call(
      "/syndex/review",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "admin" },
          people: many,
          accountCount: 12,
        },
      }),
      SIGNED_IN,
    );

    assert.match(body, /person-9/);
    // Eleven rows are fetched so that "is there more" is answerable; ten show.
    assert.doesNotMatch(body, /person-10/);
    assert.match(body, /All 12 accounts/);
  },

  async "the account list is not a thing any signed-in user can read"() {
    const contributor = await call(
      "/syndex/accounts",
      submissionEnv({ rows: { viewer: USER } }),
      SIGNED_IN,
    );
    assert.equal(contributor.status, 403);

    const reviewer = await call(
      "/syndex/accounts",
      submissionEnv({
        rows: { viewer: { ...USER, role: "reviewer" }, people: [] },
      }),
      SIGNED_IN,
    );
    assert.equal(reviewer.status, 200);
  },

  async "an admin is offered the accounts page without being prompted"() {
    const header = (role) =>
      call(
        "/syndex/review",
        submissionEnv({ rows: { viewer: { ...USER, role } } }),
        SIGNED_IN,
      ).then(({ body }) => body);

    // Granting a role is something an admin does unprompted, so it cannot
    // depend on somebody having filed a request first.
    assert.match(await header("admin"), /href="\/syndex\/accounts"[^>]*>Admin/);
    // A reviewer reaches the same page from the queue rather than the header.
    assert.doesNotMatch(await header("reviewer"), />Admin</);
    assert.doesNotMatch(await header("contributor"), /href="\/syndex\/accounts"/);
  },

  async "the accounts page leads with who has no role yet"() {
    const { body } = await call(
      "/syndex/accounts",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "admin" },
          people: [
            {
              user_id: 9,
              login: "just-signed-in",
              name: null,
              role: "pending",
              created_at: "2026-09-14T00:00:00Z",
              last_seen_at: "2026-09-14T00:00:00Z",
              access_requested_at: null,
              access_request_note: null,
            },
            {
              user_id: 10,
              login: "a-contributor",
              name: null,
              role: "contributor",
              created_at: "2026-09-01T00:00:00Z",
              last_seen_at: "2026-09-10T00:00:00Z",
              access_requested_at: null,
              access_request_note: null,
            },
          ],
        },
      }),
      SIGNED_IN,
    );

    // Somebody who signed in and asked for nothing appears nowhere else in
    // the portal, and is exactly who this page exists to find.
    assert.match(body, /just-signed-in/);
    assert.ok(body.indexOf("just-signed-in") < body.indexOf("a-contributor"));
    assert.match(body, /2 accounts/);
    assert.match(body, /1 pending/);
    assert.match(body, /1 contributor/);
  },

  async "only an admin may grant the roles that publish"() {
    const asReviewer = (rows, role) =>
      call(
        "/syndex/review/users/9",
        submissionEnv({
          rows: { viewer: { ...USER, role: "reviewer" }, ...rows },
        }),
        signedInPost({ role }),
      );

    // The role being granted has to be within the reviewer's gift.
    const tooHigh = await asReviewer(
      { target: { user_id: 9, login: "someone", role: "contributor" } },
      "admin",
    );
    assert.match(tooHigh.body, /cannot grant the admin role/);

    // And so does the role the account already holds -- otherwise a reviewer
    // could set an admin to contributor and strip authority they could not
    // themselves confer.
    const tooSenior = await asReviewer(
      { target: { user_id: 9, login: "someone", role: "admin" } },
      "contributor",
    );
    assert.match(tooSenior.body, /Only an admin can change a admin/);

    const granted = await asReviewer(
      { target: { user_id: 9, login: "someone", role: "pending" } },
      "contributor",
    );
    assert.match(granted.body, /someone is now a contributor/);
  },

  async "revoking ends every session as well as the role"() {
    const issued = [];
    const { body } = await call(
      "/syndex/review/users/9/revoke",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "admin" },
          target: { user_id: 9, login: "someone", role: "reviewer" },
        },
        issued,
      }),
      signedInPost({ from: "accounts" }),
    );

    assert.match(body, /someone has been signed out and left with no role/);
    // Either half alone leaves something behind: a role with no session is an
    // account that signs straight back in with what it had, and a session
    // with no role is a key to a door that has been locked.
    assert.match(statement(issued, "UPDATE users").sql, /role = 'pending'/);
    assert.deepEqual(statement(issued, "DELETE FROM sessions").params, [9]);
  },

  async "revoking obeys the same limits as granting"() {
    // A reviewer may not strip an admin, for the same reason they may not
    // make one.
    const tooSenior = await call(
      "/syndex/review/users/9/revoke",
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "reviewer" },
          target: { user_id: 9, login: "someone", role: "admin" },
        },
      }),
      signedInPost({ from: "accounts" }),
    );
    assert.match(tooSenior.body, /Only an admin can change a admin/);

    const self = await call(
      `/syndex/review/users/${USER.user_id}/revoke`,
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "admin" },
          target: { user_id: USER.user_id, login: USER.login, role: "admin" },
        },
      }),
      signedInPost({ from: "accounts" }),
    );
    assert.match(self.body, /cannot change your own role/);
  },

  async "nobody may change their own role"() {
    const { body } = await call(
      `/syndex/review/users/${USER.user_id}`,
      submissionEnv({
        rows: {
          viewer: { ...USER, role: "admin" },
          target: { user_id: USER.user_id, login: USER.login, role: "admin" },
        },
      }),
      signedInPost({ role: "pending" }),
    );
    assert.match(body, /cannot change your own role/);
  },

  async "an anonymous part upload is refused, not an error"() {
    // The token addresses a submission and does not authorise one, so a part
    // posted with no session has to be refused rather than reaching code that
    // assumes somebody is signed in.
    const { status } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}/part/1`,
      submissionEnv(),
      { method: "POST", body: "x" },
    );

    assert.equal(status, 401);
  },

  async "starting a transfer again abandons what was half sent"() {
    // Choosing a different file after a failed attempt would otherwise leave
    // the first file's higher-numbered parts in place, and assemble the two
    // into an object that is neither.
    const env = contributorEnv({
      rows: { submission: { ...SUBMISSION, upload_id: "upload-0" } },
    });
    await call(`/syndex/submit/${SUBMISSION.upload_token}/part/1`, env, {
      method: "POST",
      body: "x",
      headers: { cookie: SESSION_COOKIE },
    });

    assert.equal(env.uploaded.aborted, true);
    // And the part still lands, in a fresh upload.
    assert.equal(env.uploaded.created, 1);
    assert.deepEqual(env.uploaded.parts, [{ partNumber: 1, size: 1 }]);
  },

  async "a later part joins the upload already in progress"() {
    const env = contributorEnv({
      rows: { submission: { ...SUBMISSION, upload_id: "upload-0" } },
    });
    await call(`/syndex/submit/${SUBMISSION.upload_token}/part/2`, env, {
      method: "POST",
      body: "xy",
      headers: { cookie: SESSION_COOKIE },
    });

    assert.equal(env.uploaded.aborted, false);
    assert.equal(env.uploaded.created, 0);
  },

  async "a table that cannot wrap scrolls instead of widening the page"() {
    // Both tables on a dataset page have cells that do not wrap, so either
    // one without a scroller sets the width of the page and pushes everything
    // else off the side of a phone.
    const { body } = await call(
      "/syndex/datasets/bpass",
      {
        DB: stubDb({
          rows: {
            datasets: [
              {
                ...GRID_ROW,
                dataset_id: 1,
                description: "A grid.",
                metadata_json: "{}",
                provenance_json: "{}",
              },
            ],
            releases: [
              {
                release_id: 2,
                published_at: "2026-09-04T16:47:01Z",
                size_bytes: 203126664,
                filename: "bpass.hdf5",
                known_bug: 0,
              },
            ],
          },
        }),
      },
    );

    assert.equal(body.match(/<div class="overflow-x-auto"><table/g)?.length, 1);
    assert.match(body, /class="results overflow-x-auto"><table/);
  },

  async "the upload page has every element its script looks for"() {
    // A mismatch here is silent and total: the script bails, the controls
    // stay hidden, and the page offers no way to send a file at all. It has
    // happened once, when the markup was renamed and the script was not.
    const { readFileSync } = await import("node:fs");
    const script = readFileSync("src/portal/upload.js", "utf8");
    const { body } = await call(
      `/syndex/submit/${SUBMISSION.upload_token}`,
      contributorEnv({ rows: { submission: SUBMISSION } }),
      SIGNED_IN,
    );

    const bindings = [
      ...script.matchAll(/const (\w+) = document\.getElementById\("([^"]+)"\)/g),
    ].map((match) => ({ variable: match[1], id: match[2] }));
    assert.ok(bindings.length > 0, "the script looks something up");

    for (const { id } of bindings) {
      assert.match(body, new RegExp(`id="${id}"`), `the page has #${id}`);
    }

    // And anything the page renders hidden has to be unhidden somewhere, or
    // the control simply never appears. That has happened twice: once when
    // the markup was renamed and the script was not, and once when the line
    // that revealed the upload button was removed and its replacement was
    // not applied.
    for (const { variable, id } of bindings) {
      if (!new RegExp(`id="${id}"[^>]*hidden`).test(body)) {
        continue;
      }
      assert.match(
        script,
        new RegExp(`${variable}\\.hidden\\s*=`),
        `${variable} (#${id}) is rendered hidden and must be revealed`,
      );
    }
  },

  async "a long display name does not set the width of the page"() {
    // Some display names are the raw filename: 113 characters joined by
    // underscores, which offer no break opportunity, so without a wrapping
    // rule one dataset makes a phone zoom out to see any of the page.
    const { body } = await call("/syndex/datasets/x", {
      DB: stubDb({
        rows: {
          datasets: [
            {
              ...GRID_ROW,
              dataset_id: 1,
              display_name: "a_b".repeat(40),
              description: "A grid.",
              metadata_json: "{}",
              provenance_json: "{}",
            },
          ],
        },
      }),
    });

    assert.match(body, /<h1 class="[^"]*break-words[^"]*">/);
  },

  async "an unexpected binding failure becomes a page, not a stack trace"() {
    const env = {
      DB: {
        prepare() {
          throw new Error("D1 exploded");
        },
      },
    };
    const { status, body } = await call("/syndex/search", env);

    assert.equal(status, 500);
    assert.doesNotMatch(body, /D1 exploded/);
  },
  async "a dataset page shows its preview as a clickable thumbnail"() {
    const env = {
      DB: stubDb({
        rows: {
          datasets: [
            {
              ...GRID_ROW,
              dataset_id: 1,
              description: "A grid.",
              metadata_json: "{}",
              provenance_json: "{}",
              current_release_id: 2,
              filename: "bpass.hdf5",
              sha256: "e47f",
              preview_path: "preview/abc123/bpass.png",
              preview_kind: "spectra",
              synthesizer_min_version: "1.0.0",
              synthesizer_max_version: null,
              deprecated_at: null,
              known_bug_description: null,
            },
          ],
        },
      }),
    };
    const { status, body } = await call(
      `/syndex/datasets/${GRID_ROW.name}`,
      env,
    );
    assert.equal(status, 200);
    // Served through the API, since the bucket is private.
    assert.match(body, /v1\/releases\/2\/preview\.png/);
    assert.match(body, /preview\.png\?v=abc123/);
    // Marked for the overlay, and still a plain link without JavaScript.
    assert.match(body, /data-preview/);
    // The caption the plot itself no longer carries.
    assert.match(body, /coloured by luminosity/);
  },

  async "a dataset with no preview shows no thumbnail"() {
    const env = {
      DB: stubDb({
        rows: {
          datasets: [
            {
              ...GRID_ROW,
              dataset_id: 1,
              description: "A grid.",
              metadata_json: "{}",
              provenance_json: "{}",
              current_release_id: 2,
              filename: "bpass.hdf5",
              sha256: "e47f",
              preview_path: null,
              preview_kind: null,
              synthesizer_min_version: "1.0.0",
              synthesizer_max_version: null,
              deprecated_at: null,
              known_bug_description: null,
            },
          ],
        },
      }),
    };
    const { body } = await call(`/syndex/datasets/${GRID_ROW.name}`, env);
    assert.doesNotMatch(body, /preview\.png/);
    assert.doesNotMatch(body, /preview-thumb/);
  },

};

let failures = 0;
for (const [name, test] of Object.entries(tests)) {
  try {
    await test();
    console.log(`ok   ${name}`);
  } catch (exc) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${exc.message}`);
  }
}
console.log(`\n${Object.keys(tests).length - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
