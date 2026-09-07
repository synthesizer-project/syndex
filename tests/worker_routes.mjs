/**
 * Smoke test for the catalogue API's routing and response shaping.
 *
 * Run with `node tests/worker_routes.mjs`. It needs no dependencies and no
 * network: the D1 and R2 bindings are stubbed, so what is under test is URL
 * parsing, parameter binding, JSON decoding, and status-code selection.
 */

import assert from "node:assert/strict";

import worker from "../src/worker/index.js";

const ORIGIN = "https://data.synthesizer-project.org";

const DATASET_ROW = {
  name: "bpass-2-2-1-cloudy-sps-test",
  display_name: "BPASS 2.2.1 Cloudy SPS test grid",
  description: null,
  data_type: "grid",
  is_test: 1,
  is_recommended: 0,
  licence: null,
  citations_json: '["Eldridge et al. 2017"]',
  metadata_json: '{"note":"reduced"}',
  release_id: 2,
  published_at: "2026-09-04T16:47:01.550420Z",
  deprecated_at: null,
  synthesizer_min_version: null,
  synthesizer_max_version: null,
  provenance_json: '{"hdf5":{"date_created":"2025-09-27"}}',
  filename: "bpass.hdf5",
  r2_path: "test-data/grid/e47f/bpass.hdf5",
  format: "hdf5",
  size_bytes: 203126664,
  sha256: "e47f0076370da3a5ae3be24f39c03fdd83ac4d7e23da3d46f935dfb44970cfb8",
};

/**
 * Build a stub D1 binding that records the parameters it was bound with.
 *
 * @param {object} options Rows to return and a list to record bindings in.
 * @returns {object} Object shaped like a D1Database.
 */
function stubDb({ rows = [], bindings = [], batchResults = [] } = {}) {
  return {
    prepare() {
      return {
        bind(...params) {
          bindings.push(params);
          return this;
        },
        first: async () => rows[0] ?? null,
        all: async () => ({ results: rows }),
      };
    },
    batch: async (statements) =>
      batchResults.length > 0 ? batchResults : statements.map(() => ({ results: [] })),
  };
}

/**
 * Call the Worker.
 *
 * @param {string} path Request path with optional query string.
 * @param {object} env Stub bindings.
 * @param {object} init Extra fetch init, such as method or headers.
 * @returns {Promise<{status: number, body: unknown, headers: Headers}>} Result.
 */
async function call(path, env, init = {}) {
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Download responses are not JSON.
  }
  return { status: response.status, body, headers: response.headers };
}

