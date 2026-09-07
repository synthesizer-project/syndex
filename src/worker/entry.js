/**
 * Entry point for the Worker that serves both the catalogue API and the
 * portal.
 *
 * The two are separate handlers rather than one router. Every
 * `synthesizer-download` call and every CI run in the ecosystem resolves
 * against `/v1/*`, so the API keeps its own module and its own tests and
 * portal work cannot change its behaviour by accident. The portal is a Hono
 * app mounted under `/syndicate`, and shares the D1 and R2 bindings, so its
 * pages query the catalogue in process instead of calling their own API.
 */

import portal from "../portal/app.jsx";
import api from "./index.js";

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
    const { pathname } = new URL(request.url);
    if (pathname === "/syndicate" || pathname.startsWith("/syndicate/")) {
      return portal.fetch(request, env, ctx);
    }
    return api.fetch(request, env, ctx);
  },
};
