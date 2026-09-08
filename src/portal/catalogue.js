/**
 * Catalogue queries for the portal.
 *
 * Pages read D1 through the binding, in process. Nothing here calls the
 * site's own /v1 API over HTTP: the rows are one statement away, and a page
 * that fetched itself would pay a TLS handshake and a cold cache to learn
 * what a subquery already knows.
 *
 * Filter state arrives as URL query parameters and leaves as SQL. The two
 * are kept adjacent deliberately, since every filter has to survive being
 * round-tripped through a shareable URL.
 */

/** Catalogue views. Tabs are shortcuts for setting one data-type filter. */
export const TABS = [
  { id: "search", label: "All", types: null },
  { id: "grids", label: "Grids", types: ["grid"] },
  { id: "dust", label: "Dust grids", types: ["dust_grid"] },
  { id: "instruments", label: "Instruments", types: ["instrument"] },
];

const MB = 1000 ** 2;
const GB = 1000 ** 3;

/** Stable, human-scale file-size ranges used by the generic size facet. */
export const SIZE_BUCKETS = [
  {
    value: "under_10_mib",
    label: "Under 10 MB",
    sql: `f.size_bytes < ${10 * MB}`,
  },
  {
    value: "10_100_mib",
    label: "10–100 MB",
    sql: `f.size_bytes >= ${10 * MB} AND f.size_bytes < ${100 * MB}`,
  },
  {
    value: "100_mib_1_gib",
    label: "100 MB–1 GB",
    sql: `f.size_bytes >= ${100 * MB} AND f.size_bytes < ${GB}`,
  },
  {
    value: "1_10_gib",
    label: "1–10 GB",
    sql: `f.size_bytes >= ${GB} AND f.size_bytes < ${10 * GB}`,
  },
  {
    value: "over_10_gib",
    label: "Over 10 GB",
    sql: `f.size_bytes >= ${10 * GB}`,
  },
];

/**
 * Short rail labels for models whose full names do not fit one.
 *
 * `Bruzual & Charlot (2003), 2016 update` is a correct name and unusable as
 * a facet row, and the two Draine & Li spellings are one model recorded two
 * ways. This is a display concern, so it lives here rather than becoming a
 * column in the catalogue: the full name stays authoritative and is what the
 * dataset page shows.
 */
export const MODEL_LABELS = {
  "Bruzual & Charlot (2003)": "BC03",
  "Bruzual & Charlot (2003), 2016 update": "BC03 (2016)",
  "Draine & Li dust extinction curves": "Draine & Li (curves)",
  "Maraston (2013)": "Maraston 13",
  "Maraston (2024)": "Maraston 24",
};

/** One solar mass in kilogrammes, as the catalogue's mass axes spell it. */
const SOLAR_MASS_KG = 1.98841586e30;

/**
 * Axes needing their stored numbers normalised before they can be compared.
 *
 * `masses` carries three spellings of the same unit (`kg` and two ways of
 * writing a solar mass in kilogrammes), all physically correct, so the
 * numbers themselves differ by that factor between grids. Filtering converts
 * to solar masses, which is also what the range inputs ask for, rather than
 * rewriting anybody's metadata. See docs/migration-notes.md.
 *
 * Every other axis is consistent across the catalogue, and axis bounds are
 * stored as physical values with `scale` a display hint, so a range compares
 * safely across grids written in log and linear alike.
 */
export const AXIS_UNITS = {
  masses: {
    label: "M☉",
    scale: `CASE WHEN a.units = 'kg' THEN 1.0 / ${SOLAR_MASS_KG} ELSE 1.0 END`,
    // The same conversion again, for the column that displays the range.
    // Filtering happens in SQL and rendering in JavaScript, so there is
    // nowhere for one expression to serve both; they are kept adjacent so a
    // change to one is a change to the other.
    factor: (units) => (units === "kg" ? 1 / SOLAR_MASS_KG : 1),
  },
};

