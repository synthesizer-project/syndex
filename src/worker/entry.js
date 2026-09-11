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

/** Hostnames whose non-portal traffic belongs to the org site, not the API. */
const SITE_HOSTS = new Set([
  "synthesizer-project.org",
  "www.synthesizer-project.org",
]);

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
    if (pathname === "/syndex" || pathname.startsWith("/syndex/")) {
      return portal.fetch(request, env, ctx);
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

    return api.fetch(request, env, ctx);
  },
};
