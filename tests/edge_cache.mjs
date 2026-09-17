/**
 * Tests for the two things that stopped the catalogue reading five and a half
 * million database rows a day.
 *
 * The first is the edge cache in the Worker's entry point. Setting
 * `cache-control` on a response a Worker generated does not cache it --
 * Cloudflare only caches what the Worker puts in `caches.default` -- so
 * before this every request ran the queries, and a crawler walking the
 * catalogue ran them once per page per pass.
 *
 * The second is the tab counts, which were read on every render.
 *
 * Run with `node tests/edge_cache.mjs`. There is no network and no D1: the
 * cache is a Map and the database counts how often it was asked.
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { load } from "./jsx_hooks.mjs";

registerHooks({ load });

/** A stand-in for the Workers cache global, which Node does not have. */
class FakeCache {
  constructor() {
    this.entries = new Map();
    this.puts = [];
  }

  async match(request) {
    const hit = this.entries.get(request.url);
    return hit === undefined ? undefined : hit.clone();
  }

  async put(request, response) {
    if (response.headers.has("set-cookie")) {
      throw new TypeError("cannot cache a response with set-cookie");
    }
    this.puts.push(request.url);
    this.entries.set(request.url, response);
  }
}

const cache = new FakeCache();
globalThis.caches = { default: cache };

const { default: worker } = await import("../src/worker/entry.js");
const { forgetCounts } = await import("../src/portal/data/catalogue.js");
const { describeFailure, secondsUntilUtcMidnight } = await import(
  "../src/failure.js"
);

/** The exact message Cloudflare returns when the daily allowance is spent. */
const QUOTA = new Error(
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. " +
    "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to " +
    "continue. See https://developers.cloudflare.com/d1/platform/limits/ " +
    "for more details.",
);

/**
 * A database that fails the way the real one does.
 *
 * D1 rejects when a statement runs, not when it is prepared. A stub that
 * throws from `prepare` instead leaves promises nobody is waiting on, which
 * is a fault in the stub rather than in the code under test.
 */
const failingDb = (thrown) => ({
  prepare() {
    return {
      bind() {
        return this;
      },
      first: async () => {
        throw thrown;
      },
      all: async () => {
        throw thrown;
      },
      run: async () => {
        throw thrown;
      },
    };
  },
  batch: async () => {
    throw thrown;
  },
});

/** A D1 stub that counts the statements it is asked for. */
function countingDb(statements) {
  return {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() {
          return this;
        },
        first: async () => ({ datasets: 1, bytes: 10, waiting: 0, n: 1 }),
        all: async () => ({ results: [{ data_type: "grid", n: 3 }] }),
        run: async () => ({ success: true }),
      };
    },
    batch: async (all) => all.map(() => ({ results: [] })),
  };
}

const ctx = { waitUntil: (promise) => promise, passThroughOnException() {} };

/** Call the whole Worker, entry point included. */
const call = (url, init = {}) => worker.fetch(new Request(url, init), { DB: countingDb(statements) }, ctx);

let statements = [];

