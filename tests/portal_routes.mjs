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
  if (sql.includes("COUNT(*) AS n")) {
    return [{ n: 3 }];
  }
  if (sql.includes("SELECT a.release_id")) {
    return rows.axes ?? AXIS_ROWS;
  }
  if (sql.includes("FROM grid_axes WHERE release_id")) {
    return rows.axes ?? AXIS_ROWS;
  }
  if (sql.includes("UNION ALL")) {
    return rows.taken ?? [];
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
  filename: null,
  r2_key: null,
  uploaded_at: null,
  uploaded_size_bytes: null,
  declared_sha256: null,
  submitter_name: "A Contributor",
  submitter_email: "a@example.org",
  notes: null,
};

/**
 * Everything the submission path needs to be considered configured.
 *
 * The values are local stand-ins: a presigned URL signed with them is
 * rejected by R2, which is fine, since what is under test is what the
 * portal signs rather than whether R2 accepts it.
 *
 * @param {object} options Rows for the stub database, and R2 contents.
 * @returns {object} Stub bindings.
 */
function submissionEnv({ rows = {}, objects = [] } = {}) {
  return {
    DB: stubDb({ rows }),
    SUBMISSIONS: {
      list: async ({ prefix }) => ({
        objects: objects.filter((object) => object.key.startsWith(prefix)),
      }),
    },
    SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    SYNTHESIZER_SUBMISSIONS_BUCKET: "synthesizer-submissions",
    SYNTHESIZER_SUBMISSIONS_ACCESS_KEY_ID: "test-key",
    SYNTHESIZER_SUBMISSIONS_SECRET_ACCESS_KEY: "test-secret",
    TURNSTILE_SITEKEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  };
}

/**
 * Answer Turnstile's siteverify without leaving the machine.
 *
 * @param {boolean} success What the challenge should report.
 * @returns {Function} A function restoring the real fetch.
 */
function stubChallenge(success) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("siteverify")) {
      return Response.json({ success, "error-codes": success ? [] : ["x"] });
    }
    throw new Error(`unexpected fetch of ${url}`);
  };
  return () => {
    globalThis.fetch = real;
  };
}

/**
 * Post one submission form.
 *
 * @param {object} env Stub bindings.
 * @param {object} fields Field overrides.
 * @returns {Promise<object>} The response.
 */
