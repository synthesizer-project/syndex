/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Turning stored values into something readable.
 *
 * Numbers out of a grid are written the way a paper writes them, sizes and
 * dates the way somebody scanning a table reads them, and the small markers
 * that label a row. Nothing here queries anything or knows what page it is
 * on: given a value, it returns what to show.
 */

import {
  AXIS_UNITS,
  MODEL_LABELS,
} from "../data/catalogue.js";

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
 * What a `grid_type` is called in the interface.
 *
 * The stored values are `sps`, `agn` and `dust`. The filter rail, the active
 * filter chips and the dataset page all read from here so they cannot
 * disagree, which they did: the rail offered "stellar" and the dataset page
 * then printed the raw "sps".
 *
 * @param {string} value The stored grid_type.
 * @returns {string} What to show a reader.
 */
export function kindLabel(value) {
  return { sps: "stellar", agn: "AGN", dust: "dust" }[value] ?? value;
}

/**
 * Format a file size in decimal units.
 *
 * Decimal rather than binary throughout, matching the size facets in
 * `catalogue.js` and what the storage provider bills in. `filters.js` carries
 * the same function for the browser, since this module is never shipped
 * there; keep the two in step.
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
  if (index === 0) {
    return `${value} ${units[index]}`;
  }
  // One decimal below 10, but never a bare ".0": an upload limit that reads
  // "1.0 GB" looks like a rounding artefact rather than a round number.
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(0);
  return `${shown} ${units[index]}`;
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
const BADGE_TITLES = {
  "known bug": "A defect is recorded against this release; the dataset page says what it is.",
  recommended: "The maintainers' default choice for this kind of data.",
  reduced: "A small cut-down copy, for tests rather than for science.",
  CI: "Downloaded by Synthesizer's own test suite.",
};

/**
 * One short marker on a dataset row.
 *
 * @param {object} props Component props.
 * @param {unknown} props.children The word, which is also the identity.
 * @param {boolean} props.strong Whether it is the one worth noticing first.
 * @returns {unknown} The rendered badge.
 */
export const Badge = ({ children, strong = false }) => (
  <span
    class={`pill ${strong ? "text-accent-light" : "text-muted"}`}
    title={BADGE_TITLES[children]}
  >
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
export const Flag = ({ yes, label }) => (
  <span
    class={yes ? "text-accent-light" : "text-muted"}
    title={`${label}: ${yes ? "yes" : "no"}`}
  >
    <span aria-hidden="true">{yes ? "✓" : "×"}</span>
    <span class="sr-only">{yes ? "yes" : "no"}</span>
  </span>
);