/** How an axis range is allowed to match, and what the toggle says. */
export const RANGE_MODES = {
  overlap: "Any overlap",
  contain: "Full range included",
};

/**
 * Read one filter state out of a URL.
 *
 * Unknown and empty parameters are dropped rather than rejected: a filter
 * URL is meant to be edited by hand and shared, so a stale axis name in one
 * should narrow nothing rather than produce an error page.
 *
 * @param {URLSearchParams} params Query parameters of the request.
 * @returns {object} The filter state the rest of this module works from.
 */
export function parseFilters(params) {
  const list = (key) =>
    params
      .getAll(key)
      .map((value) => value.trim())
      .filter((value) => value !== "");

  const type = list("type").slice(0, 1);
  const selectedType = type[0] ?? null;
  const grid = selectedType === "grid";
  const dust = selectedType === "dust_grid";
  const instrument = selectedType === "instrument";
  const requestedSort = (params.get("sort") ?? "").trim();
  const sortable = new Set([
    "name",
    "model",
    "reprocessed",
    "spectra",
    "lines",
    "emission",
    "wavelengths",
    "axes",
    "size",
    "type",
    "published",
    "instrument_type",
    "filters",
    "resolving_power",
    "psf",
    "noise",
    "depth",
  ]);
  const axes = [];
  for (const name of new Set(list("axis"))) {
    axes.push({
      name,
      min: number(params.get(`min.${name}`)),
      max: number(params.get(`max.${name}`)),
      mode: params.get(`mode.${name}`) === "contain" ? "contain" : "overlap",
    });
  }

  return {
    q: (params.get("q") ?? "").trim(),
    sort:
      sortable.has(requestedSort) || requestedSort.startsWith("axis.")
        ? requestedSort
        : "",
    direction: params.get("direction") === "desc" ? "desc" : "asc",
    // Which facet groups are showing all of their values. Presentational,
    // but it lives here with everything else the rail remembers, so that
    // expanding a list survives a filter change and a page reload alike.
    more: list("more"),
    open: list("open"),
    kind: grid
      ? list("kind").filter((v) => v === "sps" || v === "agn")
      : [],
    model: grid ? list("model") : [],
    emission: grid || dust ? list("emission") : [],
    content:
      grid || dust
        ? list("content").filter((v) => v === "spectra" || v === "lines")
        : [],
    type,
    size: list("size").filter((value) =>
      SIZE_BUCKETS.some((bucket) => bucket.value === value),
    ),
    capability: instrument
      ? list("capability").filter(
          (v) => v === "psf" || v === "noise" || v === "depth",
        )
      : [],
    axes:
      grid || dust
        ? axes.sort((a, b) => a.name.localeCompare(b.name))
        : [],
  };
}

/**
 * Render a filter state back into a query string.
 *
 * Used for every link that changes one filter, so removing an axis or
 * clearing a facet is an ordinary href that works without JavaScript.
 *
 * @param {object} filters Filter state.
 * @param {object} changes Keys to replace before rendering.
 * @returns {string} Query string, including its leading `?`, or "".
 */
