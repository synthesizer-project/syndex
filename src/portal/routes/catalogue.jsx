/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Reading the catalogue: the landing page, search, and one dataset.
 *
 * The only pages anybody can read without an account, and the only ones
 * worth a shared cache -- everything else is either signed in, and private to
 * one person, or a form. Search state lives entirely in the query string, so
 * every view is a URL somebody can send to somebody else, and the htmx path
 * returns the same panel the full page would have rendered.
 */

import { Hono } from "hono";

import { BASE } from "../base.js";
import {
  TABS,
  dataset as fetchDataset,
  isFiltered,
  parseFilters,
  search,
  tabCounts,
} from "../data/catalogue.js";
import { Browse, Dataset, Landing } from "../pages/catalogue.jsx";
import { NotFound } from "../pages/refusals.jsx";
import { Panel } from "../views/results.jsx";
import { fragment, page } from "./respond.jsx";

/** The routes this module contributes, mounted by `app.jsx`. */
export const routes = new Hono();

/** What a tab's rows are called in a count. */
const NOUNS = {
  search: "dataset",
  grids: "grid",
  dust: "dust grid",
  instruments: "instrument",
};

routes.get("/", async (c) => {
  const [counts, totals] = await Promise.all([
    tabCounts(c.env.DB),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS datasets, SUM(f.size_bytes) AS bytes
       FROM datasets d
       JOIN releases r ON r.release_id = d.current_release_id
       JOIN files f ON f.file_id = r.file_id`,
    ).first(),
  ]);

  return page(
    c,
    <Landing
      counts={counts}
      datasets={totals.datasets}
      bytes={totals.bytes}
    />,
  );
});

routes.get("/search", async (c) => {
  const filters = parseFilters(new URL(c.req.url).searchParams);
  const tab =
    TABS.find((candidate) => candidate.types?.includes(filters.type[0])) ?? TABS[0];
  const result = await search(c.env.DB, tab, filters);
  const panel = (
    <Panel tab={tab} filters={filters} result={result} noun={NOUNS[tab.id]} />
  );

  // htmx asks for the panel alone. Everything else about the request is the
  // same, which is what keeps the two paths from drifting apart.
  //
  // Except on a history restore. When htmx has no cached snapshot for a URL
  // the back button lands on, it re-fetches it with both HX-Request and
  // HX-History-Restore-Request set, and replaces the whole body with what
  // comes back -- so answering that with a fragment leaves the page as a bare
  // results panel with none of the layout around it.
  const restoring = c.req.header("HX-History-Restore-Request") === "true";
  if (!restoring && c.req.header("HX-Request") === "true") {
    return fragment(c, panel);
  }

  const counts = await tabCounts(c.env.DB);
  return page(
    c,
    <Browse tab={tab} counts={counts} filters={filters}>
      {panel}
    </Browse>,
    // A filtered view is cheap to recompute and awkward to cache: the URL
    // carries the filters, so a cached copy would be one arbitrary search.
    { cache: isFiltered(filters) ? "no-store" : "public, max-age=60" },
  );
});

// The tab paths the portal used to have, kept because they were shareable.
//
// Registered as four literal routes rather than one `:tab{grids|dust|...}`
// pattern. That pattern is composed into a regex where `|` binds loosest, so
// it read as "starts with /syndex/grids, OR contains dust, OR contains
// instruments, OR ends with data" -- and every dataset with `dust` in its name
// was redirected to the dust tab instead of opening.
const TAB_PATHS = {
  "/grids": "grid",
  "/dust": "dust_grid",
  "/instruments": "instrument",
  "/data": null,
};

routes.on("GET", Object.keys(TAB_PATHS), (c) => {
  const params = new URL(c.req.url).searchParams;
  const type = TAB_PATHS[new URL(c.req.url).pathname.slice(BASE.length)];
  if (type === null) {
    params.delete("type");
  } else {
    params.set("type", type);
  }
  // 307 and no-store, not 308. A 308 is cacheable for ever by default, so
  // when this route's pattern was wrong every browser that touched a dust
  // grid's page learned the redirect permanently and kept honouring it long
  // after the server stopped sending it. An alias is not worth a redirect
  // nobody can take back.
  const target = `${BASE}/search${params.size === 0 ? "" : `?${params}`}`;
  return c.body(null, 307, {
    location: target,
    "cache-control": "no-store",
  });
});

routes.get("/datasets/:name", async (c) => {
  const name = c.req.param("name");
  const requestedReturn = c.req.query("return");
  const returnTo =
    requestedReturn === `${BASE}/search` ||
    requestedReturn?.startsWith(`${BASE}/search?`)
      ? requestedReturn
      : null;
  const [record, counts] = await Promise.all([
    fetchDataset(c.env.DB, name),
    tabCounts(c.env.DB),
  ]);

  if (record === null) {
    return page(
      c,
      <NotFound counts={counts} message={`There is no dataset named ${name}.`} />,
      { status: 404, cache: "no-store" },
    );
  }

  return page(c, <Dataset dataset={record} counts={counts} returnTo={returnTo} />);
});
