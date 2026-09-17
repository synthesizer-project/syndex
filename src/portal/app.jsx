/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The Syndex portal: server-rendered pages over the same D1 and R2 bindings
 * the API uses.
 *
 * This file is the assembly and nothing else. It establishes who is reading,
 * mounts each group of routes, and says what happens when a page is missing
 * or a handler throws; the pages themselves are in `routes/`, the queries
 * they make in `data/`, and what they render in `pages/`.
 *
 * Mount order is match order: Hono tries routes in the order they were
 * registered. No two modules claim overlapping paths, so what this order
 * settles is only that the catch-alls below come last. Order within a module
 * does matter -- `/submit/release` has to be registered before
 * `/submit/:token`, or it is read as a token.
 *
 * Search state lives in URL query parameters, so every filtered view is
 * shareable, citable, back-button-correct and works with JavaScript
 * disabled. htmx then upgrades a filter change into a background request
 * that swaps the panel and rewrites the URL; the plain form submission it
 * replaces still works, and is what the no-JavaScript path uses.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { trimTrailingSlash } from "hono/trailing-slash";

import { BASE } from "./base.js";
import { currentUser } from "./data/auth.js";
import { tabCounts } from "./data/catalogue.js";
import { NotFound } from "./pages/refusals.jsx";
import { routes as accountRoutes } from "./routes/account.jsx";
import { routes as authRoutes } from "./routes/auth.jsx";
import { routes as catalogueRoutes } from "./routes/catalogue.jsx";
import { page } from "./routes/respond.jsx";
import { routes as reviewRoutes } from "./routes/review.jsx";
import { routes as submitRoutes } from "./routes/submit.jsx";
import { routes as validateRoutes } from "./routes/validate.jsx";

/** The portal, mounted under /syndex and sharing the API's bindings. */
const app = new Hono().basePath(BASE);

// /syndex/ and /syndex are the same page, and only one of them should
// be the URL anybody shares or cites.
app.use(trimTrailingSlash());

// Who is reading, established once per request. The role is read from the
// database rather than from the cookie, so a promotion or a demotion takes
// effect on the next page load.
app.use("*", async (c, next) => {
  c.set("viewer", { user: await currentUser(c) });
  await next();
});

// Mounted at the root, so each module writes the same paths it would have
// written here. What this decides is the order they are tried in.
app.route("/", catalogueRoutes);
app.route("/", authRoutes);
app.route("/", accountRoutes);
app.route("/", submitRoutes);
app.route("/", validateRoutes);
app.route("/", reviewRoutes);

app.notFound(async (c) =>
  page(
    c,
    <NotFound
      counts={await tabCounts(c.env.DB)}
      message={`There is no page at ${new URL(c.req.url).pathname}.`}
    />,
    { status: 404, cache: "no-store" },
  ),
);

app.onError((error, c) => {
  // A challenge or a deliberate refusal is already a complete answer, and
  // must not be turned into a 500 that hides it.
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  console.error(
    JSON.stringify({
      message: "Unhandled portal error",
      path: new URL(c.req.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  // Deliberately not a JSX page: whatever just failed may be the renderer
  // itself, so this is a complete document with no dependencies but the
  // stylesheet, and it still offers a way out.
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Something went wrong \u00b7 Syndex</title>` +
      `<link rel="stylesheet" href="${BASE}/static/app.css"></head>` +
      `<body class="bg-bg text-text">` +
      `<main class="mx-auto max-w-2xl px-6 py-12">` +
      `<h1 class="text-3xl">Something went wrong</h1>` +
      `<p class="mt-3 text-muted">This page could not be rendered. The ` +
      `failure has been logged.</p>` +
      `<p class="mt-4"><a href="${BASE}">Back to the catalogue</a></p>` +
      `</main></body></html>`,
    500,
    { "cache-control": "no-store" },
  );
});

export default app;

