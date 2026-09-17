/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The results table, and the panel that holds it beside the rail.
 *
 * Which columns appear follows from what was searched for: filtering on an
 * axis is asking about that axis, so it becomes a column. The panel is the
 * unit htmx swaps, rail included, because the facet counts describe the
 * search that produced these rows and would otherwise describe an older one.
 */

import { BASE } from "../base.js";
import {
  ActiveFilters,
  FilterRail,
  searchUrl,
} from "./filters.jsx";
import { Badges, Flag, Scientific, date, modelLabel, num, range, size } from "./format.jsx";

/**
 * A dataset name, linking to its page.
 *
 * The truncation is the column's, not this element's: the cap lives on the
 * `<td>` and `<th>` (see `columnsFor`), and the link only has to clip to
 * whatever width it is given.
 *
 * @param {object} props.row The dataset row.
 * @param {object} props.filters Current filters, for the return link.
 */
const Name = ({ row, filters }) => (
  <a
    href={
      // Picking a dataset for a new release rather than opening it. The only
      // thing the picker changes about the catalogue's search is where a
      // result goes.
      filters.pick === "release"
        ? `${BASE}/submit/new?release=${encodeURIComponent(row.name)}`
        : `${BASE}/datasets/${encodeURIComponent(row.name)}?return=${encodeURIComponent(
            searchUrl(filters),
          )}`
    }
    class="block truncate no-underline hover:underline"
    title={row.name}
  >
    {row.name}
  </a>
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
  // Names truncate to whatever the other columns leave, and no further.
  //
  // `max-width: 0` is the whole trick. It takes this column out of the table's
  // content-width sum, so the other columns are measured first and this one
  // receives the remainder; `width: 100%` is what claims that remainder rather
  // than letting it spread across every column. `min-width` is the floor, both
  // the default truncation length and the point past which the card scrolls
  // instead of squeezing the name to nothing.
  //
  // So a tab whose columns already fill the card has nothing left to give and
  // its names sit at the floor, truncated; a tab with room to spare hands it
  // over and the truncation grows into it, up to whole names.
  //
  // This only works while the table itself is not allowed to reach
  // `max-content`: that sum includes the untruncated names, and a table wide
  // enough for them pushes every other column out of view whatever the cell
  // says. See the `<table>` below.
  const name = {
    label: "name",
    cell: (row) => <Name row={row} filters={filters} />,
    sort: "name",
    style: "width:100%;min-width:18rem;max-width:0",
  };
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
          : `${num(row.wavelength_min)}–${num(row.wavelength_max)} ${row.wavelength_units ?? ""
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
    label: "photoionised",
    sort: "photoionised",
    cell: (row) => (
      <Flag yes={row.emission_type === "photoionised"} label="Photoionised" />
    ),
    present: (row) => row.emission_type !== null,
  };

  if (tab.id === "grids") {
    return populated([
      name,
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
      name,
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
      name,
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
    name,
    {
      label: "type",
      cell: (row) => row.data_type.replace(/_/g, " "),
      sort: "type",
    },
    {
      label: "format",
      cell: (row) => row.format,
      sort: "format",
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
  const picking = filters.pick === "release";

  // Horizontal scrolling is contained whatever the screen, so the page never
  // scrolls sideways. On a wide screen the rows scroll inside the card too,
  // which is what lets the column headings stay put over 244 of them; on a
  // narrow one the page scrolls normally rather than trapping a small
  // viewport inside a smaller box.
  return (
    <div id="catalogue-results" class="results card min-w-0 overflow-x-auto">
      {/* Exactly the card's width, and deliberately no `min-w-max`: that
          would size the table to its content, names included, and no rule on
          the name column could then shrink it. Columns that cannot shrink --
          everything but the name -- still overflow it, and the container
          scrolls. */}
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="text-left">
            {/* Selecting is for building a download command, which is not
                what this list is for when a dataset is being picked. Leaving
                the boxes out says the name is the thing to click, without
                having to say it. */}
            {!picking && (
              <th scope="col" class="border-b border-line px-4 py-3">
                <input
                  type="checkbox"
                  data-select-all=""
                  aria-label="Select all visible datasets"
                />
              </th>
            )}
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
                  class={`label-caps border-b border-line px-4 py-3 whitespace-nowrap ${column.numeric ? "text-right" : ""
                    }`}
                  style={column.style}
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
              {!picking && (
                <td class="px-4 py-2.5 align-baseline">
                  <input
                    type="checkbox"
                    value={row.name}
                    data-size={row.size_bytes}
                    data-dataset-select=""
                    aria-label={`Select ${row.name}`}
                  />
                </td>
              )}
              {columns.map((column) => (
                <td
                  class={`px-4 py-2.5 align-baseline whitespace-nowrap ${column.numeric ? "text-right tabular-nums" : ""
                    }`}
                  style={column.style}
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
  </div>
);