const tests = {
  async "listing binds filters and paginates"() {
    const bindings = [];
    const env = { DB: stubDb({ rows: [DATASET_ROW], bindings }) };
    const { status, body } = await call(
      "/v1/datasets?data_type=grid&is_test=true&is_ci=false&limit=1",
      env,
    );

    assert.equal(status, 200);
    // data_type, is_test, is_ci, has_spectra, has_lines, cursor, limit
    assert.deepEqual(bindings[0], ["grid", 1, 0, null, null, null, 1]);
    // A full page reports a cursor so a client knows to continue.
    assert.equal(body.cursor, "bpass-2-2-1-cloudy-sps-test");
    assert.equal(
      body.datasets[0].download_url,
      `${ORIGIN}/v1/releases/2/download`,
    );
  },

  async "grids can be filtered by what they contain"() {
    const bindings = [];
    const env = {
      DB: stubDb({
        rows: [{ ...DATASET_ROW, has_spectra: 0, has_lines: 0 }],
        bindings,
      }),
    };

    // Finding grids that hold only ionising luminosities.
    const { body } = await call(
      "/v1/datasets?has_spectra=false&has_lines=false",
      env,
    );

    assert.deepEqual(bindings[0], [null, null, null, 0, 0, null, 100]);
    assert.equal(body.datasets[0].has_spectra, false);
    assert.equal(body.datasets[0].has_lines, false);
  },

  async "non-grid datasets report no content flags"() {
    const row = { ...DATASET_ROW, data_type: "instrument" };
    delete row.has_spectra;
    delete row.has_lines;
    const env = { DB: stubDb({ rows: [{ ...row, has_spectra: null, has_lines: null }] }) };

    const { body } = await call("/v1/datasets", env);

    assert.equal("has_spectra" in body.datasets[0], false);
  },

  async "ci and reduced are independent flags"() {
    // Production data that CI happens to download: reduced is false, ci true.
    const row = { ...DATASET_ROW, is_test: 0, is_ci: 1 };
    const env = { DB: stubDb({ rows: [row] }) };

    const { body } = await call("/v1/datasets/euclid-nisp-instrument", env);

    assert.equal(body.is_test, false);
    assert.equal(body.is_ci, true);
  },

  async "listing without a full page reports no cursor"() {
    const env = { DB: stubDb({ rows: [DATASET_ROW] }) };
    const { body } = await call("/v1/datasets?limit=5", env);
    assert.equal(body.cursor, null);
  },

  async "dataset name comes from the path and is decoded"() {
    const bindings = [];
    const env = { DB: stubDb({ rows: [DATASET_ROW], bindings }) };
    const { status, body } = await call("/v1/datasets/bpass-2-2-1-cloudy-sps-test", env);

    assert.equal(status, 200);
    assert.deepEqual(bindings[0], ["bpass-2-2-1-cloudy-sps-test"]);
    // Serialized columns are returned as real JSON, without the _json suffix.
    assert.deepEqual(body.citations, ["Eldridge et al. 2017"]);
    assert.deepEqual(body.metadata, { note: "reduced" });
    assert.equal(body.is_test, true);
    assert.equal(body.is_recommended, false);
    assert.equal(
      body.current_release.download_url,
      `${ORIGIN}/v1/releases/2/download`,
    );
    assert.equal(body.current_release.file.sha256, DATASET_ROW.sha256);
  },

  async "dataset without a current release reports a null release"() {
    const row = { ...DATASET_ROW, release_id: null };
    const env = { DB: stubDb({ rows: [row] }) };
    const { status, body } = await call("/v1/datasets/orphan", env);

    assert.equal(status, 200);
    assert.equal(body.current_release, null);
  },

  async "grid axes are attached in order with decoded values"() {
    const env = {
      DB: stubDb({
        rows: [DATASET_ROW],
        batchResults: [
          { results: [{ release_id: 2, grid_type: "sps", emission_type: "photoionised" }] },
          {
            results: [
              { axis_index: 0, name: "ages", values_json: "[1.0,2.0]" },
              { axis_index: 1, name: "metallicities", values_json: "[0.01]" },
            ],
          },
          { results: [] },
        ],
      }),
    };
    const { body } = await call("/v1/datasets/bpass-2-2-1-cloudy-sps-test", env);
    const grid = body.current_release.grid;

    assert.equal(grid.grid_type, "sps");
    assert.equal(grid.release_id, undefined, "release_id is internal");
    assert.deepEqual(
      grid.axes.map((axis) => axis.name),
      ["ages", "metallicities"],
    );
    assert.deepEqual(grid.axes[0].values, [1.0, 2.0]);
    assert.equal(body.current_release.instrument, null);
  },

  async "every release of a dataset is listed, current one marked"() {
    const rows = [
      {
        release_id: 9,
        published_at: "2026-09-06T12:00:00Z",
        deprecated_at: null,
        synthesizer_min_version: "1.0.0",
        synthesizer_max_version: null,
        filename: "bpass_updated.hdf5",
        format: "hdf5",
        size_bytes: 203126664,
        sha256: "a".repeat(64),
      },
      {
        release_id: 2,
        published_at: "2026-09-01T12:00:00Z",
        deprecated_at: null,
        synthesizer_min_version: "1.0.0",
        synthesizer_max_version: null,
        filename: "bpass.hdf5",
        format: "hdf5",
        size_bytes: 191600000,
        sha256: "b".repeat(64),
      },
    ];
    // first() returns the dataset row, all() the releases.
    const db = {
      prepare() {
        return {
          bind() {
            return this;
          },
          first: async () => ({
            dataset_id: 1,
            name: "bpass-2-2-1-cloudy-sps",
            data_type: "grid",
            current_release_id: 9,
          }),
          all: async () => ({ results: rows }),
        };
      },
    };

    const { status, body } = await call(
      "/v1/datasets/bpass-2-2-1-cloudy-sps/releases",
      { DB: db },
    );

    assert.equal(status, 200);
    assert.equal(body.dataset, "bpass-2-2-1-cloudy-sps");
    assert.equal(body.releases.length, 2);
    // Superseded releases stay listed and stay downloadable.
    assert.deepEqual(
      body.releases.map((r) => [r.release_id, r.is_current]),
      [
        [9, true],
        [2, false],
      ],
    );
    assert.equal(
      body.releases[1].download_url,
      `${ORIGIN}/v1/releases/2/download`,
    );
  },

  async "a release can be fetched by id, without knowing its dataset"() {
    const bindings = [];
    const row = {
      release_id: 25,
      published_at: "2026-09-06T09:00:00Z",
      deprecated_at: null,
      synthesizer_min_version: "1.0.0",
      synthesizer_max_version: null,
      provenance_json: "{}",
      filename: "bc03.hdf5",
      format: "hdf5",
      size_bytes: 470456456,
      sha256: "a".repeat(64),
      dataset: "bc03-2016-miles-kroupa-0p1-100",
      data_type: "grid",
      current_release_id: 25,
    };
    const env = { DB: stubDb({ rows: [row], bindings }) };
    const { status, body } = await call("/v1/releases/25", env);

    assert.equal(status, 200);
    assert.deepEqual(bindings[0], [25]);
    assert.equal(body.dataset, "bc03-2016-miles-kroupa-0p1-100");
    assert.equal(body.release_id, 25);
    assert.equal(body.is_current, true);
    assert.equal(body.file.sha256, row.sha256);
    assert.equal(body.download_url, `${ORIGIN}/v1/releases/25/download`);
  },

  async "a superseded release reports that it is not current"() {
    const row = {
      release_id: 7,
      published_at: "2026-01-01T00:00:00Z",
      deprecated_at: null,
      provenance_json: "{}",
      filename: "old.hdf5",
      format: "hdf5",
      size_bytes: 10,
      sha256: "b".repeat(64),
      dataset: "some-grid",
      data_type: "grid",
      current_release_id: 99,
    };
    const env = { DB: stubDb({ rows: [row] }) };
    const { body } = await call("/v1/releases/7", env);

    assert.equal(body.is_current, false);
  },

  async "an incident link is returned as a followable url"() {
    const env = {
      DB: stubDb({
        rows: [DATASET_ROW],
        batchResults: [
          {
            results: [
              {
                release_id: 2,
                grid_type: "sps",
                emission_type: "photoionised",
                incident_release_id: 25,
              },
            ],
          },
          { results: [] },
          { results: [] },
        ],
      }),
    };
    const { body } = await call("/v1/datasets/bpass-2-2-1-cloudy-sps-test", env);
    const grid = body.current_release.grid;

    // The bare id stays, with a url beside it so a client can follow it.
    assert.equal(grid.incident_release_id, 25);
    assert.equal(grid.incident_release_url, `${ORIGIN}/v1/releases/25`);
  },

  async "an incident link is null for an unprocessed grid"() {
    const env = {
      DB: stubDb({
        rows: [DATASET_ROW],
        batchResults: [
          {
            results: [
              { release_id: 2, grid_type: "sps", incident_release_id: null },
            ],
          },
          { results: [] },
          { results: [] },
        ],
      }),
    };
    const { body } = await call("/v1/datasets/bpass-2-2-1-cloudy-sps-test", env);

    assert.equal(body.current_release.grid.incident_release_url, null);
  },

  async "a bad release id is rejected before querying"() {
    const env = { DB: stubDb({ rows: [] }) };

    assert.equal((await call("/v1/releases/not-a-number", env)).status, 400);
    assert.equal((await call("/v1/releases/999", env)).status, 404);
  },

  async "download streams bytes with verification headers"() {
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        get: async () => ({
          body: new Blob(["payload"]).stream(),
          httpEtag: '"abc123"',
          writeHttpMetadata: () => {},
        }),
      },
    };
    const { status, body, headers } = await call("/v1/releases/2/download", env);

    assert.equal(status, 200);
    assert.equal(body, "payload");
    assert.equal(headers.get("x-syndex-sha256"), DATASET_ROW.sha256);
    assert.equal(headers.get("etag"), '"abc123"');
    assert.equal(headers.get("accept-ranges"), "bytes");
    assert.match(headers.get("cache-control"), /immutable/);
    assert.match(headers.get("content-disposition"), /bpass\.hdf5/);
  },

  async "a ranged request returns 206 with the byte range it served"() {
    const asked = [];
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        get: async (key, options) => {
          asked.push(options.range);
          return {
            body: new Blob(["load"]).stream(),
            httpEtag: '"abc123"',
            writeHttpMetadata: () => {},
          };
        },
      },
    };
    const { status, headers } = await call("/v1/releases/2/download", env, {
      headers: { range: "bytes=1000-1003" },
    });

    assert.equal(status, 206);
    // R2 is asked for exactly those bytes, not the whole 203 MB object
    assert.deepEqual(asked[0], { offset: 1000, length: 4 });
    assert.equal(
      headers.get("content-range"),
      `bytes 1000-1003/${DATASET_ROW.size_bytes}`,
    );
    assert.equal(headers.get("content-length"), "4");
    assert.equal(headers.get("accept-ranges"), "bytes");
  },

  async "an open-ended range runs to the last byte"() {
    const asked = [];
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        get: async (key, options) => {
          asked.push(options.range);
          return {
            body: new Blob(["x"]).stream(),
            httpEtag: '"abc123"',
            writeHttpMetadata: () => {},
          };
        },
      },
    };
    // This is what a resumed download sends: everything after what it has
    const { status, headers } = await call("/v1/releases/2/download", env, {
      headers: { range: "bytes=203126000-" },
    });

    assert.equal(status, 206);
    assert.deepEqual(asked[0], { offset: 203126000, length: 664 });
    assert.equal(
      headers.get("content-range"),
      `bytes 203126000-203126663/${DATASET_ROW.size_bytes}`,
    );
  },

  async "a suffix range returns the final bytes"() {
    const asked = [];
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        get: async (key, options) => {
          asked.push(options.range);
          return {
            body: new Blob(["x"]).stream(),
            httpEtag: '"abc123"',
            writeHttpMetadata: () => {},
          };
        },
      },
    };
    const { status } = await call("/v1/releases/2/download", env, {
      headers: { range: "bytes=-100" },
    });

    assert.equal(status, 206);
    assert.deepEqual(asked[0], {
      offset: DATASET_ROW.size_bytes - 100,
      length: 100,
    });
  },

  async "an impossible range is refused without reading R2"() {
    let touched = false;
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        get: async () => {
          touched = true;
          return null;
        },
      },
    };
    const { status, body, headers } = await call("/v1/releases/2/download", env, {
      headers: { range: `bytes=${DATASET_ROW.size_bytes + 1}-` },
    });

    assert.equal(status, 416);
    assert.equal(touched, false, "the size came from D1, not R2");
    assert.equal(headers.get("content-range"), `bytes */${DATASET_ROW.size_bytes}`);
    assert.match(body.error, /outside the file/);
  },

  async "a multi-range request falls back to the whole object"() {
    const asked = [];
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        get: async (key, options) => {
          asked.push(options.range);
          return {
            body: new Blob(["payload"]).stream(),
            httpEtag: '"abc123"',
            writeHttpMetadata: () => {},
          };
        },
      },
    };
    // Multipart responses are not worth supporting for a download client
    const { status } = await call("/v1/releases/2/download", env, {
      headers: { range: "bytes=0-10, 20-30" },
    });

    assert.equal(status, 200);
    assert.equal(asked[0], undefined);
  },

  async "a failed precondition returns 304 without a body"() {
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: {
        // R2 signals a precondition failure with an object carrying no body.
        get: async () => ({
          body: undefined,
          httpEtag: '"abc123"',
          writeHttpMetadata: () => {},
        }),
      },
    };
    const { status, body } = await call("/v1/releases/2/download", env, {
      headers: { "if-none-match": '"abc123"' },
    });

    assert.equal(status, 304);
    assert.equal(body, "");
  },

  async "a missing R2 object is a server-side fault, not a 404"() {
    const env = {
      DB: stubDb({ rows: [DATASET_ROW] }),
      FILES: { get: async () => null },
    };
    const { status, body } = await call("/v1/releases/2/download", env);

    assert.equal(status, 502);
    assert.match(body.error, /unavailable/);
  },

  async "bad and unknown routes are rejected distinctly"() {
    const empty = { DB: stubDb({ rows: [] }), FILES: { get: async () => null } };

    assert.equal((await call("/v1/releases/not-a-number/download", empty)).status, 400);
    assert.equal((await call("/v1/releases/999/download", empty)).status, 404);
    assert.equal((await call("/v1/datasets/nope", empty)).status, 404);
    assert.equal((await call("/v1/nonsense", empty)).status, 404);
    assert.equal((await call("/", empty)).status, 404);
    assert.equal((await call("/v1/datasets", empty, { method: "POST" })).status, 405);
  },

  async "preflight advertises the read-only methods"() {
    const { status, headers } = await call("/v1/datasets", {}, { method: "OPTIONS" });

    assert.equal(status, 204);
    assert.equal(headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
    assert.equal(headers.get("access-control-allow-origin"), "*");
  },

  async "an unexpected binding failure becomes a 500"() {
    const env = {
      DB: {
        prepare() {
          throw new Error("D1 exploded");
        },
      },
    };
    const { status, body } = await call("/v1/datasets", env);

    assert.equal(status, 500);
    // The cause is logged, never returned to the caller.
    assert.equal(body.error, "Internal error");
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
