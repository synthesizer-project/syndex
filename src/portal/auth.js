/**
 * Who is asking, and what they are allowed to do.
 *
 * Identity comes from GitHub through the ordinary OAuth web flow, and the
 * portal keeps only what it needs to recognise someone again: their GitHub id,
 * their login as it was at the last sign-in, and a role. No password reaches
 * this service, so there is none to store, hash, reset or leak.
 *
 * A session is a row in D1 holding the SHA-256 digest of a random token, and
 * the token itself is only ever in the browser's cookie. That costs one
 * indexed read per request and buys two things a signed cookie cannot: a role
 * change that takes effect immediately, and a sign-out that actually ends the
 * session rather than asking the browser nicely to forget it.
 *
 * Nothing here is needed to read the catalogue. Browsing and downloading are
 * anonymous; this guards contributing and reviewing.
 */

import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { BASE } from "./views.jsx";

/** Where GitHub sends someone to approve the sign-in. */
const AUTHORIZE = "https://github.com/login/oauth/authorize";

/** Where an authorisation code is exchanged for an access token. */
const ACCESS_TOKEN = "https://github.com/login/oauth/access_token";

/** The GitHub API, for reading who just signed in. */
const API = "https://api.github.com";

/**
 * What the portal asks GitHub for.
 *
 * `read:user` for the profile, `user:email` because an account may keep its
 * address private and a reviewer needs some way to ask a question about a
 * submission. Neither grants access to any repository.
 */
const SCOPES = "read:user user:email";

/** GitHub requires a User-Agent, and rejects requests without one. */
const USER_AGENT = "syndex-portal";

/** The cookie holding the session token. */
const SESSION_COOKIE = "syndex_session";

/** The cookie holding the OAuth state nonce and where to return to. */
const STATE_COOKIE = "syndex_oauth";

/** How long a session lasts without being renewed. */
const SESSION_DAYS = 30;

/** How long the round trip to GitHub and back is allowed to take. */
const STATE_SECONDS = 10 * 60;

/**
 * Whether to mark cookies `Secure`.
 *
 * Always true in production, where the portal is only reachable over HTTPS.
 * False against `wrangler dev`, which serves plain HTTP on localhost and
 * would otherwise drop every cookie this sets, making sign-in impossible to
 * exercise locally for no security gained: there is nothing to protect on a
 * loopback address that an attacker on the network could reach.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {boolean} Whether the connection is HTTPS.
 */
function secureCookies(c) {
  return new URL(c.req.url).protocol === "https:";
}

/**
 * The roles, weakest first. Each may do everything the ones before it may.
 *
 * Ordered rather than a set of independent permissions because that is what
 * the portal actually needs: every guarded route asks "at least a reviewer?",
 * never "may edit submissions but not users". A permission table would be
 * more expressive and would express nothing that is currently true.
 */
export const ROLES = ["pending", "contributor", "reviewer", "admin"];

/**
 * Whether a role carries at least the authority of another.
 *
 * @param {string | null | undefined} role The role held.
 * @param {string} required The role needed.
 * @returns {boolean} Whether the holder may proceed.
 */
export function atLeast(role, required) {
  const held = ROLES.indexOf(role ?? "");
  // An unknown role is not a weak role. A value the schema's CHECK constraint
  // should have made impossible must not be read as "pending and harmless".
  return held !== -1 && held >= ROLES.indexOf(required);
}

/**
 * Whether sign-in can work at all.
 *
 * Both halves of the OAuth client are configuration with no sensible default,
 * so the portal says signing in is unavailable rather than offering a button
 * that leads to an error page.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {boolean} Whether GitHub sign-in is configured.
 */
