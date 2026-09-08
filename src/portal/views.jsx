/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Page shell and shared components.
 *
 * JSX rather than template literals because the submission form echoes user
 * input back, which makes escaping a security property rather than a matter
 * of taste, and because five routes share the shell, the filter rail and the
 * results table. Nothing here runs in the browser.
 */

import {
  AXIS_UNITS,
  MODEL_LABELS,
  RANGE_MODES,
  SIZE_BUCKETS,
  TABS,
  toQuery,
} from "./catalogue.js";

/** Where the portal lives, and where its stylesheet and htmx are served. */
export const BASE = "/syndex";

/**
 * The API's own host.
 *
 * The portal is served from synthesizer-project.org and the API from
 * data.synthesizer-project.org, so a download link has to be absolute: /v1
 * on the portal's host reaches GitHub Pages, not this Worker.
 */
export const DATA_API = "https://data.synthesizer-project.org";

const searchUrl = (filters, changes = {}) =>
  `${BASE}/search${toQuery(filters, changes)}`;

/** Changing type also drops specialist filters that do not apply to it. */
const typeUrl = (filters, type) =>
  searchUrl(filters, {
    type: type === null ? [] : [type],
    kind: [],
    model: [],
    emission: [],
    content: [],
    capability: [],
    axes: [],
    more: [],
    sort: "",
    direction: "asc",
  });

/*
 * One family, one request. The name matters: the org site asks for
 * `Cormorant+Garant`, which is not a Google family, so the response silently
 * omits it. This URL was checked to return the family it names.
 */
const FONTS =
  "https://fonts.googleapis.com/css2" +
  "?family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap";

/**
 * Format a number the way a grid axis is usually written.
 *
 * @param {number | null} value The value.
 * @returns {string} Compact decimal, or exponent notation at the extremes.
 */
export function num(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value === 0) {
    return "0";
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 1e4 || magnitude < 1e-3) {
    const [coefficient, exponent] = value
      .toExponential(2)
      .replace(/\.?0+e/, "e")
      .split("e");
    return `${coefficient === "1" ? "" : `${coefficient}×`}10^${Number(exponent)}`;
  }
  return String(Number(value.toPrecision(4)));
}

/** Render formatter exponent tokens with proper typographic superscripts. */
export const Scientific = ({ children }) =>
  String(children)
    .split(/(10\^-?\d+)/g)
    .map((part) => {
      const exponent = part.match(/^10\^(-?\d+)$/)?.[1];
      return exponent === undefined ? (
        part
      ) : (
        <>
          10<sup class="text-[0.72em] leading-none">{exponent}</sup>
        </>
      );
    });

/**
 * Format a file size in decimal units.
 *
 * @param {number | null} bytes Size in bytes.
 * @returns {string} Human-readable size.
 */
