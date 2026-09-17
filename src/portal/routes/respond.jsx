/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Turning a component into a response, and deciding who gets one.
 *
 * Every route in `routes/` ends in `page` or `fragment`, and the guarded ones
 * begin with `requireRole`. They live together because they are the same
 * decision seen twice: what the reader is allowed to see, and what the
 * response may say about them. Both read the viewer `app.jsx` establishes for
 * the request, which is why a page rendered for somebody signed in is private
 * to them without any handler having to remember it.
 */

import { BASE } from "../base.js";
import { atLeast, authConfigured } from "../data/auth.js";
import { tabCounts } from "../data/catalogue.js";
import { NotFound, SignInRequired } from "../pages/refusals.jsx";
import { ViewerContext } from "../views/layout.jsx";

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
export async function page(c, node, { status = 200, cache = "public, max-age=300" } = {}) {
  const { user } = c.get("viewer") ?? { user: null };
  const requested = new URL(c.req.url);
  const viewer = {
    user,
    waiting: await waitingCount(c, user),
    // What a link preview should call this page, and what it should resolve
    // its image against. Taken from the request rather than written down, so
    // a local run and the deployment each describe themselves correctly.
    url: `${requested.origin}${requested.pathname}`,
    origin: requested.origin,
  };
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
export function fragment(c, node) {
  return c.html(node.toString(), 200, {
    "cache-control": "no-store",
    vary: "HX-Request, HX-History-Restore-Request",
  });
}

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
export function requireRole(required) {
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