export function authConfigured(env) {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

/**
 * The logins that hold the admin role regardless of what the table says.
 *
 * This is how the first administrator exists. Without it the only way to
 * appoint one would be to write a row by hand, and a database whose access
 * rules can only be bootstrapped out of band is one where that quietly becomes
 * the normal way to change them.
 *
 * It is also the way back in if the last admin's role is removed by accident.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {Set<string>} Lowercased GitHub logins.
 */
function adminLogins(env) {
  return new Set(
    String(env.SYNDEX_ADMIN_LOGINS ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Hash a session token for storage.
 *
 * @param {string} token The token the browser holds.
 * @returns {Promise<string>} Its SHA-256 digest, hex encoded.
 */
async function digest(token) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Mint an unguessable token.
 *
 * @returns {string} 32 random bytes, hex encoded.
 */
function mintToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Reduce a return path to one that cannot leave the portal.
 *
 * The sign-in flow carries where to go afterwards, which is an open redirect
 * unless the destination is checked. Anything that is not a path inside the
 * portal becomes the portal's front page rather than an error: the visitor
 * asked to sign in, and should end up signed in.
 *
 * @param {string | null | undefined} path The requested destination.
 * @returns {string} A path within the portal.
 */
export function safeReturn(path) {
  const requested = String(path ?? "");
  // Must start with the portal's own prefix, and must not begin "//" or
  // "/\", which browsers read as a scheme-relative URL to another host.
  if (!requested.startsWith(`${BASE}/`) && requested !== BASE) {
    return BASE;
  }
  return /^\/[\\/]/.test(requested) ? BASE : requested;
}

/**
 * Begin the sign-in, remembering where to come back to.
 *
 * @param {import("hono").Context} c Request context.
 * @param {string} returnTo Where to send the visitor afterwards.
 * @returns {string} The URL to send them to now.
 */
export function beginSignIn(c, returnTo) {
  const state = mintToken();
  // The nonce and the destination travel together in one cookie, so a reply
  // from GitHub can only be accepted by the browser that asked for it, and
  // the destination cannot be rewritten by whoever crafted the callback URL.
  setCookie(c, STATE_COOKIE, `${state}:${safeReturn(returnTo)}`, {
    path: BASE,
    httpOnly: true,
    secure: secureCookies(c),
    sameSite: "Lax",
    maxAge: STATE_SECONDS,
  });

  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set(
    "redirect_uri",
    new URL(`${BASE}/auth/callback`, c.req.url).toString(),
  );
  return url.toString();
}

/**
 * Check the callback against the state this browser was given.
 *
 * @param {import("hono").Context} c Request context.
 * @param {string | undefined} state The state GitHub echoed back.
 * @returns {string | null} Where to return to, or null when it does not match.
 */
export function consumeState(c, state) {
  const cookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: BASE });
  if (!cookie || !state) {
    return null;
  }
  const separator = cookie.indexOf(":");
  const expected = cookie.slice(0, separator);
  return expected && expected === state ? safeReturn(cookie.slice(separator + 1)) : null;
}

/**
 * Exchange an authorisation code for the profile it identifies.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} code The code GitHub sent to the callback.
 * @param {string} redirectUri The same redirect_uri the flow began with.
 * @returns {Promise<{githubId: number, login: string, name: string | null,
 *     email: string | null} | null>} The profile, or null when the exchange
 *     failed.
 */
export async function profileForCode(env, code, redirectUri) {
  const exchange = await fetch(ACCESS_TOKEN, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const granted = await exchange.json().catch(() => null);
  const token = granted?.access_token;
  if (!exchange.ok || !token) {
    console.error(
      JSON.stringify({
        message: "GitHub refused the authorisation code",
        status: exchange.status,
        error: granted?.error ?? null,
      }),
    );
    return null;
  }

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": USER_AGENT,
  };
  const response = await fetch(`${API}/user`, { headers });
  if (!response.ok) {
    console.error(
      JSON.stringify({
        message: "GitHub would not say who signed in",
        status: response.status,
      }),
    );
    return null;
  }
  const profile = await response.json();

  // The profile carries an address only when the account publishes one. The
  // separate endpoint returns the verified primary address whether or not it
  // is public, and a failure here is not a failure to sign in: the submission
  // form asks for a contact address anyway.
  let email = profile.email ?? null;
  if (email === null) {
    const addresses = await fetch(`${API}/user/emails`, { headers })
      .then((result) => (result.ok ? result.json() : []))
      .catch(() => []);
    email =
      addresses.find((entry) => entry.primary && entry.verified)?.email ?? null;
  }

  return {
    githubId: profile.id,
    login: profile.login,
    name: profile.name ?? null,
    email,
  };
}

/**
 * Record a sign-in, creating the account on the first one.
 *
 * The role is never overwritten for an account that already has one, except
 * to restore an administrator named in configuration: a sign-in is not a
 * change of authority.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {object} profile The GitHub profile.
 * @returns {Promise<object>} The stored user row.
 */
export async function recordSignIn(env, profile) {
  const now = new Date().toISOString();
  const isAdmin = adminLogins(env).has(profile.login.toLowerCase());

  return env.DB.prepare(
    `INSERT INTO users (github_id, login, name, email, role, created_at,
                        last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET
       login = excluded.login,
       name = excluded.name,
       email = COALESCE(excluded.email, users.email),
       last_seen_at = excluded.last_seen_at,
       role = CASE WHEN ? THEN 'admin' ELSE users.role END
     RETURNING *`,
  )
    .bind(
      profile.githubId,
      profile.login,
      profile.name,
      profile.email,
      isAdmin ? "admin" : "pending",
      now,
      now,
      isAdmin ? 1 : 0,
    )
    .first();
}

/**
 * Start a session and give the browser its token.
 *
 * @param {import("hono").Context} c Request context.
 * @param {number} userId Who the session belongs to.
 * @returns {Promise<void>} Resolves once the session exists.
 */
export async function startSession(c, userId) {
  const token = mintToken();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO sessions (token_digest, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      await digest(token),
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_DAYS * 86400_000).toISOString(),
    )
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    path: BASE,
    httpOnly: true,
    secure: secureCookies(c),
    // Lax rather than Strict: a link to the portal from an email or an issue
    // should arrive signed in. It still withholds the cookie from
    // cross-site form posts, which is what guards the portal's own writes.
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 86400,
  });
}

/**
 * End the session this request carries.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {Promise<void>} Resolves once it is gone.
 */
export async function endSession(c) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_digest = ?")
      .bind(await digest(token))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: BASE });
}

/**
 * End every session one account holds.
 *
 * Removing a role takes effect on that account's next request already, since
 * the role is read from the table rather than from anything the browser
 * carries. This is the other half: it also stops them being signed in, which
 * matters when the reason is a shared machine or a credential somebody else
 * now has rather than a change of mind about what they may do.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {number} userId Whose sessions to end.
 * @returns {Promise<void>} Resolves once they are gone.
 */
export async function endSessions(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
    .bind(userId)
    .run();
}

/**
 * Who is making this request.
 *
 * The role is read from `users` rather than from anything the browser holds,
 * which is what makes a promotion or a demotion take effect on the next page
 * rather than on the next sign-in.
 *
 * @param {import("hono").Context} c Request context.
 * @returns {Promise<object | null>} The signed-in user, or null.
 */
export async function currentUser(c) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return null;
  }

  const user = await c.env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.token_digest = ? AND s.expires_at > ?`,
  )
    .bind(await digest(token), new Date().toISOString())
    .first();

  // An expired or revoked session leaves a cookie that will be sent on every
  // request until it expires on its own. Clearing it here stops that, and
  // stops the header flickering between states.
  if (user === null) {
    deleteCookie(c, SESSION_COOKIE, { path: BASE });
  }
  return user;
}