export function size(bytes) {
  if (bytes === null || bytes === undefined) {
    return "—";
  }
  const units = ["B", "kB", "MB", "GB", "TB"];
  let index = 0;
  let value = bytes;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  return `${index === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

/**
 * Format a stored timestamp as a plain date.
 *
 * @param {string | null} timestamp ISO 8601 timestamp.
 * @returns {string} The date part, or an em dash.
 */
export function date(timestamp) {
  return timestamp === null || timestamp === undefined
    ? "—"
    : String(timestamp).slice(0, 10);
}

/**
 * Render an axis range as one cell.
 *
 * @param {object | undefined} axis Axis row for this release.
 * @returns {string} The range, with units, or an em dash.
 */
export function range(axis) {
  if (axis === undefined) {
    return "—";
  }

  // An axis recorded in more than one unit is converted, so that a column of
  // ranges can be read down rather than one row at a time.
  const conversion = AXIS_UNITS[axis.name];
  if (conversion !== undefined) {
    const factor = conversion.factor(axis.units);
    return `${num(axis.minimum * factor)}–${num(
      axis.maximum * factor,
    )} ${conversion.label}`;
  }

  const units =
    axis.units === null || axis.units === "dimensionless" ? "" : ` ${axis.units}`;
  return `${num(axis.minimum)}–${num(axis.maximum)}${units}`;
}

/**
 * Short label for a model name, for use in a narrow rail.
 *
 * @param {string | null} model The model name as the catalogue records it.
 * @returns {string} A label that fits.
 */
export function modelLabel(model) {
  return model === null ? "—" : (MODEL_LABELS[model] ?? model);
}

/** A short, self-describing marker. Never colour alone: the word is the
 *  identity, and the border only groups it. */
export const Badge = ({ children, strong = false }) => (
  <span class={`pill ${strong ? "text-accent-light" : "text-muted"}`}>
    {children}
  </span>
);

/** The badges one dataset row carries. */
export const Badges = ({ row }) => (
  <>
    {row.known_bug === 1 && <Badge strong>known bug</Badge>}
    {row.is_recommended === 1 && <Badge>recommended</Badge>}
    {row.is_test === 1 && <Badge>reduced</Badge>}
    {row.is_ci === 1 && <Badge>CI</Badge>}
  </>
);

/** Compact, accessible value for boolean table columns. */
const Flag = ({ yes, label }) => (
  <span
    class={yes ? "text-accent-light" : "text-muted"}
    title={`${label}: ${yes ? "yes" : "no"}`}
  >
    <span aria-hidden="true">{yes ? "✓" : "×"}</span>
    <span class="sr-only">{yes ? "yes" : "no"}</span>
  </span>
);

const Background = () => (
  <svg
    class="bg-layer"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 1440 900"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
  >
    <circle cx="82" cy="78" r="3.5" fill="white" opacity="0.28" />
    <circle cx="375" cy="155" r="2.5" fill="white" opacity="0.22" />
    <circle cx="638" cy="48" r="4" fill="white" opacity="0.26" />
    <circle cx="935" cy="175" r="2.5" fill="white" opacity="0.20" />
    <circle cx="1160" cy="72" r="3.5" fill="white" opacity="0.24" />
    <circle cx="1385" cy="195" r="2" fill="white" opacity="0.18" />
    <circle cx="195" cy="490" r="3" fill="white" opacity="0.20" />
    <circle cx="58" cy="695" r="4" fill="white" opacity="0.24" />
    <circle cx="415" cy="830" r="2.5" fill="white" opacity="0.20" />
    <circle cx="785" cy="865" r="3" fill="white" opacity="0.18" />
    <circle cx="1110" cy="748" r="3.5" fill="white" opacity="0.22" />
    <circle cx="1340" cy="650" r="2.5" fill="white" opacity="0.20" />
    <circle cx="1425" cy="835" r="2" fill="white" opacity="0.18" />
    <circle cx="575" cy="445" r="2.5" fill="white" opacity="0.16" />
    <circle cx="1240" cy="415" r="3" fill="white" opacity="0.20" />
    <circle cx="862" cy="630" r="2" fill="white" opacity="0.16" />
    <circle cx="42" cy="335" r="2.5" fill="white" opacity="0.18" />
    <circle cx="1065" cy="310" r="2" fill="white" opacity="0.18" />
    <circle cx="705" cy="280" r="2" fill="white" opacity="0.14" />
    <circle cx="1395" cy="440" r="2" fill="white" opacity="0.16" />
    {[
      [148, 142, 10, "0.13"],
      [720, 85, 7, "0.11"],
      [1255, 215, 9, "0.12"],
      [318, 728, 8, "0.10"],
      [1088, 762, 10, "0.11"],
      [545, 195, 6, "0.09"],
      [980, 85, 8, "0.10"],
    ].map(([x, y, scale, opacity]) => (
      <path
        transform={`translate(${x},${y}) scale(${scale})`}
        fill="white"
        opacity={opacity}
        d="M 0,-1 L .1,-.1 L 1,0 L .1,.1 L 0,1 L -.1,.1 L -1,0 L -.1,-.1 Z"
      />
    ))}
  </svg>
);

/**
 * The page shell: fonts, stylesheet, htmx, header, tabs.
 *
 * The tab bar is suppressed on the landing page, which signposts the same
 * four places at full size and does not need to do it twice.
 */
export const Layout = ({
  title,
  counts = null,
  active = null,
  filters = null,
  nav = counts !== null,
  bare = false,
  footer = null,
  showSubmit = true,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Syndex</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link rel="stylesheet" href={FONTS} />
      <link rel="stylesheet" href={`${BASE}/static/app.css`} />
      {/* Vendored and pinned rather than loaded from a CDN, so the portal
          has one origin and one thing that can go down. */}
      <script src={`${BASE}/static/htmx.min.js`} defer></script>
      <script src={`${BASE}/static/filters.js`} defer></script>
    </head>
    <body class="flex min-h-screen flex-col bg-bg text-text">
      <Background />
      {/* There is only something to skip when there is a header above the
          content to skip past. */}
      {!bare && (
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:card focus:px-3 focus:py-2"
        >
          Skip to results
        </a>
      )}
      {/* The landing page carries no header, as the org site's does not:
          it signposts the same places at full size, and a bar above that
          would only say them twice. */}
      {!bare && (
      <header class="relative border-b border-line">
        <div
          class={`flex w-full flex-wrap items-center gap-x-8 gap-y-3 px-6 py-5 ${
            showSubmit ? "pr-48" : ""
          }`}
        >
          <a
            href={BASE}
            class="flex items-center gap-2 text-xl font-medium tracking-tight text-text no-underline"
          >
            <img
              src={`${BASE}/static/syndex_logo_2.png`}
              alt=""
              width="824"
              height="862"
              class="h-9 w-auto"
            />
            Syndex
          </a>
          {nav && (
            <nav
              aria-label="Data types"
              class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
            >
              {TABS.map((tab) => (
                <a
                  href={
                    filters === null
                      ? `${BASE}/search${
                          tab.types === null ? "" : `?type=${tab.types[0]}`
                        }`
                      : typeUrl(filters, tab.types?.[0] ?? null)
                  }
                  aria-current={tab.id === active ? "page" : undefined}
                  class={`flex items-baseline gap-2 border-b-2 pb-1 no-underline transition-colors ${
                    tab.id === active
                      ? "border-accent-light text-text"
                      : "border-transparent text-muted hover:text-text"
                  }`}
                >
                  {tab.label}
                  <span class="text-xs text-muted tabular-nums">
                    {counts[tab.id]}
                  </span>
                </a>
              ))}
            </nav>
          )}
          {showSubmit && (
            <a
              href={`${BASE}/submit`}
              class="btn absolute top-4 right-6 text-xs no-underline"
            >
              Submit a dataset
            </a>
          )}
        </div>
      </header>
      )}
      {bare && (
        <nav
          aria-label="Syndex links"
          class="landing-links flex w-full flex-wrap justify-end gap-2 px-6 pt-6"
        >
          <a
            href="https://synthesizer-project.org/"
            class="rounded-full border border-line bg-surface/70 px-4 py-2 text-xs text-muted no-underline transition-colors hover:border-line-hover hover:text-text"
          >
            Synthesizer project
          </a>
          <a href={`${BASE}/submit`} class="btn text-xs no-underline">
            Submit a dataset
          </a>
        </nav>
      )}
      {/* On the landing page the content is centred in whatever room the
          viewport has, which is what stops a tall screen ending in a field
          of nothing. */}
      <main
        id="main"
        class={
          bare
            ? "mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-12"
            : "mx-auto w-full max-w-7xl px-6 py-8"
        }
      >
        {children}
      </main>
      {!bare && (
        <footer class="mx-auto w-full max-w-7xl px-6 pt-4 pb-12 text-sm text-muted">
          <div class="border-t border-line pt-6">
            Part of{" "}
            <a href="https://synthesizer-project.org/">
              the Synthesizer project
            </a>
            . Files are served from{" "}
            <a href={`${DATA_API}/v1/datasets`}>the catalogue API</a>.
          </div>
        </footer>
      )}
      {bare && footer !== null && (
        <footer class="landing-footer w-full px-6 pb-8 text-center text-sm text-muted">
          {footer}
        </footer>
      )}
    </body>
  </html>
);

/** A command someone is meant to copy. */
export const Command = ({ children }) => (
  <code class="block overflow-x-auto rounded-lg border border-line bg-bg px-4 py-3 text-left font-mono text-sm whitespace-pre-wrap text-text">
    {children}
  </code>
);

/**
 * One facet group of checkboxes, with counts.
 *
 * Counts are of what each value would return given every *other* active
 * filter, which is the only reading under which ticking a second box makes
 * sense.
 *
 * A long list shows its first six and a link to the rest. The link sits
 * after the rows in both states, so opening the list never leaves a control
 * stranded above the values it revealed; a native <details> cannot do that,
 * since its summary has to be its first child. Expansion is a URL parameter
 * like every other thing the rail remembers.
 */
export const Facet = ({
  tab,
  filters,
  legend,
  name,
  values,
  active,
  label = (v) => v,
}) => {
  if (values.length === 0) {
    return null;
  }

  // A value nothing would match is not offered, for the same reason an axis
  // that would return nothing is not: it is a dead end dressed as a choice.
  // One already ticked stays, so unticking it is possible.
  const offered = values.filter(
    (value) => value.n > 0 || active.includes(value.value),
  );
  if (offered.length === 0) {
    return null;
  }

  const expanded = filters.more.includes(name);
  const opened = filters.open.includes(name);
  const visible = expanded ? offered : offered.slice(0, 6);
  const hidden = offered.length - visible.length;
  const toggled = expanded
    ? filters.more.filter((group) => group !== name)
    : [...filters.more, name];
  const href = searchUrl(filters, { more: toggled });

  return (
    <details class="border-0 py-4" data-filter-group={name} open={opened}>
      <summary class="label-caps flex cursor-pointer items-center justify-between">
        <span>{legend}</span>
        {active.length > 0 && <span>{active.length} selected</span>}
      </summary>
      <fieldset class="mt-2 border-0">
      <legend class="sr-only">{legend}</legend>
      <ul class="space-y-0.5 text-sm">
        {visible.map((value) => (
          <li>
            <label
              for={`${name}-${value.value}`}
              class="flex cursor-pointer items-center gap-2 py-0.5"
            >
              <input
                type="checkbox"
                id={`${name}-${value.value}`}
                name={name}
                value={value.value}
                checked={active.includes(value.value)}
              />
              <span class="min-w-0 flex-1 truncate" title={String(value.value)}>
                {label(value.value)}
              </span>
              <span class="text-muted tabular-nums">{value.n}</span>
            </label>
          </li>
        ))}
      </ul>
      {(hidden > 0 || expanded) && (
        <a href={href} hx-get={href} class="mt-1.5 inline-block text-sm">
          {expanded ? "collapse" : `${hidden} more`}{" "}
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </a>
      )}
      {/* So that expanding a list survives ticking a box in it. */}
      {expanded && <input type="hidden" name="more" value={name} />}
      {opened && (
        <input type="hidden" name="open" value={name} data-filter-open="" />
      )}
      </fieldset>
    </details>
  );
};

/** Single-select data type. Links can clear stale specialist filters safely. */
const TypeFacet = ({ filters, values }) => {
  const opened = filters.open.includes("type");
  return (
  <details class="py-4" data-filter-group="type" open={opened}>
    <summary class="label-caps flex cursor-pointer items-center justify-between">
      <span>Data type</span>
      {filters.type.length > 0 && (
        <span>{filters.type[0].replace(/_/g, " ")}</span>
      )}
    </summary>
    <ul class="mt-2 space-y-0.5 text-sm">
      <li>
        <a
          href={typeUrl(filters, null)}
          hx-get={typeUrl(filters, null)}
          class={filters.type.length === 0 ? "text-text" : "text-muted"}
        >
          All data
        </a>
      </li>
      {values.map((value) => (
        <li class="flex items-center gap-2 py-0.5">
          <a
            href={typeUrl(filters, value.value)}
            hx-get={typeUrl(filters, value.value)}
            aria-current={filters.type[0] === value.value ? "true" : undefined}
            class={`min-w-0 flex-1 truncate ${
              filters.type[0] === value.value ? "text-text" : "text-muted"
            }`}
            title={String(value.value)}
          >
            {value.value.replace(/_/g, " ")}
          </a>
          <span class="text-muted tabular-nums">{value.n}</span>
        </li>
      ))}
    </ul>
    {opened && (
      <input type="hidden" name="open" value="type" data-filter-open="" />
    )}
  </details>
  );
};

/**
 * One added axis: its range inputs and how the range should match.
 *
 * Adding the axis at all is already a filter, for grids that have it. The
 * range narrows that further, and the toggle decides whether a grid has to
 * cover some of the requested range or all of it.
 */
const AxisFilter = ({ tab, filters, axis, units }) => {
  const label = AXIS_UNITS[axis.name]?.label ?? units;
  const removed = filters.axes.filter((other) => other.name !== axis.name);
  const group = `range.${axis.name}`;
  const opened = filters.open.includes(group);
  return (
    <div class="border-b border-dim py-2 last:border-0">
      <div class="flex items-baseline gap-2">
        <span class="flex-1 font-mono text-sm">{axis.name}</span>
        <a
          href={searchUrl(filters, {
            axes: removed,
            sort: filters.sort === `axis.${axis.name}` ? "" : filters.sort,
          })}
          hx-get={searchUrl(filters, {
            axes: removed,
            sort: filters.sort === `axis.${axis.name}` ? "" : filters.sort,
          })}
          class="text-sm"
          aria-label={`Remove the ${axis.name} filter`}
        >
          remove
        </a>
      </div>
      <input type="hidden" name="axis" value={axis.name} />
      <details
        class="mt-1"
        data-filter-group={group}
        open={opened}
      >
        <summary class="flex cursor-pointer items-center text-xs text-muted">
          Select range
        </summary>
        <div class="mt-2 flex items-center gap-2 text-sm">
          <label class="flex-1">
            <span class="block text-xs text-muted">
              min{label ? ` (${label})` : ""}
            </span>
            <input
              type="number"
              step="any"
              id={`min-${axis.name}`}
              name={`min.${axis.name}`}
              value={axis.min === null ? "" : String(axis.min)}
              class="w-full rounded-lg border border-muted bg-bg px-2 py-1"
            />
          </label>
          <label class="flex-1">
            <span class="block text-xs text-muted">
              max{label ? ` (${label})` : ""}
            </span>
            <input
              type="number"
              step="any"
              id={`max-${axis.name}`}
              name={`max.${axis.name}`}
              value={axis.max === null ? "" : String(axis.max)}
              class="w-full rounded-lg border border-muted bg-bg px-2 py-1"
            />
          </label>
        </div>
        <fieldset class="mt-2 border-0">
          <legend class="text-xs text-muted">Match</legend>
          {Object.entries(RANGE_MODES).map(([mode, description]) => (
            <label class="flex items-center gap-2 text-sm">
              <input
                type="radio"
                id={`mode-${axis.name}-${mode}`}
                name={`mode.${axis.name}`}
                value={mode}
                checked={axis.mode === mode}
              />
              {description}
            </label>
          ))}
        </fieldset>
        {opened && (
          <input type="hidden" name="open" value={group} data-filter-open="" />
        )}
      </details>
    </div>
  );
};

/**
 * The axis filter, which starts empty and is added to.
 *
 * Ten of the twelve grid axes appear on 13 grids or fewer, so a fixed panel
 * of every axis would be mostly irrelevant rows. The picker offers only axes
 * that exist under the current filters, with the number of grids each would
 * leave, so an axis that would return nothing is never offered.
 */
const AxisPicker = ({ tab, filters, facets }) => {
  const active = new Set(filters.axes.map((axis) => axis.name));
  const available = facets.axes.filter((axis) => !active.has(axis.value));
  const units = Object.fromEntries(
    facets.axes.map((axis) => [
      axis.value,
      // One axis with two spellings of its units cannot label an input, so
      // it says nothing rather than something wrong.
      (axis.units ?? "").includes(",") || axis.units === "dimensionless"
        ? ""
        : (axis.units ?? ""),
    ]),
  );
  const opened = filters.open.includes("axes");

  return (
    <details class="py-4" data-filter-group="axes" open={opened}>
      <summary class="label-caps flex cursor-pointer items-center justify-between">
        <span>Axes</span>
        {filters.axes.length > 0 && <span>{filters.axes.length} selected</span>}
      </summary>
      <fieldset class="mt-2 border-0">
      <legend class="sr-only">Axes</legend>
      {filters.axes.map((axis) => (
        <AxisFilter
          tab={tab}
          filters={filters}
          axis={axis}
          units={units[axis.name] ?? ""}
        />
      ))}
      {available.length > 0 && (
        <label for="add-axis" class="block pt-2 text-sm">
          <span class="sr-only">Add an axis</span>
          <select
            id="add-axis"
            name="axis"
            class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
          >
            <option value="">Axes</option>
            {available.map((axis) => (
              <option value={axis.value}>
                {axis.value} ({axis.n})
              </option>
            ))}
          </select>
        </label>
      )}
      {opened && (
        <input type="hidden" name="open" value="axes" data-filter-open="" />
      )}
      </fieldset>
    </details>
  );
};

/** The filter rail: a labelled sheet on narrow screens, a column on wide. */
const FilterRail = ({ tab, filters, facets }) => (
  <div data-filter-column="" class="mb-4 lg:mb-0">
    <button
      type="button"
      data-bulk-command=""
      class="btn mb-3 w-full"
      hidden
    >
      Get download command (<span data-selection-count="">0</span>)
    </button>
  <details class="filter-sheet card p-5" open>
    <summary class="label-caps cursor-pointer">Filters</summary>
    <form
      id="filters"
      method="get"
      action={`${BASE}/search`}
      hx-get={`${BASE}/search`}
      hx-trigger="change, submit"
      class="mt-4 flex flex-col divide-y divide-line"
    >
      <div class="pb-4">
        <label for="q" class="block text-sm">
          <span class="label-caps mb-1 block">Search</span>
          <input
            type="search"
            id="q"
            name="q"
            value={filters.q}
            placeholder="name or description"
            class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
          />
        </label>
        <button type="submit" class="btn mt-2 w-full">
          Search
        </button>
      </div>

      {filters.type.length > 0 && (
        <input type="hidden" name="type" value={filters.type[0]} />
      )}
      {filters.sort !== "" && (
        <>
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="direction" value={filters.direction} />
        </>
      )}

      <TypeFacet filters={filters} values={facets.type} />
      <Facet
        tab={tab}
        filters={filters}
        legend="File size"
        name="size"
        values={facets.size}
        active={filters.size}
        label={(value) =>
          SIZE_BUCKETS.find((bucket) => bucket.value === value)?.label ?? value
        }
      />

      {tab.id === "grids" && (
        <Facet
          tab={tab}
          filters={filters}
          legend="Kind"
          name="kind"
          values={facets.kind}
          active={filters.kind}
          label={(value) => (value === "agn" ? "AGN" : "stellar")}
        />
      )}
      {tab.id === "grids" && (
        <Facet
          tab={tab}
          filters={filters}
          legend="Model"
          name="model"
          values={facets.model}
          active={filters.model}
          label={modelLabel}
        />
      )}
      {(tab.id === "grids" || tab.id === "dust") && (
        <Facet
          tab={tab}
          filters={filters}
          legend="Emission"
          name="emission"
          values={facets.emission}
          active={filters.emission}
          label={(value) => value.replace(/_/g, " ")}
        />
      )}
      {(tab.id === "grids" || tab.id === "dust") && (
        <Facet
          tab={tab}
          filters={filters}
          legend="Content"
          name="content"
          values={facets.content}
          active={filters.content}
          label={(value) => `has ${value}`}
        />
      )}
      {tab.id === "instruments" && (
        <Facet
          tab={tab}
          filters={filters}
          legend="Carries"
          name="capability"
          values={facets.capability}
          active={filters.capability}
          label={(value) => ({ psf: "PSFs", noise: "noise maps", depth: "depths" })[value]}
        />
      )}
      {(tab.id === "grids" || tab.id === "dust") && (
        <AxisPicker tab={tab} filters={filters} facets={facets} />
      )}

    </form>
  </details>
  </div>
);

/**
 * What a chip for one active filter says.
 *
 * @param {string} key The facet group.
 * @param {string} value The active value.
 * @returns {string} The label to show on the chip.
 */
function chipLabel(key, value) {
  if (key === "size") {
    return SIZE_BUCKETS.find((bucket) => bucket.value === value)?.label ?? value;
  }
  if (key === "model") {
    return modelLabel(value);
  }
  if (key === "kind") {
    return value === "agn" ? "AGN" : "stellar";
  }
  return String(value).replace(/_/g, " ");
}

/** The chips above the table, each removing one active filter. */
const ActiveFilters = ({ tab, filters, total, noun }) => {
  const chips = [];
  const chip = (label, changes) =>
    chips.push(
      <a
        href={searchUrl(filters, changes)}
        hx-get={searchUrl(filters, changes)}
        class="pill text-muted no-underline normal-case hover:border-line-hover hover:text-text"
      >
        {label} <span aria-hidden="true">×</span>
        <span class="sr-only">(remove this filter)</span>
      </a>,
    );

  if (filters.q !== "") {
    chip(`“${filters.q}”`, { q: "" });
  }
  for (const key of [
    "kind",
    "model",
    "emission",
    "content",
    "type",
    "size",
    "capability",
  ]) {
    for (const value of filters[key]) {
      chip(chipLabel(key, value), {
        ...(key === "type"
          ? {
              type: [],
              kind: [],
              model: [],
              emission: [],
              content: [],
              capability: [],
              axes: [],
              more: [],
            }
          : { [key]: filters[key].filter((other) => other !== value) }),
      });
    }
  }
  for (const axis of filters.axes) {
    chip(axis.name, {
      axes: filters.axes.filter((other) => other.name !== axis.name),
    });
  }

  return (
    <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p aria-live="polite" class="text-lg tabular-nums">
        {total} {noun}
        {total === 1 ? "" : "s"}
      </p>
      {chips}
      {chips.length > 0 && (
        <a href={`${BASE}/search`} hx-get={`${BASE}/search`} class="text-sm">
          clear all
        </a>
      )}
      <span id="busy" class="text-sm text-muted" role="status">
        searching…
      </span>
    </div>
  );
};

/** A dataset name, linking to its page. */
const Name = ({ row }) => (
  <div class="min-w-[12rem]">
    <a
      href={`${BASE}/datasets/${encodeURIComponent(row.name)}`}
      class="block max-w-[12rem] truncate no-underline hover:underline"
      title={row.name}
    >
      {row.name}
    </a>
  </div>
);

/**
 * A column for each axis in the filter that is not already a column.
 *
 * "Show a column for what you filtered on" is one rule and less code than a
 * column picker, which would make someone configure their columns separately
 * from their filters. Ages and metallicities are shown either way, so
 * filtering on one adds nothing to add.
 *
 * @param {object} filters Filter state.
 * @param {string[]} already Axes the tab already has a column for.
 * @returns {object[]} Column definitions.
 */
function axisColumns(filters, already) {
  return filters.axes
    .filter((axis) => !already.includes(axis.name))
    .map((axis) => ({
      label: axis.name,
      cell: (row, axes) => <Scientific>{range(axes?.[axis.name])}</Scientific>,
      numeric: true,
      sort: `axis.${axis.name}`,
      present: (row, axes) => axes?.[axis.name] !== undefined,
    }));
}

/**
 * Columns each tab shows.
 *
 * A column for every axis in the filter is appended to the grid tabs, which
 * is one rule and less code than a column picker: someone who filters on
 * spins wants to see the spins.
 */
function columnsFor(tab, filters, rows, axesByRelease) {
  const populated = (columns) =>
    columns.filter(
      (column) =>
        column !== null &&
        (column.present === undefined ||
          rows.some((row) =>
            column.present(row, axesByRelease.get(row.release_id)),
          )),
    );
  const wavelengths = {
    label: "wavelengths",
    sort: "wavelengths",
    cell: (row) => (
      <Scientific>
        {row.wavelength_min === null
          ? "—"
          : `${num(row.wavelength_min)}–${num(row.wavelength_max)} ${
              row.wavelength_units ?? ""
            }`}
      </Scientific>
    ),
    present: (row) => row.wavelength_min !== null,
  };
  const fileSize = {
    label: "size",
    cell: (row) => size(row.size_bytes),
    numeric: true,
    sort: "size",
  };
  const tags = rows.some(
    (row) =>
      row.known_bug === 1 ||
      row.is_recommended === 1 ||
      row.is_test === 1 ||
      row.is_ci === 1,
  )
    ? {
        label: "tags",
        cell: (row) => (
          <div class="flex flex-wrap gap-1">
            <Badges row={row} />
          </div>
        ),
      }
    : null;
  const photoionised = {
    label: "reprocessed",
    sort: "reprocessed",
    cell: (row) => (
      <Flag yes={row.emission_type === "photoionised"} label="Reprocessed" />
    ),
    present: (row) => row.emission_type !== null,
  };

  if (tab.id === "grids") {
    return populated([
      { label: "name", cell: (row) => <Name row={row} />, sort: "name" },
      {
        label: "model",
        cell: (row) => modelLabel(row.model_name),
        sort: "model",
        present: (row) => row.model_name !== null,
      },
      fileSize,
      photoionised,
      {
        label: "spectra",
        sort: "spectra",
        cell: (row) => <Flag yes={row.has_spectra === 1} label="Spectra" />,
      },
      {
        label: "lines",
        sort: "lines",
        cell: (row) => <Flag yes={row.has_lines === 1} label="Lines" />,
      },
      {
        label: "ages",
        cell: (row, axes) => <Scientific>{range(axes?.ages)}</Scientific>,
        numeric: true,
        sort: "axis.ages",
        present: (row, axes) => axes?.ages !== undefined,
      },
      {
        label: "metallicities",
        cell: (row, axes) => <Scientific>{range(axes?.metallicities)}</Scientific>,
        numeric: true,
        sort: "axis.metallicities",
        present: (row, axes) => axes?.metallicities !== undefined,
      },
      wavelengths,
      ...axisColumns(filters, ["ages", "metallicities"]),
      tags,
    ]);
  }

  if (tab.id === "dust") {
    return populated([
      { label: "name", cell: (row) => <Name row={row} />, sort: "name" },
      {
        label: "emission",
        cell: (row) => (row.emission_type ?? "—").replace(/^dust_/, "").replace(/_/g, " "),
        sort: "emission",
        present: (row) => row.emission_type !== null,
      },
      fileSize,
      {
        label: "spectra",
        sort: "spectra",
        cell: (row) => <Flag yes={row.has_spectra === 1} label="Spectra" />,
      },
      {
        label: "lines",
        sort: "lines",
        cell: (row) => <Flag yes={row.has_lines === 1} label="Lines" />,
      },
      {
        label: "model",
        cell: (row) => modelLabel(row.model_name),
        sort: "model",
        present: (row) => row.model_name !== null,
      },
      {
        label: "axes",
        cell: (row, axes) => Object.keys(axes ?? {}).join(", ") || "—",
        sort: "axes",
        present: (row, axes) => Object.keys(axes ?? {}).length > 0,
      },
      wavelengths,
      ...axisColumns(filters, []),
      tags,
    ]);
  }

  if (tab.id === "instruments") {
    const count = (json) => {
      try {
        const parsed = JSON.parse(json ?? "[]");
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        // A column that will not decode is a publication bug; it should not
        // take the whole tab down with it.
        return 0;
      }
    };
    return populated([
      { label: "name", cell: (row) => <Name row={row} />, sort: "name" },
      {
        label: "type",
        cell: (row) => (row.instrument_type ?? "—").replace(/_/g, " "),
        sort: "instrument_type",
        present: (row) => row.instrument_type !== null,
      },
      fileSize,
      {
        label: "filters",
        cell: (row) => <Scientific>{num(count(row.filter_codes_json))}</Scientific>,
        numeric: true,
        sort: "filters",
        present: (row) => count(row.filter_codes_json) > 0,
      },
      {
        label: "resolving power",
        cell: (row) => <Scientific>{num(row.resolving_power)}</Scientific>,
        numeric: true,
        sort: "resolving_power",
        present: (row) => row.resolving_power !== null,
      },
      {
        label: "PSF",
        cell: (row) => <Flag yes={row.psfs_json !== null} label="PSF" />,
        sort: "psf",
        present: (row) => row.psfs_json !== null,
      },
      {
        label: "noise",
        cell: (row) => <Flag yes={row.noise_maps_json !== null} label="Noise" />,
        sort: "noise",
        present: (row) => row.noise_maps_json !== null,
      },
      {
        label: "depth",
        cell: (row) => <Flag yes={row.depth_json !== null} label="Depth" />,
        sort: "depth",
        present: (row) => row.depth_json !== null,
      },
      tags,
    ]);
  }

  return populated([
    { label: "name", cell: (row) => <Name row={row} />, sort: "name" },
    {
      label: "type",
      cell: (row) => row.data_type.replace(/_/g, " "),
      sort: "type",
    },
    fileSize,
    {
      label: "published",
      cell: (row) => date(row.published_at),
      sort: "published",
    },
    tags,
  ]);
}

/** The results table, scrolling inside its own container. */
const Results = ({ tab, filters, rows, axes }) => {
  const columns = columnsFor(tab, filters, rows, axes);

  // Horizontal scrolling is contained whatever the screen, so the page never
  // scrolls sideways. On a wide screen the rows scroll inside the card too,
  // which is what lets the column headings stay put over 157 of them; on a
  // narrow one the page scrolls normally rather than trapping a small
  // viewport inside a smaller box.
  return (
    <div id="catalogue-results" class="results card min-w-0 overflow-auto">
      <table class="w-max border-collapse text-sm">
        <thead>
          <tr class="text-left">
            <th scope="col" class="border-b border-line px-4 py-3">
              <input
                type="checkbox"
                data-select-all=""
                aria-label="Select all visible datasets"
              />
            </th>
            {columns.map((column) => {
              const sortable = column.sort !== undefined;
              const active = sortable && filters.sort === column.sort;
              const direction = active && filters.direction === "asc" ? "desc" : "asc";
              const href = sortable
                ? searchUrl(filters, { sort: column.sort, direction })
                : null;
              return (
              <th
                scope="col"
                aria-sort={sortable ? (active ? `${filters.direction}ending` : "none") : undefined}
                class={`label-caps border-b border-line px-4 py-3 ${
                  column.numeric ? "text-right" : ""
                }`}
              >
                {sortable ? (
                  <a
                    href={href}
                    hx-get={href}
                    class="whitespace-nowrap text-inherit no-underline hover:text-text"
                  >
                    {column.label}
                    {active && (
                      <span aria-hidden="true">
                        {filters.direction === "asc" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </a>
                ) : column.label}
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colspan={columns.length + 1} class="px-4 py-8 text-center text-muted">
                Nothing matches these filters. Loosen one, or{" "}
                <a href={`${BASE}/search`}>clear them all</a>.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr class="border-b border-dim transition-colors last:border-0">
              <td class="px-4 py-2.5 align-baseline">
                <input
                  type="checkbox"
                  value={row.name}
                  data-dataset-select=""
                  aria-label={`Select ${row.name}`}
                />
              </td>
              {columns.map((column) => (
                <td
                  class={`px-4 py-2.5 align-baseline ${
                    column.numeric ? "text-right tabular-nums whitespace-nowrap" : ""
                  }`}
                >
                  {column.cell(row, axes.get(row.release_id))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Rail and results together.
 *
 * This is the unit htmx swaps: the facet counts change with the filters, so
 * replacing the table alone would leave the rail describing a search nobody
 * is running any more. Every control inside carries a stable id, which is
 * what htmx restores focus by after a swap.
 */
export const Panel = ({ tab, filters, result, noun }) => (
  <div
    id="panel"
    hx-target="#panel"
    hx-swap="outerHTML"
    hx-push-url="true"
    hx-indicator="#busy"
    class="min-w-0"
  >
    <ActiveFilters tab={tab} filters={filters} total={result.total} noun={noun} />
    <div
      id="catalogue-grid"
      class="grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <FilterRail tab={tab} filters={filters} facets={result.facets} />
      <section class="min-w-0" aria-label={`${noun} results`}>
      <Results tab={tab} filters={filters} rows={result.rows} axes={result.axes} />
      </section>
    </div>
    <dialog
      id="bulk-command"
      class="card m-auto w-[min(42rem,calc(100%-2rem))] bg-surface p-6 text-text backdrop:bg-bg/80"
    >
      <form method="dialog" class="flex items-center gap-4">
        <h2 class="flex-1 text-lg">Download selected datasets</h2>
        <button class="btn-quiet px-3 py-1 text-xs">Close</button>
      </form>
      <p class="mt-3 text-sm text-muted">
        Run this command to download the selected datasets.
      </p>
      <pre class="mt-4 max-h-80 overflow-auto rounded-lg border border-line bg-bg p-4 text-xs"><code data-bulk-command-text=""></code></pre>
      <button type="button" data-copy-bulk-command="" class="btn mt-4 text-xs">
        Copy commands
      </button>
    </dialog>
  </div>
);
