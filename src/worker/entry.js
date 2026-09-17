/**
 * Entry point for the Worker that serves both the catalogue API and the
 * portal.
 *
 * The two are separate handlers rather than one router. Every
 * `synthesizer-download` call and every CI run in the ecosystem resolves
 * against `/v1/*`, so the API keeps its own module and its own tests and
 * portal work cannot change its behaviour by accident. The portal is a Hono
 * app mounted under `/syndex`, and shares the D1 and R2 bindings, so its
 * pages query the catalogue in process instead of calling their own API.
 */

import portal from "../portal/app.jsx";
import api from "./index.js";

/**
 * Where the project's own site lives, and stays living.
 *
 * The apex serves the portal under `/syndex` and nothing else of its own, so
 * everything else there is sent to the org site. Deliberately a redirect to
 * `github.io` rather than the other way round: GitHub Pages will serve a
 * custom domain, but doing so makes `<org>.github.io` permanently redirect to
 * it, and `synthesizer-project.org` is new enough that security products still
 * block it. Until that passes, the old address has to keep working on its own.
 *
 * Reverse when the domain has aged out: set the custom domain on the Pages
 * repository, point the apex at Pages, and delete this.
 */
const ORG_SITE = "https://synthesizer-project.github.io";

/**
 * What a crawler is asked to leave alone, per hostname.
 *
 * The apex has never had a usable one: `/robots.txt` redirected to the org
 * site's, which is a 404, so nothing restrained anything. The search page is
 * the expensive part -- every tick of every facet is another URL over the
 * same 244 datasets, which is an unbounded crawl over a bounded catalogue --
 * and the dataset pages are the finite, worthwhile ones.
 *
 * The API host asks to be left alone entirely. It answers programs, and a
 * crawler walking it reads the database for results nobody will ever see.
 */
const ROBOTS = {
  portal: `User-agent: *

# Filter combinations, not documents: the same datasets behind every one.
Disallow: /syndex/search
Disallow: /syndex/grids
Disallow: /syndex/dust
Disallow: /syndex/instruments
Disallow: /syndex/data

# Nothing here answers without an account.
Disallow: /syndex/access
Disallow: /syndex/account
Disallow: /syndex/accounts
Disallow: /syndex/auth
Disallow: /syndex/login
Disallow: /syndex/review
Disallow: /syndex/submissions
Disallow: /syndex/submit

# The catalogue itself, which is what is worth reading.
Allow: /syndex/datasets/
Allow: /syndex$

Crawl-delay: 10
`,
  api: `User-agent: *

# A read-only API for programs. Every response here is assembled from the
# database, and nothing in it is a document worth indexing; the catalogue for
# people is https://synthesizer-project.org/syndex.
Disallow: /
`,
};

/**
 * The largest answer worth keeping in the edge cache.
 *
 * Big enough for any page, any JSON response and any preview; far below a
 * grid, which must stream rather than be buffered into the cache.
 */
const MAX_CACHED_BYTES = 5 * 1024 * 1024;

/** Hostnames whose non-portal traffic belongs to the org site, not the API. */
const SITE_HOSTS = new Set([
  "synthesizer-project.org",
  "www.synthesizer-project.org",
]);

/**
 * Whether this answer may be kept in the edge cache.
 *
 * The cache is keyed on the URL, so anything that varies by who is asking
 * must not go in it. That is the whole of the rule: a response carrying a
 * cookie, or marked private or no-store, belongs to one person.
 *
 * File bytes are excluded too. They are immutable and worth caching in
 * principle, but `cache.put` reads the body into the cache, and these run to
 * tens of gigabytes.
 *
 * @param {Response} response The answer about to be sent.
 * @returns {boolean} Whether to keep a copy.
 */
function storable(response) {
  if (response.status !== 200 || response.headers.has("set-cookie")) {
    return false;
  }
  if (response.headers.has("content-disposition")) {
    return false;
  }
  const control = response.headers.get("cache-control") ?? "";
  if (!control.includes("public") || /no-store|private/.test(control)) {
    return false;
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  return length <= MAX_CACHED_BYTES;
}

/**
 * The key one request is cached under.
 *
 * htmx asks for the same URL and expects a fragment rather than a page, so
 * the two answers cannot share an entry. The marker goes in the key and never
 * reaches a handler.
 *
 * @param {Request} request Incoming request.
 * @returns {Request} The key to look it up by.
 */
function cacheKey(request) {
  const url = new URL(request.url);
  if (request.headers.get("HX-Request") === "true") {
    url.searchParams.set("__fragment", "1");
  }
  return new Request(url.toString(), { method: "GET" });
}

/**
 * Answer from the edge cache where possible, and keep what comes back.
 *
 * Setting `cache-control` on a response a Worker generated does not put it in
 * Cloudflare's cache -- it only tells the browser what to do -- so without
 * this every request ran the queries, and a crawler walking the catalogue ran
 * them once per page per pass. One query alone read five and a half million
 * rows in a day that way, which is D1's entire free daily allowance.
 *
 * Anonymous GETs only: see `storable`. Signed-in pages answer `private,
 * no-store` and are never kept.
 *
 * @param {Request} request Incoming request.
 * @param {ExecutionContext} ctx Execution context, for storing after replying.
 * @param {Function} handler Produces the answer when the cache has none.
 * @returns {Promise<Response>} The answer, cached or fresh.
 */
async function cached(request, ctx, handler) {
  // `caches` is a Workers global. The tests run under Node, which has none,
  // and a missing cache is a slow path rather than a failure.
  if (
    typeof caches === "undefined" ||
    request.method !== "GET" ||
    request.headers.has("cookie")
  ) {
    return handler();
  }

  const key = cacheKey(request);
  const hit = await caches.default.match(key);
  if (hit !== undefined) {
    return hit;
  }

  const response = await handler();
  if (storable(response)) {
    // Stored after the reply goes out, so nobody waits for it.
    ctx.waitUntil(caches.default.put(key, response.clone()));
  }
  return response;
}

export default {
  /**
   * Route one request to whichever handler owns its path.
   *
   * @param {Request} request Incoming request.
   * @param {{ DB: D1Database, FILES: R2Bucket }} env Worker bindings.
   * @param {ExecutionContext} ctx Execution context.
   * @returns {Promise<Response>} The response.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/robots.txt") {
      return new Response(
        SITE_HOSTS.has(url.hostname) ? ROBOTS.portal : ROBOTS.api,
        {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            // A day: long enough to be worth caching, short enough that a
            // correction here takes effect the same week.
            "cache-control": "public, max-age=86400",
          },
        },
      );
    }
    if (pathname === "/syndex" || pathname.startsWith("/syndex/")) {
      return cached(request, ctx, () => portal.fetch(request, env, ctx));
    }

    // The API answers on its own hostname. On the apex it is the org site that
    // owns everything outside `/syndex`, so send visitors there rather than
    // showing them a JSON 404 from a service they did not ask for.
    if (SITE_HOSTS.has(url.hostname) && !pathname.startsWith("/v1/")) {
      // 302 and no-store: this is a stand-in for pointing the apex at Pages,
      // and a redirect that outlives the arrangement it stands in for is a
      // redirect nobody can withdraw.
      return new Response(null, {
        status: 302,
        headers: {
          location: `${ORG_SITE}${pathname}${url.search}`,
          "cache-control": "no-store",
        },
      });
    }

    return cached(request, ctx, () => api.fetch(request, env, ctx));
  },
};
