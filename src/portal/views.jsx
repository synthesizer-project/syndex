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

import { AXIS_UNITS, MODEL_LABELS, RANGE_MODES, TABS, toQuery } from "./catalogue.js";

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
    return value
      .toExponential(2)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e");
  }
  return String(Number(value.toPrecision(4)));
}

/**
 * Format a file size in the binary units the catalogue is quoted in.
 *
 * @param {number | null} bytes Size in bytes.
 * @returns {string} Human-readable size.
 */
export function size(bytes) {
  if (bytes === null || bytes === undefined) {
    return "—";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
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
  nav = counts !== null,
  bare = false,
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
      <header class="border-b border-line">
        <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-5">
          <a
            href={BASE}
            class="text-xl font-medium tracking-tight text-text no-underline"
          >
            Syndex
          </a>
          {nav && (
            <nav
              aria-label="Data types"
              class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
            >
              {TABS.map((tab) => (
                <a
                  href={`${BASE}/${tab.id}`}
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
          <a
            href={`${BASE}/submit`}
            class="ml-auto text-sm text-accent-light no-underline hover:underline"
          >
            Submit a dataset
          </a>
        </div>
      </header>
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
      {bare ? (
        <footer class="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-7 gap-y-2 px-6 pb-10">
          <a href={`${BASE}/submit`} class="label-caps no-underline hover:text-text">
            Submit a dataset
          </a>
          <a
            href={`${DATA_API}/v1/datasets`}
            class="label-caps no-underline hover:text-text"
          >
            API
          </a>
          <a
            href="https://synthesizer-project.org/"
            class="label-caps no-underline hover:text-text"
          >
            Synthesizer project
          </a>
        </footer>
      ) : (
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

  // Anything already ticked stays visible: a checked box folded away is a
  // filter the user cannot see they are running.
  const ordered = [
    ...offered.filter((value) => active.includes(value.value)),
    ...offered.filter((value) => !active.includes(value.value)),
  ];
  const expanded = filters.more.includes(name);
  const visible = expanded ? ordered : ordered.slice(0, 6);
  const hidden = ordered.length - visible.length;
  const toggled = expanded
    ? filters.more.filter((group) => group !== name)
    : [...filters.more, name];
  const href = `${BASE}/${tab.id}${toQuery(filters, { more: toggled })}`;

  return (
    <fieldset class="border-0 py-4">
      <legend class="label-caps mb-2">{legend}</legend>
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
    </fieldset>
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
  return (
    <div class="mb-3 rounded-lg border border-line bg-bg/40 p-3">
      <div class="flex items-baseline gap-2">
        <span class="flex-1 font-mono text-sm">{axis.name}</span>
        <a
          href={`${BASE}/${tab.id}${toQuery(filters, { axes: removed })}`}
          hx-get={`${BASE}/${tab.id}${toQuery(filters, { axes: removed })}`}
          class="text-sm"
          aria-label={`Remove the ${axis.name} filter`}
        >
          remove
        </a>
      </div>
      <input type="hidden" name="axis" value={axis.name} />
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

  return (
    <fieldset class="border-0 py-4">
      <legend class="label-caps mb-2">Axes</legend>
      {filters.axes.map((axis) => (
        <AxisFilter
          tab={tab}
          filters={filters}
          axis={axis}
          units={units[axis.name] ?? ""}
        />
      ))}
      {available.length > 0 && (
        <label for="add-axis" class="block text-sm">
          <span class="block text-xs text-muted">Add an axis</span>
          <select
            id="add-axis"
            name="axis"
            class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
          >
            <option value="">choose…</option>
            {available.map((axis) => (
              <option value={axis.value}>
                {axis.value} ({axis.n})
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
};

/** The filter rail: a labelled sheet on narrow screens, a column on wide. */
const FilterRail = ({ tab, filters, facets }) => (
  <details class="filter-sheet card mb-4 p-5 lg:mb-0 lg:self-start" open>
    <summary class="label-caps cursor-pointer">Filters</summary>
    <form
      id="filters"
      method="get"
      action={`${BASE}/${tab.id}`}
      hx-get={`${BASE}/${tab.id}`}
      hx-trigger="change, submit"
      class="mt-4 flex flex-col divide-y divide-line"
    >
      <label for="q" class="block pb-4 text-sm">
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
      {tab.id === "data" && (
        <Facet
          tab={tab}
          filters={filters}
          legend="Type"
          name="type"
          values={facets.type}
          active={filters.type}
          label={(value) => value.replace(/_/g, " ")}
        />
      )}
      {(tab.id === "grids" || tab.id === "dust") && (
        <AxisPicker tab={tab} filters={filters} facets={facets} />
      )}

      {/* The rail works as a plain form when JavaScript does not run, so it
          keeps a submit button; htmx makes it redundant, not unnecessary. */}
      <div class="pt-4">
        <button type="submit" class="btn w-full">
          Apply filters
        </button>
      </div>
    </form>
  </details>
);

/**
 * What a chip for one active filter says.
 *
 * @param {string} key The facet group.
 * @param {string} value The active value.
 * @returns {string} The label to show on the chip.
 */
function chipLabel(key, value) {
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
        href={`${BASE}/${tab.id}${toQuery(filters, changes)}`}
        hx-get={`${BASE}/${tab.id}${toQuery(filters, changes)}`}
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
    "capability",
  ]) {
    for (const value of filters[key]) {
      chip(chipLabel(key, value), {
        [key]: filters[key].filter((other) => other !== value),
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
        <a href={`${BASE}/${tab.id}`} hx-get={`${BASE}/${tab.id}`} class="text-sm">
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
  <div class="flex min-w-[18rem] flex-wrap items-center gap-x-2 gap-y-1">
    <a
      href={`${BASE}/datasets/${encodeURIComponent(row.name)}`}
      class="break-all no-underline hover:underline"
    >
      {row.name}
    </a>
    <Badges row={row} />
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
      cell: (row, axes) => range(axes?.[axis.name]),
      numeric: true,
    }));
}

/**
 * Columns each tab shows.
 *
 * A column for every axis in the filter is appended to the grid tabs, which
 * is one rule and less code than a column picker: someone who filters on
 * spins wants to see the spins.
 */
function columnsFor(tab, filters) {
  const wavelengths = {
    label: "wavelengths",
    cell: (row) =>
      row.wavelength_min === null
        ? "—"
        : `${num(row.wavelength_min)}–${num(row.wavelength_max)} ${
            row.wavelength_units ?? ""
          }`,
  };
  const contents = {
    label: "contents",
    cell: (row) =>
      [row.has_spectra === 1 ? "spectra" : null, row.has_lines === 1 ? "lines" : null]
        .filter((part) => part !== null)
        .join(", ") || "ionising only",
  };
  const fileSize = { label: "size", cell: (row) => size(row.size_bytes), numeric: true };

  if (tab.id === "grids") {
    return [
      { label: "name", cell: (row) => <Name row={row} /> },
      { label: "model", cell: (row) => modelLabel(row.model_name) },
      { label: "emission", cell: (row) => (row.emission_type ?? "—").replace(/_/g, " ") },
      { label: "ages", cell: (row, axes) => range(axes?.ages), numeric: true },
      { label: "metallicities", cell: (row, axes) => range(axes?.metallicities), numeric: true },
      wavelengths,
      contents,
      ...axisColumns(filters, ["ages", "metallicities"]),
      fileSize,
    ];
  }

  if (tab.id === "dust") {
    return [
      { label: "name", cell: (row) => <Name row={row} /> },
      { label: "kind", cell: (row) => (row.emission_type ?? "—").replace(/_/g, " ") },
      { label: "model", cell: (row) => modelLabel(row.model_name) },
      {
        label: "axes",
        cell: (row, axes) => Object.keys(axes ?? {}).join(", ") || "—",
      },
      wavelengths,
      ...axisColumns(filters, []),
      fileSize,
    ];
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
    return [
      { label: "name", cell: (row) => <Name row={row} /> },
      { label: "type", cell: (row) => (row.instrument_type ?? "—").replace(/_/g, " ") },
      { label: "filters", cell: (row) => count(row.filter_codes_json), numeric: true },
      {
        label: "resolving power",
        cell: (row) => num(row.resolving_power),
        numeric: true,
      },
      { label: "PSF", cell: (row) => (row.psfs_json === null ? "—" : "yes") },
      { label: "noise", cell: (row) => (row.noise_maps_json === null ? "—" : "yes") },
      { label: "depth", cell: (row) => (row.depth_json === null ? "—" : "yes") },
      fileSize,
    ];
  }

  return [
    { label: "name", cell: (row) => <Name row={row} /> },
    { label: "type", cell: (row) => row.data_type.replace(/_/g, " ") },
    // The name of a generation input or a cache says almost nothing, and
    // these are the one tab whose rows have no model, axes or filters to
    // describe them. Every dataset here has a description, and it is the
    // only thing that distinguishes one row from the next: all 49 generation
    // inputs are Maraston SEDs, which the descriptions say and the names do
    // not.
    {
      label: "what it is",
      cell: (row) => (
        <span
          class="line-clamp-2 block max-w-[34rem] text-muted"
          title={row.description ?? ""}
        >
          {row.description ?? "—"}
        </span>
      ),
    },
    fileSize,
    {
      // The plan calls this column "version", which is what an id and a
      // publication date amount to for someone choosing a file.
      label: "version",
      cell: (row) => `${row.release_id} · ${date(row.published_at)}`,
      numeric: true,
    },
  ];
}

/** The results table, scrolling inside its own container. */
const Results = ({ tab, filters, rows, axes }) => {
  const columns = columnsFor(tab, filters);

  // Horizontal scrolling is contained whatever the screen, so the page never
  // scrolls sideways. On a wide screen the rows scroll inside the card too,
  // which is what lets the column headings stay put over 157 of them; on a
  // narrow one the page scrolls normally rather than trapping a small
  // viewport inside a smaller box.
  return (
    <div class="results card overflow-x-auto lg:max-h-[calc(100vh-13rem)] lg:overflow-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="text-left">
            {columns.map((column) => (
              <th
                scope="col"
                class={`label-caps border-b border-line px-4 py-3 ${
                  column.numeric ? "text-right" : ""
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colspan={columns.length} class="px-4 py-8 text-center text-muted">
                Nothing matches these filters. Loosen one, or{" "}
                <a href={`${BASE}/${tab.id}`}>clear them all</a>.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr class="border-b border-dim transition-colors last:border-0">
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
    class="grid items-start gap-6 lg:grid-cols-[17rem_1fr]"
  >
    <FilterRail tab={tab} filters={filters} facets={result.facets} />
    <section aria-label={`${noun} results`}>
      <ActiveFilters tab={tab} filters={filters} total={result.total} noun={noun} />
      <Results tab={tab} filters={filters} rows={result.rows} axes={result.axes} />
    </section>
  </div>
);