export function toQuery(filters, changes = {}) {
  const state = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (state.q !== "") {
    params.set("q", state.q);
  }
  if (state.sort !== "") {
    params.set("sort", state.sort);
    params.set("direction", state.direction);
  }
  for (const key of [
    "more",
    "open",
    "kind",
    "model",
    "emission",
    "content",
    "type",
    "size",
    "capability",
  ]) {
    for (const value of state[key] ?? []) {
      params.append(key, value);
    }
  }
  for (const axis of state.axes ?? []) {
    params.append("axis", axis.name);
    if (axis.min !== null) {
      params.set(`min.${axis.name}`, String(axis.min));
    }
    if (axis.max !== null) {
      params.set(`max.${axis.name}`, String(axis.max));
    }
    if (axis.mode === "contain") {
      params.set(`mode.${axis.name}`, "contain");
    }
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * True when any filter is narrowing the results.
 *
 * @param {object} filters Filter state.
 * @returns {boolean} Whether anything is active.
 */
export function isFiltered(filters) {
  return (
    filters.q !== "" ||
    filters.axes.length > 0 ||
    [
      "kind",
      "model",
      "emission",
      "content",
      "type",
      "size",
      "capability",
    ].some((key) => filters[key].length > 0)
  );
}

/**
 * Parse a number from a query parameter.
 *
 * @param {string | null} value Raw parameter value.
 * @returns {number | null} The number, or null when absent or unparseable.
 */
function number(value) {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build a LIKE pattern that treats its input as literal text.
 *
 * Without this a search for `1e-5_z` would match on the underscore as a
 * wildcard, which is baffling rather than useful.
 *
 * @param {string} text Search text.
 * @returns {string} Pattern for use with `LIKE ? ESCAPE '\'`.
 */
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Build the WHERE clauses one filter state implies.
 *
 * Each clause records the facet group it came from, so a facet count can be
 * computed with every filter except its own applied: the counts beside
 * "BPASS" and "FSPS" are then how many grids each *would* return, which is
 * the only reading under which clicking a second model makes sense.
 *
 * @param {object} filters Filter state.
 * @returns {Array<{group: string, sql: string, params: unknown[]}>} Clauses.
 */
function clausesFor(filters) {
  const clauses = [];

  if (filters.q !== "") {
    const pattern = likePattern(filters.q);
    clauses.push({
      group: "q",
      sql:
        "(d.name LIKE ? ESCAPE '\\' OR d.display_name LIKE ? ESCAPE '\\'" +
        " OR d.description LIKE ? ESCAPE '\\' OR d.data_type LIKE ? ESCAPE '\\'" +
        " OR f.filename LIKE ? ESCAPE '\\' OR f.format LIKE ? ESCAPE '\\')",
      params: [pattern, pattern, pattern, pattern, pattern, pattern],
    });
  }

  if (filters.kind.length > 0) {
    clauses.push({
      group: "kind",
      sql: `g.grid_type IN (${filters.kind.map(() => "?").join(", ")})`,
      params: filters.kind,
    });
  }

  if (filters.model.length > 0) {
    clauses.push({
      group: "model",
      sql: `g.model_name IN (${filters.model.map(() => "?").join(", ")})`,
      params: filters.model,
    });
  }

  if (filters.emission.length > 0) {
    clauses.push({
      group: "emission",
      sql: `g.emission_type IN (${filters.emission
        .map(() => "?")
        .join(", ")})`,
      params: filters.emission,
    });
  }

  for (const kind of filters.content) {
    clauses.push({
      group: "content",
      sql: kind === "spectra" ? "g.has_spectra = 1" : "g.has_lines = 1",
      params: [],
    });
  }

  if (filters.type.length > 0) {
    clauses.push({
      group: "type",
      sql: `d.data_type IN (${filters.type.map(() => "?").join(", ")})`,
      params: filters.type,
    });
  }

  if (filters.size.length > 0) {
    const buckets = SIZE_BUCKETS.filter((bucket) =>
      filters.size.includes(bucket.value),
    );
    clauses.push({
      group: "size",
      sql: `(${buckets.map((bucket) => `(${bucket.sql})`).join(" OR ")})`,
      params: [],
    });
  }

  for (const capability of filters.capability) {
    clauses.push({
      group: "capability",
      sql: {
        psf: "i.psfs_json IS NOT NULL",
        noise: "i.noise_maps_json IS NOT NULL",
        depth: "i.depth_json IS NOT NULL",
        tags: "(r.known_bug * 8 + d.is_recommended * 4 + d.is_test * 2 + d.is_ci)",
      }[capability],
      params: [],
    });
  }

  for (const axis of filters.axes) {
    clauses.push(axisClause(axis));
  }

  return clauses;
}

/**
 * Build the EXISTS clause for one axis filter.
 *
 * Adding an axis at all filters to grids that have it, which is useful on
 * its own: `spins` finds the five RELAGN grids and nothing else. A range
 * then narrows that, either way round:
 *
 *     Any overlap           gmin <= qmax AND gmax >= qmin
 *     Full range included   gmin <= qmin AND gmax >= qmax
 *
 * An omitted bound drops its own condition, so filling in one box asks a
 * one-sided question rather than an impossible one. `grid_axes` holds around
 * 400 rows, so this needs no index of its own.
 *
 * @param {{name: string, min: number|null, max: number|null, mode: string}}
 *     axis One axis filter.
 * @returns {{group: string, sql: string, params: unknown[]}} The clause.
 */
function axisClause(axis) {
  const scale = AXIS_UNITS[axis.name]?.scale;
  const minimum = scale === undefined ? "a.minimum" : `(a.minimum * ${scale})`;
  const maximum = scale === undefined ? "a.maximum" : `(a.maximum * ${scale})`;

  const conditions = [];
  const params = [axis.name];
  if (axis.mode === "contain") {
    if (axis.min !== null) {
      conditions.push(`${minimum} <= ?`);
      params.push(axis.min);
    }
    if (axis.max !== null) {
      conditions.push(`${maximum} >= ?`);
      params.push(axis.max);
    }
  } else {
    if (axis.max !== null) {
      conditions.push(`${minimum} <= ?`);
      params.push(axis.max);
    }
    if (axis.min !== null) {
      conditions.push(`${maximum} >= ?`);
      params.push(axis.min);
    }
  }

  return {
    group: `axis.${axis.name}`,
    sql: `EXISTS (SELECT 1 FROM grid_axes a
                  WHERE a.release_id = r.release_id AND a.name = ?
                        ${conditions.map((c) => `AND ${c}`).join(" ")})`,
    params,
  };
}

/**
 * Assemble a WHERE clause, optionally leaving one facet group out.
 *
 * @param {Array<{group: string, sql: string, params: unknown[]}>} clauses
 *     Clauses from `clausesFor`.
 * @param {string} [without] Group to omit, for facet counting.
 * @returns {{sql: string, params: unknown[]}} SQL and bound parameters.
 */
function where(clauses, without) {
  const used = clauses.filter((clause) => clause.group !== without);
  return {
    sql:
      used.length === 0
        ? "1 = 1"
        : used.map((clause) => clause.sql).join("\n  AND "),
    params: used.flatMap((clause) => clause.params),
  };
}

/** Joins every catalogue query shares. A dataset without a current release is
 *  unpublished and appears nowhere. */
const FROM = `FROM datasets d
  JOIN releases r ON r.release_id = d.current_release_id
  JOIN files f ON f.file_id = r.file_id
  LEFT JOIN grid_metadata g ON g.release_id = r.release_id
  LEFT JOIN instruments i ON i.release_id = r.release_id`;

const COLUMNS = `d.name, d.display_name, d.description, d.data_type,
  d.is_test, d.is_ci,
  d.is_recommended, r.release_id, r.published_at, r.known_bug,
  f.filename, f.size_bytes, f.format,
  g.grid_type, g.emission_type, g.model_name, g.has_spectra, g.has_lines,
  g.wavelength_min, g.wavelength_max, g.wavelength_units,
  g.photoionisation_code, g.photoionisation_code_version,
  i.instrument_type, i.filter_codes_json, i.resolving_power,
  i.psfs_json, i.noise_maps_json, i.depth_json`;

/** Safe ORDER BY expression for one user-visible column. */
function ordering(filters) {
  if (filters.sort.startsWith("axis.")) {
    return {
      sql: `(SELECT a.minimum FROM grid_axes a
             WHERE a.release_id = r.release_id AND a.name = ?)`,
      params: [filters.sort.slice(5)],
    };
  }
  return {
    sql:
      {
        name: "d.name",
        model: "g.model_name",
        reprocessed: "g.emission_type = 'photoionised'",
        spectra: "g.has_spectra",
        lines: "g.has_lines",
        emission: "g.emission_type",
        wavelengths: "g.wavelength_min",
        axes: "(SELECT COUNT(*) FROM grid_axes a WHERE a.release_id = r.release_id)",
        size: "f.size_bytes",
        type: "d.data_type",
        published: "r.published_at",
        instrument_type: "i.instrument_type",
        filters: "json_array_length(i.filter_codes_json)",
        resolving_power: "i.resolving_power",
        psf: "i.psfs_json IS NOT NULL",
        noise: "i.noise_maps_json IS NOT NULL",
        depth: "i.depth_json IS NOT NULL",
      }[filters.sort] ?? "d.name",
    params: [],
  };
}

/**
 * Facets that are flags on a row rather than values of a column.
 *
 * These are the questions a table column answers yes or no to, so each one
 * is counted on its own instead of being grouped.
 */
const FLAG_FACETS = {
  grids: {
    group: "content",
    values: [
      ["spectra", "g.has_spectra = 1"],
      ["lines", "g.has_lines = 1"],
    ],
  },
  dust: {
    group: "content",
    values: [
      ["spectra", "g.has_spectra = 1"],
      ["lines", "g.has_lines = 1"],
    ],
  },
  instruments: {
    group: "capability",
    values: [
      ["psf", "i.psfs_json IS NOT NULL"],
      ["noise", "i.noise_maps_json IS NOT NULL"],
      ["depth", "i.depth_json IS NOT NULL"],
    ],
  },
  search: { group: "flags", values: [] },
};

/**
 * Count the datasets each tab holds.
 *
 * @param {D1Database} db Catalogue database.
 * @returns {Promise<Record<string, number>>} Counts keyed by tab id.
 */
export async function tabCounts(db) {
  const { results } = await db
    .prepare(
      `SELECT d.data_type, COUNT(*) AS n
       FROM datasets d
       JOIN releases r ON r.release_id = d.current_release_id
       GROUP BY d.data_type`,
    )
    .all();

  const counts = Object.fromEntries(TABS.map((tab) => [tab.id, 0]));
  for (const row of results) {
    counts.search += row.n;
    const tab = TABS.find((candidate) => candidate.types?.includes(row.data_type));
    if (tab !== undefined) {
      counts[tab.id] += row.n;
    }
  }
  return counts;
}

/**
 * Run one catalogue search: its rows, its total, and its facet counts.
 *
 * Everything is issued as a single D1 batch, so a page costs one round trip
 * to the database however many facets it draws.
 *
 * @param {D1Database} db Catalogue database.
 * @param {object} tab One entry from `TABS`.
 * @param {object} filters Filter state from `parseFilters`.
 * @returns {Promise<object>} Rows, total, facet counts and axis columns.
 */
export async function search(db, tab, filters) {
  const clauses = clausesFor(filters);
  const all = where(clauses);
  const order = ordering(filters);

  // Only the facets this view actually draws are counted. A facet of one value
  // narrows nothing, so the instruments tab has none: every instrument in
  // the catalogue is a photometric imager, and its rail asks about what the
  // instrument carries instead.
  const specialistGroups = {
    grids: [
      // Stellar or AGN is the first cut anyone makes, so it leads the rail.
      ["kind", "g.grid_type"],
      ["model", "g.model_name"],
      ["emission", "g.emission_type"],
    ],
    dust: [["emission", "g.emission_type"]],
    instruments: [],
    search: [],
  }[tab.id];
  const facetGroups = [["type", "d.data_type"], ...specialistGroups];

  const statements = [
    db
      .prepare(
        `SELECT ${COLUMNS}
         ${FROM}
         WHERE ${all.sql}
         ORDER BY ${order.sql} ${filters.direction.toUpperCase()}, d.name ASC`,
      )
      .bind(...all.params, ...order.params),
  ];

  for (const [group, column] of facetGroups) {
    // Type choices should remain available when a specialist filter is
    // active; choosing one safely drops those specialist filters.
    const scoped =
      group === "type"
        ? where(
            clauses.filter(
              (clause) => clause.group === "q" || clause.group === "size",
            ),
          )
        : where(clauses, group);
    statements.push(
      db
        .prepare(
          `SELECT ${column} AS value, COUNT(*) AS n
           ${FROM}
           WHERE ${scoped.sql} AND ${column} IS NOT NULL
           GROUP BY value
           ORDER BY n DESC, value`,
        )
        .bind(...scoped.params),
    );
  }

  const unsized = where(clauses, "size");
  for (const bucket of SIZE_BUCKETS) {
    statements.push(
      db
        .prepare(
          `SELECT COUNT(*) AS n ${FROM} WHERE ${unsized.sql} AND (${bucket.sql})`,
        )
        .bind(...unsized.params),
    );
  }

  // Flag facets are counted one statement at a time: they are independent
  // questions about the same row, not values of one column.
  const flags = FLAG_FACETS[tab.id];
  const unflagged = where(clauses, flags.group);
  for (const [, condition] of flags.values) {
    statements.push(
      db
        .prepare(
          `SELECT COUNT(*) AS n ${FROM} WHERE ${unflagged.sql} AND ${condition}`,
        )
        .bind(...unflagged.params),
    );
  }

  // Axes available to add, counted against every active filter so that an
  // axis returning nothing is never offered. Ten of the twelve grid axes
  // appear on 13 grids or fewer, which is why the picker is a list of what
  // exists rather than a panel of every axis there could be.
  const hasAxes = tab.id === "grids" || tab.id === "dust";
  if (hasAxes) {
    statements.push(
      db
        .prepare(
          `SELECT x.name AS value, COUNT(DISTINCT r.release_id) AS n,
                  GROUP_CONCAT(DISTINCT x.units) AS units
           FROM grid_axes x
           JOIN releases r ON r.release_id = x.release_id
           JOIN datasets d ON d.dataset_id = r.dataset_id
             AND d.current_release_id = r.release_id
           JOIN files f ON f.file_id = r.file_id
           LEFT JOIN grid_metadata g ON g.release_id = r.release_id
           LEFT JOIN instruments i ON i.release_id = r.release_id
           WHERE ${all.sql}
           GROUP BY x.name
           ORDER BY n DESC, x.name`,
        )
        .bind(...all.params),
    );
    statements.push(
      db
        .prepare(
          `SELECT a.release_id, a.name, a.units, a.scale, a.count,
                  a.minimum, a.maximum
           FROM grid_axes a
           JOIN releases r ON r.release_id = a.release_id
           JOIN datasets d ON d.dataset_id = r.dataset_id
             AND d.current_release_id = r.release_id
           JOIN files f ON f.file_id = r.file_id
           LEFT JOIN grid_metadata g ON g.release_id = r.release_id
           LEFT JOIN instruments i ON i.release_id = r.release_id
           WHERE ${all.sql}
           ORDER BY a.axis_index`,
        )
        .bind(...all.params),
    );
  }

  const batch = await db.batch(statements);
  const rows = batch[0].results;

  const facets = {};
  let at = 1;
  for (const [group] of facetGroups) {
    facets[group] = batch[at++].results;
  }
  facets.size = SIZE_BUCKETS.map((bucket) => ({
    value: bucket.value,
    n: batch[at++].results[0]?.n ?? 0,
  }));
  facets[flags.group] = flags.values.map(([value]) => ({
    value,
    n: batch[at++].results[0]?.n ?? 0,
  }));
  facets.axes = hasAxes ? batch[at++].results : [];
  const axes = hasAxes ? byRelease(batch[at].results) : new Map();

  return {
    rows,
    total: rows.length,
    facets,
    axes,
  };
}

/**
 * Group axis rows by the release they belong to.
 *
 * The table shows a column for each axis in the filter, plus the age and
 * metallicity ranges, so the axes come back as one statement per tab and are
 * grouped here rather than as a correlated subquery per column. The whole
 * catalogue holds around 400 axis rows, which is why this can afford to read
 * a tab's worth of them and pick out the releases it needs.
 *
 * @param {Array<object>} results Axis rows.
 * @returns {Map<number, Record<string, object>>} Axes by release.
 */
function byRelease(results) {
  const axes = new Map();
  for (const axis of results) {
    if (!axes.has(axis.release_id)) {
      axes.set(axis.release_id, {});
    }
    axes.get(axis.release_id)[axis.name] = axis;
  }
  return axes;
}

/**
 * Fetch everything one dataset page shows.
 *
 * @param {D1Database} db Catalogue database.
 * @param {string} name Stable dataset name.
 * @returns {Promise<object | null>} The dataset, or null when there is none.
 */
export async function dataset(db, name) {
  const row = await db
    .prepare(
      `SELECT d.*, r.release_id, r.published_at, r.deprecated_at,
              r.synthesizer_min_version, r.synthesizer_max_version,
              r.known_bug, r.known_bug_description, r.provenance_json,
              f.file_id, f.filename, f.format, f.size_bytes, f.sha256
       FROM datasets d
       LEFT JOIN releases r ON r.release_id = d.current_release_id
       LEFT JOIN files f ON f.file_id = r.file_id
       WHERE d.name = ?`,
    )
    .bind(name)
    .first();

  if (row === null) {
    return null;
  }

  const [grid, axes, instrument, releases, citations] = await db.batch([
    db
      .prepare("SELECT * FROM grid_metadata WHERE release_id = ?")
      .bind(row.release_id),
    db
      .prepare(
        `SELECT axis_index, name, units, scale, count, minimum, maximum
         FROM grid_axes WHERE release_id = ? ORDER BY axis_index`,
      )
      .bind(row.release_id),
    db
      .prepare("SELECT * FROM instruments WHERE release_id = ?")
      .bind(row.release_id),
    db
      .prepare(
        `SELECT r.release_id, r.published_at, r.known_bug,
                r.known_bug_description, f.size_bytes, f.sha256
         FROM releases r JOIN files f ON f.file_id = r.file_id
         WHERE r.dataset_id = ?
         ORDER BY r.published_at DESC, r.release_id DESC`,
      )
      .bind(row.dataset_id),
    // Citations hang off the file rather than the dataset, because that is
    // what gets cited: the c25.00 grids reference a different Cloudy release
    // from their c23.01 siblings despite sharing a model.
    db
      .prepare(
        `SELECT c.bibcode, c.doi, c.authors, c.title, c.year, c.journal
         FROM file_citations fc
         JOIN citations c ON c.citation_id = fc.citation_id
         WHERE fc.file_id = ? ORDER BY fc.position, c.year`,
      )
      .bind(row.file_id),
  ]);

  const incident = grid.results[0]?.incident_release_id ?? null;
  return {
    ...row,
    grid: grid.results[0] ?? null,
    axes: axes.results,
    instrument: instrument.results[0] ?? null,
    releases: releases.results,
    citations: citations.results,
    // A processed grid names the incident release it came from; the page
    // wants the dataset that release belongs to so it can link to a page
    // rather than to an integer.
    incident:
      incident === null
        ? null
        : await db
            .prepare(
              `SELECT d.name, d.display_name, r.release_id
               FROM releases r JOIN datasets d ON d.dataset_id = r.dataset_id
               WHERE r.release_id = ?`,
            )
            .bind(incident)
            .first(),
  };
}