const tests = {
  async "a spent daily allowance is a 503 that says when it comes back"() {
    const now = Date.UTC(2026, 8, 17, 16, 15);
    const failure = describeFailure(QUOTA, now);

    assert.equal(failure.status, 503, "not a 500: nothing here is broken");
    assert.equal(failure.transient, true);
    // 16:15 UTC to midnight is 7h45m.
    assert.equal(failure.retryAfter, secondsUntilUtcMidnight(now));
    assert.equal(failure.retryAfter, 7 * 3600 + 45 * 60);
    assert.match(failure.detail, /midnight UTC, in about 8 hours/);
  },

  async "an unreachable database asks for a minute, a fault asks for nothing"() {
    const unreachable = describeFailure(new Error("D1_ERROR: whatever"));
    assert.equal(unreachable.status, 503);
    assert.equal(unreachable.retryAfter, 60);

    const fault = describeFailure(new TypeError("x.replace is not a function"));
    assert.equal(fault.status, 500, "a bug here will fail again on retry");
    assert.equal(fault.retryAfter, null);
    assert.equal(fault.transient, false);
  },

  async "the portal page for a spent allowance says so, and offers a reload"() {
    const response = await worker.fetch(
      new Request("https://synthesizer-project.org/syndex"),
      { DB: failingDb(QUOTA) },
      ctx,
    );
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(body, /resets at midnight UTC/);
    assert.match(body, /Try this page again/);
    // Never the underlying message, and never a way to read one.
    assert.doesNotMatch(body, /D1_ERROR/);
  },

  async "the API says the same thing, in the shape a script reads"() {
    const response = await worker.fetch(
      new Request("https://data.synthesizer-project.org/v1/datasets"),
      { DB: failingDb(QUOTA) },
      ctx,
    );
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.ok(body.retry_after_seconds > 0, "a script needs the number");
    assert.equal(
      response.headers.get("retry-after"),
      String(body.retry_after_seconds),
      "the header and the body must not disagree",
    );
    assert.match(body.error, /midnight UTC/);
    assert.doesNotMatch(JSON.stringify(body), /D1_ERROR/);
  },

  async "an anonymous page is answered from the cache the second time"() {
    cache.entries.clear();
    forgetCounts();
    statements = [];

    const first = await call("https://synthesizer-project.org/syndex");
    assert.equal(first.status, 200);
    const asked = statements.length;
    assert.ok(asked > 0, "the first request should query");

    const second = await call("https://synthesizer-project.org/syndex");
    assert.equal(second.status, 200);
    assert.equal(
      statements.length,
      asked,
      "the second request must not reach the database at all",
    );
  },

  async "a signed-in request is neither served nor stored"() {
    cache.entries.clear();
    cache.puts = [];
    forgetCounts();
    statements = [];

    // Anonymous first, so there is something in the cache to wrongly serve.
    await call("https://synthesizer-project.org/syndex");
    const stored = cache.puts.length;

    const asked = statements.length;
    await call("https://synthesizer-project.org/syndex", {
      headers: { cookie: "syndex_session=abc" },
    });

    assert.ok(
      statements.length > asked,
      "a request carrying a cookie must be answered freshly",
    );
    assert.equal(cache.puts.length, stored, "and must not be stored");
  },

  async "a cached page is never served to htmx, which asked for a fragment"() {
    cache.entries.clear();
    forgetCounts();

    // Prime the cache with the whole page.
    const page = await call("https://synthesizer-project.org/syndex/search");
    assert.ok((await page.text()).startsWith("<!doctype"));
    assert.equal(cache.entries.size, 1);

    // htmx asks for the same URL and must get the panel alone. Sharing an
    // entry would swap an entire document into the results panel.
    const swap = await call("https://synthesizer-project.org/syndex/search", {
      headers: { "HX-Request": "true" },
    });
    const body = await swap.text();
    assert.ok(!body.startsWith("<!doctype"), "htmx was served the full page");
    assert.ok(body.includes("id=\"panel\""), "expected the results panel");

    // And a fragment is `no-store`, so it never enters the cache itself.
    assert.equal(cache.entries.size, 1);
  },

  async "both hostnames answer robots.txt, without touching the database"() {
    cache.entries.clear();
    statements = [];

    const portal = await call("https://synthesizer-project.org/robots.txt");
    assert.equal(portal.status, 200);
    const portalText = await portal.text();
    // The search page is the unbounded one: every facet combination is a URL.
    assert.match(portalText, /Disallow: \/syndex\/search/);
    // The catalogue itself is finite and worth indexing.
    assert.match(portalText, /Allow: \/syndex\/datasets\//);
    // Signed-in pages are pointless to crawl and cost a query each.
    assert.match(portalText, /Disallow: \/syndex\/review/);

    const api = await call("https://data.synthesizer-project.org/robots.txt");
    assert.equal(api.status, 200);
    assert.match(await api.text(), /Disallow: \/\s*$/m);

    assert.equal(statements.length, 0, "robots.txt must not query anything");
  },

  async "the tab counts are read once, not once per page"() {
    forgetCounts();
    cache.entries.clear();
    statements = [];

    const counts = (list) =>
      list.filter((sql) => sql.includes("GROUP BY d.data_type")).length;

    await call("https://synthesizer-project.org/syndex");
    assert.equal(counts(statements), 1);

    // A different URL, so the edge cache cannot be what saves the query.
    await call("https://synthesizer-project.org/syndex/search");
    assert.equal(
      counts(statements),
      1,
      "the counts should be remembered across requests",
    );

    forgetCounts();
    cache.entries.clear();
    await call("https://synthesizer-project.org/syndex");
    assert.equal(counts(statements), 2, "and asked for again once dropped");
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
