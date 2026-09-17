/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The filter rail, and the chips that say what it is currently doing.
 *
 * Every control here is a link or a checkbox in a form that GETs, so a filter
 * change is a URL. htmx makes it a background swap; without it the same
 * controls still work, which is why none of them is a button that needs
 * JavaScript to mean anything.
 *
 * Counts beside a value are of what ticking it would return given every other
 * active filter -- the only reading under which ticking a second box in the
 * same group makes sense.
 */

import { BASE } from "../base.js";
import {
  AXIS_UNITS,
  RANGE_MODES,
  SIZE_BUCKETS,
  toQuery,
} from "../data/catalogue.js";
import { kindLabel, modelLabel, range, size } from "./format.jsx";

/**
 * The search URL these filters describe, with some of them changed.
 *
 * Every control in the rail is a link to one of these, which is what makes a
 * filtered view shareable and the back button correct without any JavaScript
 * being involved.
 *
 * @param {object} filters The current filters.
 * @param {object} changes What to change about them.
 * @returns {string} The URL.
 */
export const searchUrl = (filters, changes = {}) =>
  `${BASE}/search${toQuery(filters, changes)}`;

/** Changing type also drops specialist filters that do not apply to it. */
export const typeUrl = (filters, type) =>
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
const Facet = ({
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
              class={`min-w-0 flex-1 truncate ${filters.type[0] === value.value ? "text-text" : "text-muted"
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
          select range
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
          <legend class="text-xs text-muted">match</legend>
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
export const FilterRail = ({ tab, filters, facets }) => (
  <div data-filter-column="" class="mb-4 lg:mb-0">
    {/* Nothing to download when the list is being used to pick one dataset,
        and nothing selects anything either: the rows carry no boxes. */}
    {filters.pick === "" && (
      <button type="button" data-bulk-command="" class="btn mb-3 w-full" hidden>
        Get download command (<span data-selection-count="">0</span>)
      </button>
    )}
    <details class="filter-sheet card p-5" open>
      <summary class="label-caps cursor-pointer">Refine</summary>
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
              placeholder="name, description, type or filename…"
              class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
            />
          </label>
          <button type="submit" class="btn mt-2 w-full">
            Search
          </button>
        </div>

        {/* Picking travels with every other bit of filter state, so
            narrowing the list does not quietly turn the picker back into the
            catalogue. */}
        {filters.pick !== "" && (
          <input type="hidden" name="pick" value={filters.pick} />
        )}
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
            label={kindLabel}
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
    return kindLabel(value);
  }
  return String(value).replace(/_/g, " ");
}

/** The chips above the table, each removing one active filter. */
export const ActiveFilters = ({ tab, filters, total, noun }) => {
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