function postSubmission(env, fields = {}) {
  const body = new URLSearchParams({
    name: "example-grid",
    display_name: "Example grid",
    data_type: "grid",
    submitter_name: "A Contributor",
    submitter_email: "a@example.org",
    "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX",
    ...fields,
  });
  return call("/syndicate/submit", env, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
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

    const portal = await call("/syndicate/grids", env);
    assert.equal(portal.status, 200);
    assert.match(portal.headers.get("content-type"), /text\/html/);

    // Nothing else moved: the API still owns every other path, including the
    // 404 for the root.
    assert.equal((await call("/", env)).status, 404);
    assert.match((await call("/", env)).body, /No route for/);
  },

  async "a filter URL survives being parsed and rebuilt"() {
    const query =
      "?q=bpass&model=BPASS&model=FSPS&emission=photoionised&content=spectra" +
      "&axis=ages&min.ages=1000000&max.ages=10000000000&mode.ages=contain";
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

    await search(env.DB, grids, parseFilters(new URLSearchParams("?axis=spins")));

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
      parseFilters(new URLSearchParams("?axis=ages&min.ages=1e6&max.ages=1e10")),
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
          "?axis=ages&min.ages=1e6&max.ages=1e10&mode.ages=contain",
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
      parseFilters(new URLSearchParams("?axis=ages&min.ages=1e9")),
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
      parseFilters(new URLSearchParams("?axis=masses&min.masses=1e6")),
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
      parseFilters(new URLSearchParams("?axis=metallicities&max.metallicities=0.02")),
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

    assert.equal(asSolarMasses, "1e6–1e10 M☉");
    assert.equal(asKilogrammes, asSolarMasses);
  },

  async "stellar and AGN are the first cut, and one query"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(new URLSearchParams("?kind=agn&model=QSOSED")),
    );

    const rows = statement(issued, "ORDER BY d.name");
    assert.match(rows.sql, /g\.grid_type IN \(\?\)/);
    assert.deepEqual(rows.params, ["grid", "agn", "QSOSED"]);

    // Its own count is of what it would return, so the rail says how many
    // stellar grids are there while AGN is ticked.
    const kinds = statement(issued, "SELECT g.grid_type AS value");
    assert.deepEqual(kinds.params, ["grid", "QSOSED"]);
  },

  async "an unknown kind is ignored rather than bound"() {
    // The two values are the vocabulary; dust grids are their own tab.
    const filters = parseFilters(new URLSearchParams("?kind=dust&kind=agn"));
    assert.deepEqual(filters.kind, ["agn"]);
  },

  async "a facet counts what it would return, not what is selected"() {
    const issued = [];
    await search(
      stubDb({ issued }),
      grids,
      parseFilters(new URLSearchParams("?model=BPASS&emission=incident")),
    );

    // The model counts are computed without the model filter, so ticking a
    // second model adds to the results rather than replacing them.
    const models = statement(issued, "SELECT g.model_name AS value");
    assert.deepEqual(models.params, ["grid", "incident"]);

    // The tab restriction is not a facet and is never dropped.
    const emissions = statement(issued, "SELECT g.emission_type AS value");
    assert.deepEqual(emissions.params, ["grid", "BPASS"]);
  },

  async "a page names its filters and offers a way out of them"() {
    const env = { DB: stubDb() };
    const { body } = await call("/syndicate/grids?model=BPASS&axis=ages", env);

    // The count, the chips, and a link that clears everything.
    assert.match(body, /1 grid</);
    assert.match(body, /clear all/);
    // The added axis is a column as well as a filter, and only once: ages
    // is a column on the grids tab whether or not it is filtered on.
    assert.equal(body.match(/>ages<\/th>/g).length, 1);
    // And it round-trips through the form without JavaScript.
    assert.match(body, /<input type="hidden" name="axis" value="ages"\/>/);
    assert.match(body, /<form id="filters" method="get"/);
  },

  async "a long facet list puts its toggle after the values"() {
    const many = Array.from({ length: 10 }, (unused, index) => ({
      value: `model-${index}`,
      n: 10 - index,
    }));
    const env = { DB: stubDb({ rows: { facets: many } }) };

    const collapsed = (await call("/syndicate/grids", env)).body;
    // Six values, then the link. Never the link, then the values.
    const shown = collapsed.indexOf('value="model-5"');
    const link = collapsed.indexOf("4 more");
    assert.ok(shown > 0 && link > shown, "the toggle comes after the values");
    assert.equal(collapsed.includes('value="model-6"'), false);

    const opened = (await call("/syndicate/grids?more=model", env)).body;
    assert.ok(opened.includes('value="model-9"'), "all values are shown");
    const last = opened.indexOf('value="model-9"');
    assert.ok(opened.indexOf("collapse") > last, "the toggle is still last");
    // And the form keeps it open across a filter change.
    assert.match(opened, /<input type="hidden" name="more" value="model"\/>/);
  },

  async "an expanded list is not a filter"() {
    // It narrows nothing, so it must not make the page look filtered.
    const env = { DB: stubDb() };
    const { body, headers } = await call("/syndicate/grids?more=model", env);

    assert.doesNotMatch(body, /clear all/);
    assert.equal(headers.get("cache-control"), "public, max-age=60");
  },

  async "htmx gets the panel and nothing around it"() {
    const env = { DB: stubDb() };
    const { body, headers } = await call("/syndicate/grids", env, {
      headers: { "HX-Request": "true" },
    });

    assert.doesNotMatch(body, /<html/);
    assert.doesNotMatch(body, /doctype/i);
    assert.match(body, /^<div id="panel"/);
    // The rail is swapped with the table: its counts describe the search.
    assert.match(body, /id="filters"/);
    assert.equal(headers.get("cache-control"), "no-store");
  },

  async "a dataset page prints the command that fetches it"() {
    const env = {
      DB: stubDb({
        rows: {
          datasets: [
            {
              ...GRID_ROW,
              dataset_id: 1,
              description: "A grid.",
              licence: "CC-BY-4.0",
              citations_json: '["Eldridge et al. 2017"]',
              metadata_json: "{}",
              provenance_json: "{}",
              current_release_id: 2,
              filename: "bpass.hdf5",
              sha256: "e47f",
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
      `/syndicate/datasets/${GRID_ROW.name}`,
      env,
    );

    assert.equal(status, 200);
    assert.match(body, new RegExp(`synthesizer-download --dataset ${GRID_ROW.name}`));
    // Downloads are absolute: /v1 on this host is the org site, not the API.
    assert.match(
      body,
      /https:\/\/data\.synthesizer-project\.org\/v1\/releases\/2\/download/,
    );
    assert.match(body, /Eldridge et al\. 2017/);
  },

  async "a dataset that is not there says so as a page"() {
    const env = { DB: stubDb({ rows: { datasets: [] } }) };
    const { status, body } = await call("/syndicate/datasets/nope", env);

    assert.equal(status, 404);
    assert.match(body, /no dataset named nope/);
    assert.match(body, /<html/);
  },

  async "the form is closed rather than half working"() {
    // Everything the upload needs is configuration with no sensible
    // default, so an unconfigured portal says so instead of taking a file
    // it has nowhere to put.
    const env = { DB: stubDb() };
    const { body } = await call("/syndicate/submit", env);
    assert.match(body, /Submissions are not open yet/);
    assert.doesNotMatch(body, /cf-turnstile/);

    assert.equal((await postSubmission(env)).status, 503);
  },

  async "the submission form refuses what a reviewer could not act on"() {
    const restore = stubChallenge(true);
    try {
      const { status, body } = await postSubmission(submissionEnv(), {
        name: "Not A Name",
        display_name: "",
        data_type: "nonsense",
        submitter_name: "",
        submitter_email: "not-an-address",
      });

      assert.equal(status, 422);
      assert.match(body, /lowercase letters, digits and hyphens/);
      assert.match(body, /display name is required/);
      assert.match(body, /listed data types/);
      assert.match(body, /email address is required/);
      // What was typed comes back, so nothing has to be retyped.
      assert.match(body, /value="Not A Name"/i);
    } finally {
      restore();
    }
  },

  async "submitted markup is text by the time it is displayed"() {
    const restore = stubChallenge(true);
    try {
      const { status, body } = await postSubmission(submissionEnv(), {
        name: "Bad Name",
        display_name: "<script>alert(1)</script>",
      });

      assert.equal(status, 422);
      assert.doesNotMatch(body, /<script>alert/);
      assert.match(body, /&lt;script&gt;/);
    } finally {
      restore();
    }
  },

  async "a failed challenge is a refusal, not a submission"() {
    const restore = stubChallenge(false);
    try {
      const { status, body } = await postSubmission(submissionEnv());
      assert.equal(status, 422);
      assert.match(body, /anti-robot check did not pass/);
    } finally {
      restore();
    }

    // And so is no challenge at all: verification fails closed rather than
    // letting an unverified submission through.
    const { status } = await postSubmission(submissionEnv(), {
      "cf-turnstile-response": "",
    });
    assert.equal(status, 422);
  },

  async "an accepted submission redirects to its own upload page"() {
    const restore = stubChallenge(true);
    try {
      const { status, headers } = await postSubmission(submissionEnv());

      assert.equal(status, 303);
      // The token is unguessable and is the only thing that authorises the
      // upload, so it is what the address carries, not the row's id.
      assert.match(
        headers.get("location"),
        /^\/syndicate\/submit\/[0-9a-f]{8}-[0-9a-f]{4}-/,
      );
      assert.doesNotMatch(headers.get("location"), /\/7$/);
    } finally {
      restore();
    }
  },

  async "a name already in the catalogue is not accepted twice"() {
    const restore = stubChallenge(true);
    try {
      const env = submissionEnv({ rows: { taken: [{ 1: 1 }] } });
      const { status, body } = await postSubmission(env, {
        name: "bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01",
      });

      assert.equal(status, 422);
      assert.match(body, /already in the catalogue/);
    } finally {
      restore();
    }
  },

  async "an oversized submission is refused before it is parsed"() {
    const { status } = await call("/syndicate/submit", submissionEnv(), {
      method: "POST",
      body: "name=x",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(2 * 1024 * 1024),
      },
    });

    assert.equal(status, 413);
  },

  async "the upload page offers both ways up"() {
    const env = submissionEnv({ rows: { submission: SUBMISSION } });
    const { status, body } = await call(
      `/syndicate/submit/${SUBMISSION.upload_token}`,
      env,
    );

    assert.equal(status, 200);
    assert.match(body, /1\.0 GiB/);
    // The picker is inert until the script reveals it, so a browser with no
    // JavaScript is never shown a control that could not work.
    assert.match(body, /<input type="file" id="pick" hidden/);
    assert.match(body, /Sending a file from the browser needs JavaScript/);
    // And the confirm form is an ordinary POST for whoever used rclone.
    assert.match(body, /id="confirm"/);
  },

  async "an upload url is signed for exactly one key"() {
    const env = submissionEnv({ rows: { submission: SUBMISSION } });
    const { status, body } = await call(
      `/syndicate/submit/${SUBMISSION.upload_token}/upload-url`,
      env,
      {
        method: "POST",
        body: JSON.stringify({ filename: "../../escape/../grid.hdf5" }),
        headers: { "content-type": "application/json" },
      },
    );

    assert.equal(status, 200);
    const { url, key } = JSON.parse(body);

    // A filename cannot climb out of its own submission's prefix.
    assert.equal(key, `submissions/${SUBMISSION.upload_token}/grid.hdf5`);
    assert.doesNotMatch(key, /\.\./);

    // It points at R2's own endpoint, not at this Worker, and it is signed
    // and expiring rather than open.
    const target = new URL(url);
    assert.match(target.hostname, /\.r2\.cloudflarestorage\.com$/);
    assert.equal(target.pathname, `/synthesizer-submissions/${key}`);
    assert.equal(target.searchParams.get("X-Amz-Expires"), "3600");
    assert.ok(target.searchParams.get("X-Amz-Signature"));
  },

  async "a submission that already has its file is not given another url"() {
    const env = submissionEnv({
      rows: {
        submission: { ...SUBMISSION, uploaded_at: "2026-09-07T11:00:00Z" },
      },
    });
    const { status } = await call(
      `/syndicate/submit/${SUBMISSION.upload_token}/upload-url`,
      env,
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
    );

    assert.equal(status, 409);
  },

  async "completion believes the bucket, not the browser"() {
    const key = `submissions/${SUBMISSION.upload_token}/grid.hdf5`;
    const env = submissionEnv({
      rows: { submission: SUBMISSION },
      objects: [{ key, size: 4096 }],
    });
    const issued = [];
    env.DB = stubDb({ rows: { submission: SUBMISSION }, issued });

    const { status, headers } = await call(
      `/syndicate/submit/${SUBMISSION.upload_token}/complete`,
      env,
      {
        method: "POST",
        body: new URLSearchParams({ declared_sha256: "a".repeat(64) }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
    );

    assert.equal(status, 303);
    assert.match(headers.get("location"), /\/syndicate\/submit\//);

    // The size and filename recorded are R2's, and the digest is only kept
    // when it is one.
    const update = statement(issued, "UPDATE submissions");
    assert.equal(update.params[1], 4096);
    assert.equal(update.params[2], "grid.hdf5");
    assert.equal(update.params[3], key);
    assert.equal(update.params[4], "a".repeat(64));
  },

  async "a digest that is not one is not recorded"() {
    const key = `submissions/${SUBMISSION.upload_token}/grid.hdf5`;
    const issued = [];
    const env = submissionEnv({ objects: [{ key, size: 10 }] });
    env.DB = stubDb({ rows: { submission: SUBMISSION }, issued });

    await call(`/syndicate/submit/${SUBMISSION.upload_token}/complete`, env, {
      method: "POST",
      body: new URLSearchParams({ declared_sha256: "not-a-digest" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    assert.equal(statement(issued, "UPDATE submissions").params[4], null);
  },

  async "an upload that never arrived says so"() {
    const env = submissionEnv({ rows: { submission: SUBMISSION }, objects: [] });
    const { status, body } = await call(
      `/syndicate/submit/${SUBMISSION.upload_token}/complete`,
      env,
      { method: "POST", body: "", headers: { "content-type": "application/x-www-form-urlencoded" } },
    );

    assert.equal(status, 404);
    assert.match(body, /Nothing arrived/);
  },

  async "an unknown token is not a way to browse the queue"() {
    const env = submissionEnv({ rows: { submission: undefined } });
    assert.equal((await call("/syndicate/submit/nope", env)).status, 404);
    assert.equal(
      (
        await call("/syndicate/submit/nope/upload-url", env, {
          method: "POST",
          body: "{}",
          headers: { "content-type": "application/json" },
        })
      ).status,
      404,
    );
  },

  async "the review queue is closed until it is configured"() {
    const unconfigured = { DB: stubDb() };
    assert.equal((await call("/syndicate/review", unconfigured)).status, 503);

    const configured = {
      DB: stubDb(),
      SYNDICATE_REVIEW_USER: "reviewer",
      SYNDICATE_REVIEW_PASSWORD: "secret",
    };
    const challenged = await call("/syndicate/review", configured);
    assert.equal(challenged.status, 401);
    assert.match(challenged.headers.get("www-authenticate"), /Basic/);

    const authorised = await call("/syndicate/review", configured, {
      headers: { authorization: `Basic ${btoa("reviewer:secret")}` },
    });
    assert.equal(authorised.status, 200);
    assert.match(authorised.body, /Nothing is waiting/);
  },

  async "reviewing records a decision and does not publish anything"() {
    const env = {
      DB: stubDb(),
      SYNDICATE_REVIEW_USER: "reviewer",
      SYNDICATE_REVIEW_PASSWORD: "secret",
    };
    const { status, body } = await call("/syndicate/review/7", env, {
      method: "POST",
      body: new URLSearchParams({ decision: "approved", reviewer_note: "Fine" }),
      headers: {
        authorization: `Basic ${btoa("reviewer:secret")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });

    assert.equal(status, 200);
    assert.match(body, /marked approved/);
  },

  async "an unexpected binding failure becomes a page, not a stack trace"() {
    const env = {
      DB: {
        prepare() {
          throw new Error("D1 exploded");
        },
      },
    };
    const { status, body } = await call("/syndicate/grids", env);

    assert.equal(status, 500);
    assert.doesNotMatch(body, /D1 exploded/);
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
