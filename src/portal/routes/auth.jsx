/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Signing in and out, from a browser and from a terminal.
 *
 * Both flows end in the same place -- a session row and a cookie or a bearer
 * token -- and differ only in how GitHub is asked who somebody is: a redirect
 * when there is a browser to redirect, the device flow when there is not.
 * Nothing here decides what an account may do; that is `atLeast` and the
 * roles, and it is read fresh on every request.
 */

import { Hono } from "hono";

import { BASE } from "../base.js";
import {
  authConfigured,
  beginSignIn,
  consumeState,
  endSession,
  profileForCode,
  recordSignIn,
  sessionForGithubToken,
  startSession,
} from "../data/auth.js";
import { tabCounts } from "../data/catalogue.js";
import { NotFound } from "../pages/refusals.jsx";
import { page } from "./respond.jsx";

/** The routes this module contributes, mounted by `app.jsx`. */
export const routes = new Hono();

routes.get("/login", (c) => {
  if (!authConfigured(c.env)) {
    return c.text("Signing in is not configured.", 503, {
      "cache-control": "no-store",
    });
  }
  return c.redirect(beginSignIn(c, c.req.query("return")), 302);
});

routes.get("/auth/callback", async (c) => {
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

/**
 * What a command-line client needs to begin signing in.
 *
 * The client id rather than a hard-coded copy of it, so a client built
 * against one deployment works against another without being rebuilt.
 */
routes.get("/auth/cli", (c) =>
  c.json(
    { client_id: c.env.GITHUB_CLIENT_ID ?? null },
    authConfigured(c.env) ? 200 : 503,
    { "cache-control": "no-store" },
  ),
);

/**
 * Turn a token from GitHub's device flow into a session here.
 *
 * The client proves who it is to GitHub, which is the only thing it can
 * prove; this asks GitHub who that was and issues an ordinary session for
 * them. No password, no key, nothing to store on the machine but a session
 * that expires and can be revoked from the account page.
 */
routes.post("/auth/cli", async (c) => {
  if (!authConfigured(c.env)) {
    return c.json({ error: "Signing in is not configured" }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const githubToken = String(body.github_token ?? "");
  if (githubToken === "") {
    return c.json({ error: "No token" }, 400);
  }

  const session = await sessionForGithubToken(c.env, githubToken);
  if (session === null) {
    return c.json({ error: "GitHub did not recognise that token" }, 401);
  }

  return c.json(
    {
      token: session.token,
      login: session.user.login,
      role: session.user.role,
    },
    200,
    { "cache-control": "no-store" },
  );
});

routes.post("/logout", async (c) => {
  await endSession(c);
  return c.redirect(BASE, 303);
});
