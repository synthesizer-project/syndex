/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The pages that are not a filtered table: the landing page, dataset
 * detail, the submission form and the review queue.
 */

import { TABS } from "./catalogue.js";
import {
  BASE,
  Badge,
  Badges,
  Command,
  DATA_API,
  Flag,
  Layout,
  Scientific,
  kindLabel,
  date,
  num,
  size,
} from "./views.jsx";

/** What each tab is for, in as few words as say it. */
const TAB_BLURBS = {
  grids: "Stellar and AGN, incident and photoionised",
  dust: "Attenuation curves and dust emission",
  instruments: "Filters, PSFs, noise and depths",
};

const CAPABILITIES = [
  "can_do_photometry",
  "can_do_imaging",
  "can_do_psf_imaging",
  "can_do_noisy_imaging",
  "can_do_spectroscopy",
  "can_do_noisy_spectroscopy",
  "can_do_resolved_spectroscopy",
  "can_do_psf_spectroscopy",
  "can_do_noisy_resolved_spectroscopy",
];

/** Data types a submission may claim, as the catalogue spells them. */
export const DATA_TYPES = [
  "grid",
  "dust_grid",
  "instrument",
  "simulation_data",
  "generation_data",
  "synference_data",
  // Regression references. Present in the catalogue and missing from this
  // list until now, so there was a kind of data the form could not describe.
  "reference_data",
  "cache",
];

/**
 * What the submission form offers, which is one more than the catalogue holds.
 *
 * "other" is not a catalogue type and never becomes one. It is a submission
 * saying "this is none of those", which is a real and useful answer: the
 * alternative is a contributor picking whichever listed type is least wrong,
 * and a reviewer then having to work out that they did. A reviewer publishes
 * it under whatever type it turns out to be, minting a new one if that is
 * what it needs.
 */
export const SUBMISSION_TYPES = [...DATA_TYPES, "other"];

/**
 * One entry already in the catalogue, per data type.
 *
 * Shown as placeholder text in the boxes themselves: "what should I write
 * here" is answered better by a real entry than by instruction, and answered
 * best of all in the box being asked about. Short ones, since a placeholder
 * that overflows its input teaches nothing.
 *
 * Placeholders rather than prefilled values, deliberately. A prefilled
 * description is one somebody submits unchanged.
 */
const TYPE_EXAMPLES = {
  grid: {
    name: "bpass-2p2p1-bin-chabrier03-0p1-300p0",
    display_name: "BPASS 2.2.1 binary, Chabrier (2003) IMF",
    description:
      "BPASS binary models with a Chabrier (2003) IMF over 0.1 to 300 solar " +
      "masses. Incident only: not processed through a photoionisation code.",
  },
  dust_grid: {
    name: "draine-li-dust-extcurve-mrn",
    display_name: "Draine and Li MRN dust extinction curve grid",
    description:
      "Dust attenuation curves using an MRN grain size distribution, with " +
      "small, large and PAH grain centres.",
  },
  instrument: {
    name: "euclid-nisp-instrument",
    display_name: "Euclid NISP instrument",
    description:
      "Instrument cache for the Euclid NISP photometric imager. Filters and " +
      "resolution are read from the file, not entered here.",
  },
  simulation_data: {
    name: "sc-sam-sfhist-test",
    display_name: "SC-SAM test star-formation history",
    description:
      "Reduced SC-SAM star-formation history used by the test suite. Not " +
      "suitable for science.",
  },
  generation_data: {
    name: "generation-ssp-m11-pickles-ssz002",
    display_name: "Grid generation input: ssp_M11_Pickles.ssz002",
    description:
      "Raw model input used to build Maraston (2011) grids, kept so they can " +
      "be regenerated from their original inputs.",
  },
  synference_data: {
    name: "synference-grid-bpass-chab-densebasis-sfh",
    display_name: "Synference input: BPASS Chabrier, DenseBasis SFH",
    description:
      "Input file for Synference, the simulation based inference toolkit " +
      "built on Synthesizer.",
  },
  reference_data: {
    name: "golden-pipeline-reference",
    display_name: "Golden pipeline regression reference",
    description: "Float64 reference output for full-pipeline regression tests.",
  },
  cache: {
    name: "svo-filter-cache",
    display_name: "SVO filter profile service cache",
    description:
      "Archived SVO filter response curves, downloaded to avoid hammering " +
      "the SVO database during CI. A mechanical dependency, not science.",
  },
  other: {
    name: "my-new-kind-of-data",
    display_name: "Something the catalogue has no type for yet",
    description:
      "Say what this is and what it is for. A reviewer will decide what to " +
      "publish it as, and can add a new type if it needs one.",
  },
};

/** What the boxes show before a type has been chosen. */
const DEFAULT_EXAMPLE = TYPE_EXAMPLES.grid;

/** A definition list of whatever is actually recorded. */
const Fields = ({ entries }) => {
  const rows = entries.filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (rows.length === 0) {
    return null;
  }
  return (
    <dl
      class={`fields grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm ${
        rows.length > 6 ? "many-fields" : ""
      }`}
    >
      {rows.map(([label, value]) => (
        <>
          <dt class="label-caps pt-0.5">{label}</dt>
          <dd class="min-w-0 break-words">{value}</dd>
        </>
      ))}
    </dl>
  );
};

/** Flatten nested metadata into readable definition-list rows. */
const expandedFields = (value, path = []) =>
  Object.entries(value).flatMap(([key, child]) => {
    const next = [...path, key];
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      return expandedFields(child, next);
    }
    const label = next
      .map((part) => part === "hdf5" ? "HDF5" : part.replace(/_/g, " "))
      .join(" · ");
    const display = Array.isArray(child)
      ? child.join(", ")
      : typeof child === "boolean"
        ? child ? "yes" : "no"
        : typeof child === "number" ? <Scientific>{num(child)}</Scientific> : child;
    return [[label, display]];
  });

/** A titled block. */
const Section = ({ title, action = null, children }) => (
  <section class="card mb-5 p-6">
    {action === null ? (
      <h2 class="mb-4 text-xl">{title}</h2>
    ) : (
      <div class="mb-4 flex items-start justify-between gap-4">
        <h2 class="text-xl">{title}</h2>
        {action}
      </div>
    )}
    {children}
  </section>
);

/** Standard overlapping-squares control for copying a command. */
const CopyButton = ({
  command,
  label = "Copy command",
  filename,
  large = false,
  sizeBytes,
  sizeLabel,
}) => (
  <button
    type="button"
    data-copy-command={command}
    class={`group relative inline-flex shrink-0 cursor-pointer items-center justify-center border border-muted bg-bg text-text transition-colors hover:border-accent-light hover:text-accent-light ${
      large ? "h-11 w-11 rounded-lg" : "h-8 w-8 rounded-lg"
    }`}
    aria-label={label}
    data-download-filename={filename}
    data-download-size={sizeBytes}
    data-download-size-label={sizeLabel}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class={large ? "h-5 w-5" : "h-4 w-4"}
    >
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    </svg>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface px-3.5 py-2 font-mono text-xs whitespace-nowrap text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      {command}
    </span>
  </button>
);

/** The same control, for copying a value that is already on the page. */
const CopyTextButton = ({ text, label }) => (
  <button
    type="button"
    data-copy-text={text}
    data-copy-label={label}
    class="group relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-muted bg-bg text-text transition-colors hover:border-accent-light hover:text-accent-light"
    aria-label={label}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="h-4 w-4"
    >
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    </svg>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface px-3.5 py-2 text-xs whitespace-nowrap text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      {label}
    </span>
  </button>
);

/** Standard download-arrow control. */
const DownloadButton = ({
  href,
  label,
  filename,
  large = false,
  sizeBytes,
  sizeLabel,
}) => (
  <a
    href={href}
    class={`group relative inline-flex shrink-0 items-center justify-center border border-muted bg-bg text-text no-underline transition-colors hover:border-accent-light hover:text-accent-light ${
      large ? "h-11 w-11 rounded-lg" : "h-8 w-8 rounded-lg"
    }`}
    aria-label={label}
    data-download-filename={filename}
    data-download-size={sizeBytes}
    data-download-size-label={sizeLabel}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class={large ? "h-5 w-5" : "h-4 w-4"}
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface px-3.5 py-2 text-xs whitespace-nowrap text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      {label}
    </span>
  </a>
);

/**
 * Decode a stored JSON column.
 *
 * @param {string | null} text The column value.
 * @param {unknown} fallback What to return when there is nothing stored.
 * @returns {unknown} The decoded value.
 */
function decode(text, fallback = null) {
  if (text === null || text === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    // A column that will not decode is a publication bug, not a page
    // failure: show the raw text rather than a 500.
    return text;
  }
}

/**
 * The landing page.
 *
 * The org site's shape: one screen, centred, three signposts and nothing
 * else. Someone arriving from a paper needs orientation, and someone who
 * knows what they want should be one keystroke from the search.
 */
export const Landing = ({ counts, datasets, bytes }) => (
  <Layout
    title="The Synthesizer data catalogue"
    counts={counts}
    nav={false}
    bare
    active={null}
    footer={
      <>
        {datasets} dataset{datasets === 1 ? "" : "s"} · {size(bytes)}
      </>
    }
  >
    <div class="rise text-center">
      <img
        src={`${BASE}/static/syndex_logo_2.png`}
        alt=""
        width="824"
        height="862"
        class="mx-auto mb-7 h-auto w-[clamp(9rem,22vw,15rem)]"
      />
      <h1 class="mx-auto whitespace-nowrap text-[clamp(1rem,4.8vw,2.6rem)] leading-[1.25]">
        The Synthesizer data catalogue
      </h1>
      <p class="mx-auto mt-4 max-w-3xl text-sm leading-[1.7] text-muted sm:text-base">
        An index of stellar population synthesis (SPS) and AGN grids, dust
        emission and attenuation models, and instruments for the Synthesizer
        ecosystem.
      </p>

      <form
        method="get"
        action={`${BASE}/search`}
        role="search"
        class="mx-auto mt-8 flex max-w-md items-center gap-2"
      >
        <label for="landing-q" class="sr-only">
          Search the catalogue
        </label>
        <input
          type="search"
          id="landing-q"
          name="q"
          placeholder="name, description, type or filename…"
          class="min-w-0 flex-1 rounded-full border border-muted bg-surface px-4 py-2 text-left text-sm placeholder:text-muted focus:placeholder:text-transparent"
        />
        <button type="submit" class="btn text-sm">
          Search
        </button>
      </form>
    </div>

    <nav
      aria-label="Browse by data type"
      class="rise mt-14 grid gap-4 [animation-delay:0.18s] sm:grid-cols-3"
    >
      {TABS.filter((tab) => tab.types !== null).map((tab) => (
        <a
          href={`${BASE}/search?type=${tab.types[0]}`}
          class="card card-link flex flex-col items-center px-5 pt-7 pb-6 text-center text-text no-underline"
        >
          <span
            class="mb-5 flex h-22 w-22 items-center justify-center rounded-full border border-line bg-accent/5"
          >
            <span class="text-3xl font-medium leading-none">
              {counts[tab.id]}
            </span>
          </span>
          <span class="font-medium">{tab.label}</span>
          <span class="mt-1.5 text-xs leading-[1.6] text-muted">
            {TAB_BLURBS[tab.id]}
          </span>
        </a>
      ))}
    </nav>

  </Layout>
);

/** One tab: the shell around the rail and the table. */
export const Browse = ({ tab, counts, filters, children }) => (
  <Layout
    title={tab.label}
    counts={counts}
    active={tab.id === "search" && filters.type.length > 0 ? null : tab.id}
    filters={filters}
  >
    <h1 class="sr-only">{tab.label}</h1>
    {children}
  </Layout>
);

/** The axes of one grid release, in the order the file stores them. */
const Axes = ({ axes }) => (
  <div class="results overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="text-left">
          {["axis", "minimum", "maximum", "units", "points", "scale"].map(
            (label) => (
              <th
                scope="col"
                class="label-caps border-b border-line px-4 py-2.5"
              >
                {label}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {axes.map((axis) => (
          <tr class="border-b border-dim last:border-0">
            <td class="px-4 py-2">{axis.name}</td>
            <td class="px-4 py-2 tabular-nums">
              <Scientific>{num(axis.minimum)}</Scientific>
            </td>
            <td class="px-4 py-2 tabular-nums">
              <Scientific>{num(axis.maximum)}</Scientific>
            </td>
            <td class="px-4 py-2 text-muted">{axis.units ?? "—"}</td>
            <td class="px-4 py-2 tabular-nums">
              {axis.count.toLocaleString("en-GB")}
            </td>
            <td class="px-4 py-2 text-muted">{axis.scale}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Every release of a dataset, so a result can be pinned to one. */
const Releases = ({ dataset }) => (
  // Scrolls rather than stretches. Its cells do not wrap, so without this the
  // table sets the width of the page and every other thing on it goes off the
  // side of a phone.
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="text-left">
          {/* "ID" rather than "release": the number identifies a release, but
              nobody reading this page thinks in releases, and the column
              beside it is already the publication date. */}
          {[
            "ID",
            "published",
            "size",
            "minimum version",
            "maximum version",
            "download",
            "",
          ].map((label) => (
            <th
              scope="col"
              class="label-caps border-b border-line px-4 py-2.5"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataset.releases.map((release) => (
          <tr class="border-b border-dim last:border-0">
            <td class="px-4 py-2 tabular-nums">
              <a
                href={`${DATA_API}/v1/releases/${release.release_id}`}
                title={`Release ${release.release_id} as JSON`}
              >
                {release.release_id}
              </a>
            </td>
            <td class="px-4 py-2 text-muted">{date(release.published_at)}</td>
            <td class="px-4 py-2 text-right tabular-nums">
              {size(release.size_bytes)}
            </td>
            <td class="px-4 py-2 whitespace-nowrap text-muted">
              {release.synthesizer_min_version ?? "—"}
            </td>
            <td class="px-4 py-2 whitespace-nowrap text-muted">
              {release.synthesizer_max_version ?? "—"}
            </td>
            <td class="px-4 py-2">
              <div class="flex items-center gap-2 whitespace-nowrap">
                <DownloadButton
                  href={`${DATA_API}/v1/releases/${release.release_id}/download`}
                  label={`Direct download release ${release.release_id}`}
                  filename={dataset.filename}
                  sizeBytes={release.size_bytes}
                  sizeLabel={size(release.size_bytes)}
                />
                <CopyButton
                  command={`synthesizer-download --dataset ${dataset.name} --release ${release.release_id}`}
                  label={`Copy download command for release ${release.release_id}`}
                  filename={dataset.filename}
                  sizeBytes={release.size_bytes}
                  sizeLabel={size(release.size_bytes)}
                />
              </div>
            </td>
            <td class="px-4 py-2 whitespace-nowrap">
              {release.release_id === dataset.current_release_id && (
                <Badge strong>current</Badge>
              )}{" "}
              {release.known_bug === 1 && <Badge>known bug</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * Shorten a BibTeX author list the way a reference list would.
 *
 * @param {string} authors Author field as stored, "Surname, A. and ...".
 * @returns {string} First author, with "et al." when there are others.
 */
const firstAuthor = (authors) => {
  const [first] = authors.split(" and ");
  const surname = first.split(",")[0].trim();
  return authors.includes(" and ") ? `${surname} et al.` : surname;
};

/**
 * Describe what a preview plot shows.
 *
 * The plots carry no caption of their own, so the page states it. Everything
 * needed is already recorded, which is why the image does not have to.
 *
 * @param {object} dataset A dataset row with its preview_kind and grid.
 * @returns {string} A short caption.
 */
const previewCaption = (dataset) => {
  if (dataset.preview_kind === "filters") {
    return "Filter transmission curves, coloured by pivot wavelength.";
  }
  if (dataset.preview_kind === "ionising") {
    return "Ionising luminosity across the first two grid axes.";
  }
  // A dust grid's plot is of the same kind but not of the same quantity, and
  // calling its extinction curves "transmitted plus nebular spectra" is simply
  // wrong.
  if (dataset.data_type === "dust_grid") {
    const curves =
      dataset.grid?.emission_type === "dust_attenuation"
        ? "attenuation curves"
        : "emission spectra";
    return `Every one of this grid's ${curves}, coloured by magnitude.`;
  }
  const what =
    dataset.grid?.emission_type === "incident"
      ? "incident spectra"
      : "transmitted plus nebular spectra";
  return `Every one of this grid's ${what}, coloured by luminosity.`;
};

/**
 * Alternative text for a preview, for anyone not seeing the image.
 *
 * @param {object} dataset A dataset row.
 * @returns {string} A description of the plot.
 */
const previewAlt = (dataset) =>
  `${previewCaption(dataset)} ${dataset.display_name}.`;

/** One dataset, with everything the catalogue holds about it. */
export const Dataset = ({ dataset, counts, returnTo = null }) => {
  const grid = dataset.grid;
  const instrument = dataset.instrument;
  const cloudy = decode(grid?.photoionisation_parameters_json, {});
  const modelParameters = Object.entries(
    decode(grid?.model_parameters_json, {}),
  ).filter(
    ([, value]) =>
      value !== false && value !== "" && value !== null && value !== undefined,
  );
  const modelParametersTitle =
    grid?.grid_type === "sps"
      ? "SPS model parameters"
      : grid?.grid_type === "agn"
        ? "AGN model parameters"
        : "Model parameters";
  const citations = dataset.citations ?? [];
  const metadata = decode(dataset.metadata_json, {});
  const provenance = decode(dataset.provenance_json, {});
  const spectra = decode(grid?.available_spectra_json, []);
  const lines = decode(grid?.available_lines_json, []);
  const instrumentFilters = decode(instrument?.filter_codes_json, []);
  const capabilities = decode(instrument?.capabilities_json, {});
  const description = dataset.description?.replace(/\s+/g, " ").trim() ?? "";
  const hasPreview = dataset.preview_path !== null && dataset.release_id !== null;
  const compatibility = [
    dataset.synthesizer_min_version === null
      ? null
      : `>= ${dataset.synthesizer_min_version}`,
    dataset.synthesizer_max_version === null
      ? null
      : `<= ${dataset.synthesizer_max_version}`,
  ]
    .filter(Boolean)
    .join(", ") || "Any version";
  const downloadCommand = `synthesizer-download --dataset ${dataset.name}`;
  const previewVersion = dataset.preview_path?.split("/")[1];
  const previewUrl = `${DATA_API}/v1/releases/${dataset.release_id}/preview.png${
    previewVersion ? `?v=${encodeURIComponent(previewVersion)}` : ""
  }`;
  const tab =
    TABS.find((candidate) => candidate.types?.includes(dataset.data_type)) ??
    TABS.find((candidate) => candidate.types === null);

  return (
    <Layout
      title={dataset.name}
      counts={counts}
      active={tab.id === "search" ? null : tab.id}
    >
      <div class="mx-auto max-w-5xl">
        <div class="flex items-center justify-between gap-4">
          <p class="text-base font-medium">
            <a
              href={
                returnTo ??
                `${BASE}/search?type=${encodeURIComponent(dataset.data_type)}`
              }
              class="inline-flex items-center gap-2 text-muted no-underline transition-colors hover:text-text"
            >
              <span aria-hidden="true" class="text-xl leading-none">&larr;</span>{" "}
              <span>
                {tab.id === "search"
                  ? dataset.data_type.replace(/_/g, " ")
                  : tab.label}
              </span>
            </a>
          </p>
          {dataset.release_id !== null && (
            <div class="flex gap-3">
              <DownloadButton
                href={`${DATA_API}/v1/releases/${dataset.release_id}/download`}
                label={`Direct download ${dataset.filename}`}
                filename={dataset.filename}
                sizeBytes={dataset.size_bytes}
                sizeLabel={size(dataset.size_bytes)}
                large
              />
              <CopyButton
                command={downloadCommand}
                label="Copy download command"
                filename={dataset.filename}
                sizeBytes={dataset.size_bytes}
                sizeLabel={size(dataset.size_bytes)}
                large
              />
            </div>
          )}
        </div>
        {/* break-words because a display name is not always prose: some are
            the raw filename, and 113 characters joined by underscores has no
            break opportunity at all, so without this one dataset sets the
            width of the page and a phone has to zoom out to see any of it. */}
        <h1 class="mt-8 text-3xl leading-tight break-words sm:text-4xl">
          {dataset.display_name}
        </h1>
        <p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="font-mono text-sm break-all text-muted">
            {dataset.name}
          </span>
          <Badges row={dataset} />
        </p>
        {(description !== "" || hasPreview) && (
          <div
            class={`mt-6 mb-5 grid gap-5 ${
              description !== "" && hasPreview
                ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,378px)]"
                : ""
            }`}
          >
            {description !== "" && (
              <section class="card p-6">
                <p class="leading-[1.65] text-muted">{description}</p>
              </section>
            )}
            {hasPreview && (
              <figure class="preview-thumb">
                <a
                  href={previewUrl}
                  data-preview
                  aria-label="Open the full size plot"
                >
                  <img
                    src={previewUrl}
                    alt={previewAlt(dataset)}
                    loading="lazy"
                    width="640"
                    height="400"
                  />
                </a>
                <figcaption>{previewCaption(dataset)}</figcaption>
              </figure>
            )}
          </div>
        )}

        {dataset.known_bug === 1 && (
          <p class="mt-6 rounded-lg border border-accent-light bg-accent/10 p-4 text-sm">
            <strong class="text-accent-light">Known bug in this release.</strong>{" "}
            {dataset.known_bug_description}
          </p>
        )}

        <div class="mt-6">

          {dataset.release_id === null && (
            <Section title="Not yet published">
              <p class="text-sm text-muted">
                This dataset has no current release, so there is nothing to
                download yet.
              </p>
            </Section>
          )}

          <div class="dataset-cards">
            {dataset.release_id !== null && (
              <Section title="File">
                <Fields
                  entries={[
                    ["filename", <span class="font-mono">{dataset.filename}</span>],
                    ["size", size(dataset.size_bytes)],
                    ["format", dataset.format],
                    ["published", date(dataset.published_at)],
                    ["synthesizer version", compatibility],
                  ]}
                />
              </Section>
            )}

          {grid !== null && (
            <Section title="Grid">
              <Fields
                entries={[
                  ["kind", kindLabel(grid.grid_type)],
                  [
                    "model",
                    grid.model_name === null
                      ? null
                      : `${grid.model_name}${grid.model_version === null
                        ? ""
                        : ` ${grid.model_version}`
                      }`,
                  ],
                  [
                    "wavelengths",
                    grid.wavelength_min === null
                      ? null
                      : (
                        <Scientific>
                          {`${num(grid.wavelength_min)}–${num(grid.wavelength_max)}${grid.wavelength_units ? ` ${grid.wavelength_units}` : ""}`}
                        </Scientific>
                      ),
                  ],
                  [
                    "photoionisation",
                    grid.photoionisation_code === null
                      ? null
                      : `${grid.photoionisation_code} ${grid.photoionisation_code_version ?? ""
                      }`,
                  ],
                  [
                    "incident grid",
                    dataset.incident === null ? null : (
                      <a
                        href={`${BASE}/datasets/${encodeURIComponent(
                          dataset.incident.name,
                        )}`}
                      >
                        {dataset.incident.name}
                      </a>
                    ),
                  ],
                  [
                    "spectra",
                    spectra.length === 0 ? null : spectra.join(", "),
                  ],
                ]}
              />
            </Section>
          )}

          {modelParameters.length > 0 && (
            <Section title={modelParametersTitle}>
              <Fields
                entries={modelParameters.map(([key, value]) => [
                  key.replace(/_/g, " "),
                  Array.isArray(value) ? value.join(", ") : String(value),
                ])}
              />
            </Section>
          )}

          {instrument !== null && (
            <Section title="Instrument">
              <Fields
                entries={[
                  ["type", instrument.instrument_type?.replace(/_/g, " ")],
                  ["label", instrument.label],
                  [
                    "wavelengths",
                    instrument.wavelength_min === null
                      ? null
                      : (
                        <Scientific>
                          {`${num(instrument.wavelength_min)}–${num(
                            instrument.wavelength_max,
                          )}${instrument.wavelength_units ? ` ${instrument.wavelength_units}` : ""}`}
                        </Scientific>
                      ),
                  ],
                  [
                    "resolution",
                    instrument.resolution === null
                      ? null
                      : (
                        <Scientific>
                          {`${num(instrument.resolution)}${instrument.resolution_units ? ` ${instrument.resolution_units}` : ""}`}
                        </Scientific>
                      ),
                  ],
                  [
                    "resolving power",
                    instrument.resolving_power === null
                      ? null
                      : <Scientific>{num(instrument.resolving_power)}</Scientific>,
                  ],
                  [
                    "depths",
                    instrument.depth_json === null
                      ? null
                      : JSON.stringify(decode(instrument.depth_json)),
                  ],
                  [
                    "PSFs",
                    instrument.psfs_json === null
                      ? null
                      : JSON.stringify(decode(instrument.psfs_json)),
                  ],
                  [
                    "noise maps",
                    instrument.noise_maps_json === null
                      ? null
                      : JSON.stringify(decode(instrument.noise_maps_json)),
                  ],
                ]}
              />
            </Section>
          )}

          {instrument !== null && (
            <Section title="Capabilities">
              <Fields
                entries={CAPABILITIES.map((name) => {
                  const label = name.replace("can_do_", "").replace(/_/g, " ");
                  return [
                    label,
                    <Flag yes={capabilities[name] === true} label={label} />,
                  ];
                })}
              />
            </Section>
          )}

          {instrumentFilters.length > 0 && (
            <Section title={`Filters (${instrumentFilters.length})`}>
              <ul class="grid max-h-96 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-1 overflow-y-auto pr-2 font-mono text-xs">
                {instrumentFilters.map((filter) => (
                  <li>{filter}</li>
                ))}
              </ul>
            </Section>
          )}

          {dataset.axes.length > 0 && (
            <Section title="Axes">
              <Axes axes={dataset.axes} />
            </Section>
          )}

          {Object.keys(cloudy).length > 0 && (
            <Section title="Photoionisation parameters">
              {/* Of 31 Cloudy keys only seven vary across the catalogue, so
              these are shown rather than filtered on: a constant value is
              informative here and dead weight in a facet rail. */}
              <Fields
                entries={Object.entries(cloudy)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, value]) => [key.replace(/_/g, " "), String(value)])}
              />
            </Section>
          )}

          {lines.length > 0 && (
            <Section title={`Available lines (${lines.length})`}>
              <ul class="grid max-h-96 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-1 overflow-y-auto pr-2 font-mono text-xs">
                {lines.map((line) => (
                  <li>{String(line).replace(/(\d)A$/, "$1 Å")}</li>
                ))}
              </ul>
            </Section>
          )}

          {dataset.releases.length > 0 && (
            <Section title="Releases">
              <p class="mb-3 text-sm text-muted">
                Older releases stay downloadable forever. A file that turns out to
                be wrong is corrected by publishing a new release, not by editing
                the old one, so anything pinned to a flagged release keeps
                resolving and keeps saying what is wrong with it.
              </p>
              <Releases dataset={dataset} />
            </Section>
          )}

          {citations.length > 0 && (
            <Section
              title="Citations"
              action={
                <div class="flex gap-2">
                  <CopyTextButton
                    text={citations
                      .map((citation) => String(citation.bibtex ?? "").trim())
                      .filter((entry) => entry !== "")
                      .join("\n\n")}
                    label={
                      citations.length === 1
                        ? "Copy the BibTeX entry"
                        : `Copy all ${citations.length} BibTeX entries`
                    }
                  />
                  {dataset.release_id === null ? null : (
                    <DownloadButton
                      href={`${DATA_API}/v1/releases/${dataset.release_id}/citations.bib`}
                      label={
                        citations.length === 1
                          ? "Download the citation as BibTeX"
                          : `Download all ${citations.length} citations as BibTeX`
                      }
                    />
                  )}
                </div>
              }
            >
              <>
                  <p class="mb-3 text-sm text-muted">
                    Cite all of these when using this grid: the model, the paper it
                    was released in, and the code it was processed through.
                  </p>
                  <ul class="mb-3 list-none space-y-2 p-0 text-sm">
                    {citations.map((citation) => (
                      <li>
                        {citation.authors ? (
                          <span>{firstAuthor(citation.authors)} </span>
                        ) : null}
                        {citation.year ? <span>({citation.year}) </span> : null}
                        {citation.title ? <span>{citation.title}. </span> : null}
                        {citation.journal ? (
                          <em class="text-muted">{citation.journal}. </em>
                        ) : null}
                        <a
                          href={`https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(
                            citation.bibcode,
                          )}/abstract`}
                        >
                          ADS
                        </a>
                        {citation.doi ? (
                          <>
                            {" · "}
                            <a
                              href={`https://doi.org/${citation.doi}`}
                            >
                              doi
                            </a>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
              </>
            </Section>
          )}

          {Object.keys(metadata).length > 0 && (
            <Section title="Metadata">
              <Fields
                entries={Object.entries(metadata).map(([key, value]) => [
                  key,
                  typeof value === "object" ? JSON.stringify(value) : String(value),
                ])}
              />
            </Section>
          )}

          {Object.keys(provenance).length > 0 && (
            <Section title="Provenance">
              <Fields entries={expandedFields(provenance)} />
            </Section>
          )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

/** One labelled form control. */
const Field = ({ label, name, value = "", hint = null, ...rest }) => (
  <label for={name} class="block">
    <span class="label-caps mb-1 block">
      {label}
      {rest.required === true && <span aria-hidden="true"> *</span>}
    </span>
    {rest.rows === undefined ? (
      <input
        id={name}
        name={name}
        value={value}
        class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
        {...rest}
      />
    ) : (
      <textarea
        id={name}
        name={name}
        class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
        {...rest}
      >
        {value}
      </textarea>
    )}
    {hint !== null && (
      <span class="mt-1 block text-xs leading-relaxed text-muted">{hint}</span>
    )}
  </label>
);

/**
 * The submission form.
 *
 * Metadata first, bytes second. A contributor describes what they have, and
 * the file itself goes straight to R2 from the page that follows, so this
 * form stays small enough to fill in and cheap enough to reject.
 *
 * Nothing here asks for a size or a filename: what arrived is read back from
 * the bucket, which is the only account of it that cannot be wrong.
 */
/**
 * What a visitor sees when a page needs an account and they have none.
 *
 * Deliberately not a 404 and not a bare refusal. The visitor is one click
 * from being allowed the page, so the page says so and offers the click.
 *
 * @param {object} props Component props.
 * @param {object} props.counts Tab counts for the header.
 * @param {boolean} props.configured Whether GitHub sign-in is set up.
 * @param {string} props.returnTo Where to send them once they are signed in.
 * @returns {unknown} The rendered page.
 */
export const SignInRequired = ({ counts, configured, returnTo }) => (
  <Layout title="Sign in" counts={counts} active={null} showSubmit={false}>
    <h1 class="text-3xl sm:text-4xl">Sign in</h1>
    {configured ? (
      <>
        <p class="mt-3 max-w-2xl text-muted">
          Contributing to the catalogue needs an account, so that a reviewer
          can see who sent a dataset and ask about it. Reading the catalogue
          never does.
        </p>
        <p class="mt-5">
          <a
            href={`${BASE}/login?return=${encodeURIComponent(returnTo)}`}
            class="btn no-underline"
          >
            Sign in with GitHub
          </a>
        </p>
        <p class="mt-4 max-w-2xl text-sm text-muted">
          Syndex reads your GitHub username and email address and nothing else.
          It asks for no access to any repository.
        </p>
      </>
    ) : (
      <p class="mt-3 max-w-2xl text-muted">
        Signing in is not available yet. In the meantime, open an issue on{" "}
        <a
          href="https://github.com/synthesizer-project/synthesizer/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          the Synthesizer repository
        </a>{" "}
        describing the dataset, and a maintainer will arrange to take the file.
      </p>
    )}
  </Layout>
);

/**
 * Asking for permission to submit.
 *
 * A new account cannot submit, because an account that could would leave the
 * queue as open to being filled as it was before there were accounts. What it
 * can do is say who it is and what it has, which is what a reviewer reads
 * before granting access.
 *
 * @param {object} props Component props.
 * @param {object} props.counts Tab counts for the header.
 * @param {object} props.user The signed-in account.
 * @param {boolean} props.sent Whether a request was just made.
 * @param {string | null} props.error Why the request was not accepted.
 * @returns {unknown} The rendered page.
 */
export const RequestAccess = ({ counts, user, sent = false, error = null }) => {
  const allowed = user.role !== "pending";
  const waiting = !allowed && user.access_requested_at !== null;

  return (
    <Layout title="Request access" counts={counts} active={null} showSubmit={false}>
      <h1 class="text-3xl sm:text-4xl">
        {allowed ? "You can submit datasets" : "Request submit access"}
      </h1>

      {allowed && (
        <>
          <p class="mt-3 max-w-2xl text-muted">
            Your account is a {user.role}, so you already have what this page
            asks for.
          </p>
          <p class="mt-5">
            <a href={`${BASE}/submit`} class="btn no-underline">
              Submit a dataset
            </a>
          </p>
        </>
      )}

      {!allowed && (
        <p class="mt-3 max-w-2xl text-muted">
          Anyone can read the catalogue, but sending a file to it needs a
          maintainer to say yes first. That is what keeps the queue a queue of
          real datasets. Say what you would like to contribute and someone will
          look.
        </p>
      )}

      {waiting && (
        <div role="status" class="card mt-5 max-w-2xl border-accent-light p-5">
          <p class="label-caps text-accent-light">
            {sent ? "Request sent" : "Request waiting"}
          </p>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Asked on {date(user.access_requested_at)}. A maintainer will be in
            touch through GitHub. Sending it again replaces what you wrote
            rather than joining the queue twice.
          </p>
        </div>
      )}

      {error !== null && (
        <p role="alert" class="mt-4 rounded border border-accent-light p-3 text-sm">
          {error}
        </p>
      )}

      {!allowed && (
        <form
          method="post"
          action={`${BASE}/access`}
          class="card mt-4 grid max-w-2xl gap-4 p-4"
        >
          <Field
            label="What you would like to contribute"
            name="note"
            rows="4"
            maxlength="2000"
            required
            hint={
              "A sentence or two: what the data is, roughly how large, and " +
              "how it was produced. Enough for a maintainer to recognise it."
            }
          />
          <div>
            <button type="submit" class="btn">
              {waiting ? "Update request" : "Request access"}
            </button>
          </div>
        </form>
      )}

      <p class="mt-6 text-sm text-muted">
        Signed in as {user.login}
        {user.name === null ? "" : ` (${user.name})`}.
      </p>
    </Layout>
  );
};

/**
 * How many citation rows are rendered without being asked for.
 *
 * One. Most submissions need one or none, and four empty boxes read as four
 * things somebody has failed to fill in. `submit.js` adds more on request,
 * which costs nothing that was not already spent: sending the file needs
 * JavaScript too, so a browser without it cannot complete a submission
 * whatever this number is.
 */
const CITATION_ROWS = 1;

/**
 * A question whose answer reveals the fields it applies to.
 *
 * The panel is hidden by CSS rather than by script, so it works with
 * JavaScript disabled like the rest of the portal -- and better than an htmx
 * version would, which with no script would have to show everything at once.
 *
 * A hidden field still submits, so the server reads the tick rather than the
 * fields: somebody who fills a box and then unticks the question has changed
 * their mind, and the tick is the answer to honour.
 *
 * @param {object} props Component props.
 * @param {string} props.name The checkbox's field name.
 * @param {string} props.question What is being asked.
 * @param {boolean} props.checked Whether it was answered yes already.
 * @param {unknown} props.children The fields it reveals.
 * @returns {unknown} The rendered question.
 */
const Gate = ({ name, question, checked = false, children }) => (
  <div class="sm:col-span-2">
    <input
      type="checkbox"
      id={name}
      name={name}
      value="yes"
      checked={checked}
      class="peer mr-2 align-middle accent-accent-light"
    />
    <label for={name} class="align-middle text-sm">
      {question}
    </label>
    <div class="mt-4 hidden peer-checked:block">{children}</div>
  </div>
);

export const Submit = ({
  counts,
  open,
  user,
  limit,
  mine = [],
  values = {},
  errors = [],
}) => {
  const rows = values.citation_rows ?? [];

  return (
    <Layout title="Submit a dataset" counts={counts} active={null} showSubmit={false}>
      <h1 class="text-3xl sm:text-4xl">Submit a dataset</h1>
      <p class="mt-3 max-w-2xl text-muted">
        Describe it, then send the file. A maintainer reads every submission
        before anything reaches the catalogue.
      </p>
      {open && (
        <>
          <p class="mt-2 max-w-2xl text-sm text-muted">
            Submitting as {user.login}
            {user.email === null ? "" : ` (${user.email})`}. Uploads are
            limited to {size(limit)}. Fields marked{" "}
            <span aria-hidden="true">*</span> are required.
          </p>
          <p class="mt-2 max-w-2xl text-sm text-muted">
            Install the tooling with{" "}
            <code>pip install synthesizer-syndex</code> and run{" "}
            <code>syndex-check YOUR-FILE</code> in the CLI to ensure your file
            will pass checks.
          </p>
        </>
      )}

      {!open && (
        <div role="status" class="card mt-5 max-w-2xl border-accent-light p-5">
          <p class="label-caps text-accent-light">Not open yet</p>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Submission is not accepting uploads yet. Open an issue on{" "}
            <a
              href="https://github.com/synthesizer-project/synthesizer/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              the Synthesizer repository
            </a>{" "}
            and a maintainer will arrange to take the file.
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" class="mt-4 rounded border border-accent-light p-3 text-sm">
          <p class="mb-1">This submission was not accepted:</p>
          <ul class="list-disc pl-5">
            {errors.map((message) => (
              <li>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <form
          id="submit-form"
          method="post"
          action={`${BASE}/submit`}
          // Read by submit.js to swap the placeholders when the type changes.
          // An attribute rather than a script tag: attribute values are
          // entity-decoded by the parser, and a script's text is not, so an
          // ampersand in an example would arrive as "&amp;".
          data-examples={JSON.stringify(TYPE_EXAMPLES)}
          class="mt-6 max-w-3xl"
        >
          <fieldset class="card grid gap-5 p-6 sm:grid-cols-2">
            <legend class="label-caps px-2">What it is</legend>

            {/* First and alone, because everything below reads differently
                depending on the answer -- and because an unanswered question
                is a better prompt than a field whose default is a guess. */}
            <label for="data_type" class="block sm:col-span-2">
              <span class="label-caps mb-1 block">
                Data type <span aria-hidden="true">*</span>
              </span>
              <select
                id="data_type"
                name="data_type"
                required
                class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
              >
                <option value="" disabled selected={!values.data_type}>
                  Select a data type…
                </option>
                {SUBMISSION_TYPES.map((type) => (
                  <option value={type} selected={values.data_type === type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>

            {/* The placeholders start on the commonest type and are swapped
                by submit.js when another is chosen. With no script they stay
                as they are, which is a real example rather than nothing. */}
            <div class="needs-type contents">
              <Field
                label="Catalogue name"
                name="name"
                value={values.name}
                required
                maxlength="128"
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder={DEFAULT_EXAMPLE.name}
                hint="Lowercase, digits and hyphens. No spaces. People download by this."
              />
              <Field
                label="Display name"
                name="display_name"
                value={values.display_name}
                required
                maxlength="256"
                placeholder={DEFAULT_EXAMPLE.display_name}
              />
              <div class="sm:col-span-2">
                <Field
                  label="Description"
                  name="description"
                  value={values.description}
                  rows="4"
                  maxlength="4000"
                  placeholder={DEFAULT_EXAMPLE.description}
                  hint="What it is, and what it is not suitable for."
                />
              </div>
            </div>
          </fieldset>

          <div class="needs-type">
            <fieldset class="card mt-5 p-6">
              <legend class="label-caps px-2">Citation</legend>
              <Gate
                name="has_citations"
                question="This data requires citations"
                checked={values.has_citations === true}
              >
                <p class="mb-3 text-sm text-muted">
                  Enter the ADS bibcodes for your citations.
                </p>
                <div id="citations" class="grid gap-2">
                  {Array.from({
                    length: Math.max(CITATION_ROWS, rows.length),
                  }).map((_, index) => (
                    <input
                      name="citation"
                      value={rows[index] ?? ""}
                      maxlength="19"
                      placeholder="2017PASA...34...58E"
                      class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5 font-mono text-sm"
                    />
                  ))}
                </div>
                {/* Revealed by submit.js: with no script there are already
                    more boxes than any ordinary submission needs. */}
                <button
                  type="button"
                  id="add-citation"
                  hidden
                  class="btn-quiet mt-2 cursor-pointer text-xs"
                >
                  Add another
                </button>
              </Gate>
            </fieldset>

            <fieldset class="card mt-5 p-6">
              <legend class="label-caps px-2">Licence</legend>
              <Gate
                name="has_licence"
                question="This data comes with a licence"
                checked={values.has_licence === true}
              >
                <Field
                  label="Licence"
                  name="licence"
                  value={values.licence}
                  maxlength="128"
                  placeholder="GPL-3.0-or-later"
                  hint="An SPDX identifier, such as GPL-3.0-or-later or CC-BY-4.0."
                />
              </Gate>
            </fieldset>

            <fieldset class="card mt-5 p-6">
              <legend class="label-caps px-2">Anything else</legend>
              <Field
                label="Notes for the reviewer"
                name="notes"
                value={values.notes}
                rows="3"
                maxlength="4000"
                hint="Anything worth knowing before the file is opened."
              />
            </fieldset>

            <button type="submit" class="btn mt-5">
              Continue to the upload
            </button>
          </div>
        </form>
      )}

      {mine.length > 0 && (
        <section class="mt-10">
          <h2 class="mb-4 text-xl">Your submissions</h2>
          <ul class="card divide-y divide-line p-0">
            {mine.map((submission) => (
              <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <a
                  href={`${BASE}/submit/${submission.upload_token}`}
                  class="font-mono text-sm"
                >
                  {submission.name}
                </a>
                <span class="flex-1 truncate text-sm text-muted">
                  {submission.display_name}
                </span>
                <span class="text-xs text-muted">
                  {submission.uploaded_at === null
                    ? "no file sent yet"
                    : date(submission.submitted_at)}
                </span>
                <StateBadge state={submission.state} />
                <CheckBadge state={submission.validation_state} />
                <a
                  href={`${BASE}/submit?like=${submission.upload_token}`}
                  aria-label={`Start a new submission like ${submission.name}`}
                  title="Submit again with these details"
                  class="btn-quiet inline-flex items-center gap-1.5 px-2 py-1 text-xs no-underline"
                >
                  <ResubmitIcon />
                  Resubmit
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {open && <script src={`${BASE}/static/submit.js`} defer></script>}
    </Layout>
  );
};

/**
 * The page that takes the bytes.
 *
 * Two ways up, because one size of file does not fit both: a presigned PUT
 * from the browser for anything under 1 GB, which is 233 of the
 * catalogue's 244 datasets, and an S3 client for the eleven that are larger,
 * where multipart and resumption matter and a browser tab is the wrong
 * place to be holding 26 GiB.
 *
 * Whichever is used, the Worker then looks in the bucket itself rather than
 * believing a report of success, which is also why the confirm button is an
 * ordinary form: someone who uploaded with rclone presses it by hand.
 */
export const Upload = ({ counts, submission, partSize, maxParts }) => {
  const uploaded = submission.uploaded_at !== null;

  return (
    <Layout
      title={uploaded ? "Submission complete" : "Send the file"}
      counts={counts}
      active={null}
      showSubmit={false}
    >
      <h1 class="text-3xl sm:text-4xl">
        {uploaded ? "Submission complete" : "Send the file"}
      </h1>
      <p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span class="font-mono break-all text-text">{submission.name}</span>
        <span>submission {submission.submission_id}</span>
        <StateBadge state={uploaded ? submission.state : "no file yet"} />
      </p>

      {uploaded ? (
        <>
          <Section title="What arrived">
            <Fields
              entries={[
                ["file", <span class="font-mono">{submission.filename}</span>],
                ["size", size(submission.uploaded_size_bytes)],
                ["received", date(submission.uploaded_at)],
              ]}
            />
          </Section>

          {submission.reviewed_at !== null && (
            <Section
              title={
                submission.state === "approved"
                  ? "Approved"
                  : "Not accepted"
              }
            >
              <Fields
                entries={[
                  ["decided", date(submission.reviewed_at)],
                  ["reviewer said", submission.reviewer_note],
                ]}
              />
              {submission.state === "rejected" && (
                <p class="mt-3 text-sm text-muted">
                  Fix what is described above and submit it again from{" "}
                  <a href={`${BASE}/submit?like=${submission.upload_token}`}>
                    your submissions
                  </a>
                  , which fills the form in from this one.
                </p>
              )}
            </Section>
          )}

          <CheckReport submission={submission} forContributor />
          <p class="mt-4 text-sm">
            <a href={`${BASE}/submit`}>Your submissions</a>
          </p>
        </>
      ) : (
        <>
          <Section title="From this browser">
            <p class="mb-4 text-sm text-muted">
              Up to {size(partSize * maxParts)} maximum. If your file exceeds
              this, use the command line option below.
            </p>
            {/* Revealed by upload.js, which is also what sends the file: a
                browser running none is never shown a picker that could not
                do anything with what it picked. */}
            {/* One button in one place: it chooses a file, and once there is
                one to send it becomes the thing that sends it. Changing your
                mind is a reload, which clears the selection anyway. */}
            <div id="picker" hidden class="flex flex-wrap items-center gap-3">
              <input type="file" id="pick" class="sr-only" />
              <label
                for="pick"
                id="pick-label"
                class="btn w-36 cursor-pointer text-center"
              >
                Choose file
              </label>
              <button
                type="button"
                id="send"
                hidden
                disabled
                data-part-url={`${BASE}/submit/${submission.upload_token}/part`}
                data-part-size={String(partSize)}
                data-max-parts={String(maxParts)}
                class="btn w-36 text-center"
              >
                Upload
              </button>
              <span id="chosen" class="text-sm text-muted">
                No file chosen
              </span>
            </div>
            {/* Revealed by upload.js when a file will not fit. A line of
                status text is too quiet for the one case where the page
                cannot do what was asked of it. */}
            <div
              id="too-large"
              hidden
              role="alert"
              class="mt-4 rounded border border-accent-light p-4 text-sm"
            >
              <p class="label-caps text-accent-light">
                Too large to upload via the browser
              </p>
              <p id="too-large-detail" class="mt-2 leading-relaxed text-muted"></p>
            </div>
            <progress id="progress" hidden value="0" class="mt-4 w-full">
              0%
            </progress>
            <p class="mt-2 flex items-center gap-2 text-sm">
              {/* Turning whenever a request is in flight. The bar says how
                  far along the transfer is; this says it is still going,
                  which is the question somebody watching actually has. */}
              <span id="spinner" hidden class="spinner" aria-hidden="true"></span>
            </p>
            <p id="upload-status" role="status" class="text-sm">
              <noscript>
                Sending a file needs JavaScript. Ask a maintainer to take it
                another way.
              </noscript>
            </p>
          </Section>

          <Section title="From a machine that already has the file">
            <p class="text-sm text-muted">
              Work in progress. Use the browser for now.
            </p>
            <p class="mt-3 text-xs text-muted">
              When it exists it will take this submission's token, so the file
              is attached to what you have already described rather than
              arriving as something separate:
            </p>
            <div class="mt-2">
              <Command>
                syndex submit {submission.upload_token} YOUR-FILE
              </Command>
            </div>
          </Section>

          {/* Submitted by upload.js when the last piece lands. No button:
              pressing one by hand only ever asked the Worker to look in the
              bucket, which it does anyway the moment there is a reason to. */}
          <form
            method="post"
            action={`${BASE}/submit/${submission.upload_token}/complete`}
            id="confirm"
          >
            <input type="hidden" name="expected_size" id="expected-size" />
          </form>
        </>
      )}
      <script src={`${BASE}/static/upload.js`} defer></script>
    </Layout>
  );
};

/**
 * Told to someone whose file arrived the wrong size.
 *
 * The one failure a transfer of this length actually has: it stopped part way
 * and nothing said so. Comparing what the sender sent against what the bucket
 * holds catches it without asking anybody to run shasum by hand, which was
 * the old answer and one most people skipped.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Truncated = ({ counts, submission, arrived, expected }) => (
  <Layout title="The file is incomplete" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">The file is incomplete</h1>
    <p class="mt-3 max-w-2xl text-muted">
      {size(arrived)} arrived, out of {size(expected)}. The transfer stopped
      part way, so the submission has not been marked as having its file.
    </p>
    <p class="mt-4 max-w-2xl text-muted">
      Send it again from the start: the pieces already there are replaced
      rather than added to.
    </p>
    <p class="mt-4">
      <a href={`${BASE}/submit/${submission.upload_token}`}>
        Back to the upload
      </a>
    </p>
  </Layout>
);

/** Told to someone whose upload has not turned up. */
export const NothingArrived = ({ counts, submission }) => (
  <Layout title="Nothing arrived" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Nothing arrived</h1>
    <p class="mt-3 max-w-2xl">
      There is no file under this submission yet. If an upload is still
      running, let it finish and press the button again. If it stopped part
      way, start it again and it will carry on from where it got to: the
      pieces that already arrived are kept, whichever way you sent them.
    </p>
    <p class="mt-4">
      <a href={`${BASE}/submit/${submission.upload_token}`}>
        Back to the upload
      </a>
    </p>
  </Layout>
);

/**
 * The review queue.
 *
 * The one page in the portal that writes. Approving records the decision and
 * prints the command that publishes the file: the Worker never parses HDF5
 * and never writes to R2, so publication stays with the tooling that
 * validates, hashes and registers in one transaction.
 */
/**
 * One fact about a submission, in a row of them.
 *
 * @param {object} props Component props.
 * @param {string} props.label What it is.
 * @param {unknown} props.children The value.
 * @returns {unknown} The rendered fact.
 */
const Fact = ({ label, children }) => (
  <div>
    <span class="label-caps block text-xs">{label}</span>
    <span class="text-sm">{children}</span>
  </div>
);

/**
 * What state a submission is in, said in a word and a colour.
 *
 * @param {object} props Component props.
 * @param {string} props.state The submission's state.
 * @returns {unknown} The rendered badge.
 */
const StateBadge = ({ state }) => (
  <span
    class={`rounded-full px-2.5 py-0.5 text-xs ${
      state === "pending"
        ? "bg-accent-light text-bg"
        : state === "approved"
          ? "border border-accent-light text-accent-light"
          : "border border-line text-muted"
    }`}
  >
    {state}
  </span>
);

/**
 * One waiting submission, summarised to what decides whether to open it.
 *
 * Four facts and a way in. The description, the citations, the digest and the
 * commands all live on the submission's own page: a queue is for choosing
 * what to look at, and a card carrying everything is not a summary.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @returns {unknown} The rendered card.
 */
const SubmissionCard = ({ submission }) => {
  const arrived = submission.uploaded_at !== null;

  return (
    <li>
      <a
        href={`${BASE}/review/${submission.submission_id}`}
        class="card card-link block p-6 text-text no-underline"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="font-mono text-lg break-all">{submission.name}</span>
          <StateBadge state={submission.state} />
          <CheckBadge state={submission.validation_state} />
        </div>
        <p class="mt-1 text-sm text-muted">{submission.display_name}</p>

        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>{submission.data_type}</span>
          <span class={arrived ? "" : "text-accent-light"}>
            {arrived ? size(submission.uploaded_size_bytes) : "no file yet"}
          </span>
          <span class="text-muted">{date(submission.submitted_at)}</span>
          <span class="text-muted">{submission.submitter_name}</span>
        </div>
      </a>
    </li>
  );
};

/**
 * What the checker made of a file, in a word and a colour.
 *
 * @param {object} props Component props.
 * @param {string | null} props.state The recorded validation state.
 * @returns {unknown} The rendered badge, or nothing when none has run.
 */
const CheckBadge = ({ state }) => {
  if (state === null || state === undefined) {
    return null;
  }
  const words = {
    running: "checking…",
    passed: "checks passed",
    failed: "checks failed",
    ambiguous: "needs categorising",
  };
  return (
    <span
      class={`rounded-full px-2.5 py-0.5 text-xs ${
        state === "failed"
          ? "bg-accent-light text-bg"
          : "border border-line text-muted"
      }`}
    >
      {words[state] ?? state}
    </span>
  );
};

/**
 * Everything the checker said, for a reviewer deciding on the strength of it.
 *
 * Errors first and in full: they are the reason a submission would be sent
 * back, and a reviewer who has to expand something to find out whether there
 * is a problem will eventually stop expanding it.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered report, or a note that none has run.
 */
const CheckReport = ({ submission, duplicate = null, forContributor = false }) => {
  const report = (() => {
    try {
      return JSON.parse(submission.validation_report_json ?? "null");
    } catch {
      return null;
    }
  })();

  return (
    <Section title="What the checker found">
      {duplicate !== null && (
        <p class="mb-4 rounded border border-accent-light p-3 text-sm">
          These are the same bytes as <strong>{duplicate.name}</strong>, which
          is already {duplicate.published ? "in the catalogue" : "in the queue"}
          . There may be nothing here to publish.
        </p>
      )}

      {submission.validation_state === null &&
        (forContributor ? (
          <p class="text-sm text-muted">
            No check has run on this file. A reviewer will read it either way.
          </p>
        ) : (
          <p class="text-sm text-muted">
            No check has run. Fetch the file and run <code>syndex-check</code>{" "}
            on it yourself.
          </p>
        ))}
      {submission.validation_state === "running" && (
        <p class="text-sm text-muted">
          A check is running. Reload in a minute or two.
        </p>
      )}

      {report !== null && (
        <>
          <Fields
            entries={[
              ["verdict", report.state],
              ["detected as", submission.detected_data_type],
              ["because", report.reason],
              ["format", report.format],
              [
                "sha256",
                submission.sha256 === null ? null : (
                  <span class="font-mono text-xs break-all">
                    {submission.sha256}
                  </span>
                ),
              ],
              ["checked", date(submission.validated_at)],
            ]}
          />

          {(report.errors ?? []).length > 0 && (
            <ul class="mt-4 list-disc space-y-1 pl-5 text-sm">
              {report.errors.map((error) => (
                <li>{error}</li>
              ))}
            </ul>
          )}

          {(report.warnings ?? []).length > 0 && (
            <details class="mt-4">
              <summary class="cursor-pointer text-sm text-muted">
                {report.warnings.length} warning
                {report.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {report.warnings.map((warning) => (
                  <li>{warning}</li>
                ))}
              </ul>
            </details>
          )}

          {Object.keys(report.detected ?? {}).length > 0 && (
            <details class="mt-3">
              <summary class="cursor-pointer text-sm text-muted">
                What was read out of the file
              </summary>
              <div class="mt-2">
                <Fields
                  entries={Object.entries(report.detected).map(
                    ([key, value]) => [
                      key,
                      Array.isArray(value)
                        ? value
                            .map((item) =>
                              typeof item === "object" && item !== null
                                ? `${item.name}[${item.count}]`
                                : String(item),
                            )
                            .join(", ")
                        : typeof value === "object" && value !== null
                          ? JSON.stringify(value)
                          : value,
                    ],
                  )}
                />
              </div>
            </details>
          )}
        </>
      )}
    </Section>
  );
};

/**
 * One submission, as much of it as is worth reading.
 *
 * Ordered by what a reviewer actually decides on: what it claims to be, who
 * sent it, and whether a file of a plausible size arrived. The prose the
 * contributor wrote follows, and only when they wrote any. What is left out
 * matters as much: the R2 key is in the download command already, and
 * repeating it above only makes the things that need reading harder to find.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @param {string} props.bucket The submissions bucket's name.
 * @returns {unknown} The rendered submission.
 */
const Submission = ({ submission, bucket }) => {
  const pending = submission.state === "pending";
  const arrived = submission.uploaded_at !== null;

  return (
    <section class="card mb-6 p-6">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="font-mono text-lg break-all">{submission.name}</h3>
        <StateBadge state={submission.state} />
        <CheckBadge state={submission.validation_state} />
        <span class="text-sm text-muted">{submission.display_name}</span>
      </div>

      <div class="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="type">{submission.data_type}</Fact>
        <Fact label="size">
          {arrived ? (
            size(submission.uploaded_size_bytes)
          ) : (
            <em class="text-muted">no file yet</em>
          )}
        </Fact>
        <Fact label="submitted">{date(submission.submitted_at)}</Fact>
        <Fact label="by">
          {submission.submitter_name}
          {submission.submitter_email ? (
            <>
              {" "}
              <a
                href={`mailto:${submission.submitter_email}`}
                class="text-xs break-all"
              >
                {submission.submitter_email}
              </a>
            </>
          ) : null}
        </Fact>
      </div>

      {arrived && (
        <p class="mt-3 text-xs text-muted">
          sha256{" "}
          {submission.declared_sha256 === null ? (
            <em>not declared, so a truncated transfer will not be caught</em>
          ) : (
            <span class="font-mono break-all">{submission.declared_sha256}</span>
          )}
        </p>
      )}

      <Fields
        entries={[
          ["description", submission.description],
          ["citations", submission.citations],
          ["licence", submission.licence],
          ["notes", submission.notes],
          ["reviewer note", submission.reviewer_note],
          ["reviewed", submission.reviewed_at ? date(submission.reviewed_at) : null],
        ]}
      />

      {pending && arrived && (
        // syndex-upload publishes a local file: it opens the HDF5, verifies
        // the digest and registers R2 and D1 in one transaction, none of
        // which a Worker can do. So the bytes come down first, as a separate
        // and visible step.
        <details class="mt-4">
          <summary class="cursor-pointer text-sm text-muted">
            Fetch and publish it
          </summary>
          <div class="mt-3">
            <Command>
              npx wrangler r2 object get {bucket}/{submission.r2_key} --file{" "}
              {submission.name} --remote
            </Command>
          </div>
          <div class="mt-2">
            <Command>syndex-check {submission.name}</Command>
          </div>
          <div class="mt-2">
            <Command>
              syndex-upload {submission.name} --data-type{" "}
              {submission.data_type === "other"
                ? "CHOOSE-A-TYPE"
                : submission.data_type}
            </Command>
          </div>
          {submission.data_type === "other" && (
            <p class="mt-2 text-xs text-muted">
              Submitted as <strong>other</strong>, so the type is yours to
              choose. It may be one the catalogue does not have yet.
            </p>
          )}
        </details>
      )}

      {pending && (
        <form
          method="post"
          action={`${BASE}/review/${submission.submission_id}`}
          class="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
        >
          <label for={`note-${submission.submission_id}`} class="min-w-48 flex-1">
            <span class="label-caps mb-1 block">Note</span>
            <input
              id={`note-${submission.submission_id}`}
              name="reviewer_note"
              maxlength="1000"
              class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
            />
          </label>
          <button type="submit" name="decision" value="approved" class="btn">
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            class="btn-quiet"
          >
            Reject
          </button>
        </form>
      )}
    </section>
  );
};

/**
 * How many accounts the review page shows before sending you elsewhere.
 *
 * The review page is for deciding things. A list of everyone who has ever
 * signed in is reference material, and past a handful it pushes the queue --
 * the thing that actually needs attention -- off the screen.
 */
export const ACCOUNTS_SHOWN = 10;

/** An up arrow, for starting a new submission from one already sent. */
const ResubmitIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="h-4 w-4"
  >
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);

/** A pencil, for the control that opens an account to be edited. */
const PencilIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="h-4 w-4"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

/**
 * An overlay, opened by a button and closed by the browser.
 *
 * The native popover attribute rather than a dialog: `showModal()` needs
 * script, and the review page should not stop working because one file failed
 * to load. This way the top layer, the backdrop, Escape and clicking away are
 * all the browser's job, and there is no JavaScript here at all.
 *
 * `m-auto` is load-bearing. Tailwind's reset sets `margin: 0` on everything,
 * and an author rule beats the browser's own `[popover] { margin: auto }`
 * whatever their specificity -- so without it the overlay pins to the
 * top-left corner instead of centring. The dialogs in the layout carry it for
 * the same reason.
 *
 * @param {object} props Component props.
 * @param {string} props.id What the opening button points at.
 * @param {string} props.title What the overlay is for.
 * @param {unknown} props.children Its contents.
 * @returns {unknown} The rendered overlay.
 */
const Overlay = ({ id, title, children }) => (
  <div
    id={id}
    popover="auto"
    class="card m-auto max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-6 text-text shadow-2xl backdrop:bg-bg/85"
  >
    <div class="mb-4 flex items-start justify-between gap-4">
      <h3 class="text-lg">{title}</h3>
      <button
        type="button"
        popovertarget={id}
        popovertargetaction="hide"
        aria-label="Close"
        class="btn-quiet cursor-pointer px-2 py-0.5 text-lg leading-none"
      >
        &times;
      </button>
    </div>
    {children}
  </div>
);

/**
 * The control that changes one account's role.
 *
 * @param {object} props Component props.
 * @param {object} props.person The account being changed.
 * @param {string[]} props.grantable Roles the viewer may set.
 * @param {object} props.viewer The reviewer reading the page.
 * @param {string} props.from Which page to render once it is done.
 * @returns {unknown} The rendered form, or a note in place of one.
 */
const RoleForm = ({ person, grantable, viewer, from }) => {
  // Changing your own role is refused rather than hidden, since the reason is
  // not obvious: it is what stops the last admin removing the authority
  // needed to restore it.
  if (person.user_id === viewer.user_id) {
    return <p class="text-sm text-muted">This is your own account.</p>;
  }
  if (!grantable.includes(person.role)) {
    return (
      <p class="text-sm text-muted">
        Only an admin can change a {person.role}.
      </p>
    );
  }

  return (
    <form
      method="post"
      action={`${BASE}/review/users/${person.user_id}`}
      class="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="from" value={from} />
      <label for={`role-${person.user_id}`} class="flex-1">
        <span class="label-caps mb-1 block">Role</span>
        <select
          id={`role-${person.user_id}`}
          name="role"
          class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
        >
          {grantable.map((role) => (
            <option value={role} selected={role === person.role}>
              {role}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" class="btn">
        Save
      </button>
    </form>
  );
};

/**
 * One account, as a row with the way to change it on the right.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered row and its overlay.
 */
const AccountRow = ({ person, grantable, viewer, from }) => (
  <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
    <span class="font-mono text-sm">{person.login}</span>
    <span class="flex-1 truncate text-sm text-muted">{person.name}</span>
    <span class="label-caps">{person.role}</span>
    <button
      type="button"
      popovertarget={`account-${person.user_id}`}
      aria-label={`Edit ${person.login}`}
      class="btn-quiet inline-flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs"
    >
      <PencilIcon />
      Edit
    </button>
    <Overlay id={`account-${person.user_id}`} title={person.login}>
      <Fields
        entries={[
          ["name", person.name],
          ["role", person.role],
          ["joined", person.created_at ? date(person.created_at) : null],
          [
            "last seen",
            person.last_seen_at ? date(person.last_seen_at) : null,
          ],
          [
            "asked for access",
            person.access_requested_at
              ? date(person.access_requested_at)
              : null,
          ],
        ]}
      />
      <div class="mt-5 border-t border-line pt-5">
        <RoleForm
          person={person}
          grantable={grantable}
          viewer={viewer}
          from={from}
        />
        <RevokeForm person={person} grantable={grantable} viewer={viewer} from={from} />
      </div>
    </Overlay>
  </li>
);

/**
 * Sign an account out and leave it with nothing.
 *
 * A role change alone already takes effect at once, because the role is read
 * from the table on every request rather than carried in the cookie. This is
 * for when that is not enough: a shared machine, or a credential somebody
 * else now has. It ends every session as well as the role.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered form, or nothing when it does not apply.
 */
const RevokeForm = ({ person, grantable, viewer, from }) => {
  if (
    person.user_id === viewer.user_id ||
    !grantable.includes(person.role) ||
    person.role === "pending"
  ) {
    return null;
  }

  return (
    <form
      method="post"
      action={`${BASE}/review/users/${person.user_id}/revoke`}
      class="mt-5 border-t border-line pt-5"
    >
      <input type="hidden" name="from" value={from} />
      <p class="mb-3 text-xs leading-relaxed text-muted">
        Ends every session {person.login} has and leaves them with no role.
        They can sign in again, and will be able to do nothing until a role is
        granted.
      </p>
      <button type="submit" class="btn-quiet cursor-pointer text-xs">
        Sign out and revoke
      </button>
    </form>
  );
};

/**
 * One person waiting for access, as a row with the way to answer on the right.
 *
 * What they wrote lives in the overlay rather than in the row. It is the thing
 * a decision turns on, so it belongs next to the control that decides, and a
 * queue of rows each carrying a paragraph is not a queue anybody scans.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered row and its overlay.
 */
const RequestRow = ({ person, grantable, viewer, from }) => (
  <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
    <span class="font-mono text-sm">{person.login}</span>
    <span class="flex-1 truncate text-sm text-muted">{person.name}</span>
    <span class="text-xs text-muted">
      asked {date(person.access_requested_at)}
    </span>
    <button
      type="button"
      popovertarget={`request-${person.user_id}`}
      class="btn cursor-pointer px-3 py-1 text-xs"
    >
      Respond
    </button>
    <Overlay
      id={`request-${person.user_id}`}
      title={`${person.login} wants to contribute`}
    >
      {person.access_request_note !== null && (
        <blockquote class="border-l-2 border-line pl-4 text-sm leading-relaxed">
          {person.access_request_note}
        </blockquote>
      )}
      <p class="mt-4 text-xs text-muted">
        Granting any role answers the request. Leaving them pending also
        clears it, so they can ask again with more to say.
      </p>
      <div class="mt-5 border-t border-line pt-5">
        <RoleForm
          person={person}
          grantable={grantable}
          viewer={viewer}
          from={from}
        />
      </div>
    </Overlay>
  </li>
);

/**
 * A section heading, with whatever leads out of it on the opposite side.
 *
 * @param {object} props Component props.
 * @param {string} props.title What the section is.
 * @param {unknown} props.action What leads out of it, or nothing.
 * @returns {unknown} The rendered heading row.
 */
const SectionHead = ({ title, action = null }) => (
  <div class="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <h2 class="text-xl">{title}</h2>
    {action}
  </div>
);

/** Weakest first, so a tally reads in the order roles are granted. */
const ROLE_ORDER = ["pending", "contributor", "reviewer", "admin"];

/**
 * Which roles one account may grant.
 *
 * The server enforces this too -- this only keeps a page from offering what
 * it would then refuse.
 *
 * @param {object} viewer The account doing the granting.
 * @returns {string[]} The roles it may set.
 */
const grantableFor = (viewer) =>
  viewer.role === "admin"
    ? ["pending", "contributor", "reviewer", "admin"]
    : ["pending", "contributor"];

/**
 * Everyone who has ever signed in, on a page of their own.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Accounts = ({ counts, people, viewer, note = null }) => {
  // Counted here rather than in SQL: the rows are already loaded, and a
  // second round trip to learn what is in front of you is a poor trade.
  const byRole = people.reduce((tally, person) => {
    tally[person.role] = (tally[person.role] ?? 0) + 1;
    return tally;
  }, {});

  return (
    <Layout title="Accounts" counts={counts} active={null}>
      <p class="mb-4 text-sm">
        <a href={`${BASE}/review`}>Back to the queue</a>
      </p>
      <h1 class="mb-3 text-3xl sm:text-4xl">Accounts</h1>
      <p class="mb-8 max-w-2xl text-muted">
        Everyone who has signed in. Here you can change what each of them is
        allowed to do.
      </p>

      {note !== null && (
        <p role="status" class="mb-8 rounded border border-accent-light p-3 text-sm">
          {note}
        </p>
      )}

      <p class="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        <span>{people.length} accounts</span>
        {ROLE_ORDER.filter((role) => byRole[role] > 0).map((role) => (
          <span>
            {byRole[role]} {role}
            {byRole[role] === 1 ? "" : "s"}
          </span>
        ))}
      </p>

      <ul class="card divide-y divide-line p-0">
        {people.map((person) => (
          <AccountRow
            person={person}
            grantable={grantableFor(viewer)}
            viewer={viewer}
            from="accounts"
          />
        ))}
      </ul>
    </Layout>
  );
};

/**
 * The review queue.
 *
 * A way in to the things that need deciding, rather than the deciding itself.
 * Three kinds of thing wait here and they are not the same kind: people
 * nobody has answered, files nobody has read, and the record of everything
 * already settled. Each is summarised to what decides whether to open it, and
 * opening it is a page of its own -- which is what stops one long submission
 * with a lot to say from burying the six behind it.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Review = ({
  counts,
  submissions,
  approvedCount = 0,
  rejectedCount = 0,
  recent = [],
  people = [],
  accountCount = 0,
  viewer,
  note = null,
}) => {
  const grantable = grantableFor(viewer);
  const asking = people.filter((person) => person.access_requested_at !== null);
  const holding = people.filter((person) => person.access_requested_at === null);

  return (
    <Layout title="Review queue" counts={counts} active={null}>
      <h1 class="mb-8 text-3xl sm:text-4xl">Review queue</h1>

      {note !== null && (
        <p role="status" class="mb-8 rounded border border-accent-light p-3 text-sm">
          {note}
        </p>
      )}

      {asking.length > 0 && (
        <section class="mb-10">
          <SectionHead title={`Waiting for access (${asking.length})`} />
          <ul class="card divide-y divide-line p-0">
            {asking.map((person) => (
              <RequestRow
                person={person}
                grantable={grantable}
                viewer={viewer}
                from="review"
              />
            ))}
          </ul>
        </section>
      )}

      <section class="mb-10">
        <SectionHead
          title={
            submissions.length === 0
              ? "Nothing waiting to be read"
              : `Waiting to be read (${submissions.length})`
          }
        />
        {submissions.length === 0 ? (
          <p class="text-muted">
            Every submission has been decided. Contributors are told the
            outcome on their own submission page.
          </p>
        ) : (
          <ul class="grid gap-6 sm:grid-cols-2">
            {submissions.map((submission) => (
              <SubmissionCard submission={submission} />
            ))}
          </ul>
        )}
      </section>

      {approvedCount + rejectedCount > 0 && (
        <section class="mb-10">
          <SectionHead title="Past submissions" />
          <a
            href={`${BASE}/review/previous`}
            class="card card-link block p-6 text-text no-underline"
          >
            <div class="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <span class="block text-2xl tabular-nums">{approvedCount}</span>
                <span class="label-caps">approved</span>
              </div>
              <div>
                <span class="block text-2xl tabular-nums">{rejectedCount}</span>
                <span class="label-caps">rejected</span>
              </div>
            </div>
            {recent.length > 0 && (
              <ul class="mt-5 grid gap-2 border-t border-line pt-4 text-sm">
                {recent.map((submission) => (
                  <li class="flex flex-wrap items-baseline gap-x-3">
                    <span class="flex-1 font-mono break-all">
                      {submission.name}
                    </span>
                    <StateBadge state={submission.state} />
                    <span class="text-xs text-muted">
                      {date(submission.reviewed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </a>
        </section>
      )}

      {holding.length > 0 && (
        <section>
          <SectionHead
            title="Accounts"
            action={
              <a href={`${BASE}/accounts`} class="text-sm">
                {accountCount > ACCOUNTS_SHOWN
                  ? `All ${accountCount} accounts`
                  : "Manage accounts"}
              </a>
            }
          />
          <ul class="card divide-y divide-line p-0">
            {holding.slice(0, ACCOUNTS_SHOWN).map((person) => (
              <AccountRow
                person={person}
                grantable={grantable}
                viewer={viewer}
                from="review"
              />
            ))}
          </ul>
        </section>
      )}
    </Layout>
  );
};

/**
 * One submission, on a page of its own, with the decision on it.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const SubmissionReview = ({
  counts,
  submission,
  bucket,
  duplicate = null,
}) => (
  <Layout title={`Review ${submission.name}`} counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/review`}>Back to the queue</a>
    </p>
    <h1 class="mb-8 text-3xl break-all sm:text-4xl">{submission.name}</h1>
    <Submission submission={submission} bucket={bucket} />
    <CheckReport submission={submission} duplicate={duplicate} />
  </Layout>
);

/**
 * Everything already settled, on a page of its own.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const PreviousSubmissions = ({ counts, submissions, bucket }) => (
  <Layout title="Past submissions" counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/review`}>Back to the queue</a>
    </p>
    <h1 class="mb-8 text-3xl sm:text-4xl">Past submissions</h1>
    {submissions.length === 0 && (
      <p class="text-muted">Nothing has been decided yet.</p>
    )}
    {submissions.map((submission) => (
      <Submission submission={submission} bucket={bucket} />
    ))}
  </Layout>
);

export const NotFound = ({ counts, message }) => (
  <Layout title="Not found" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Not found</h1>
    <p class="mt-3 text-muted">{message}</p>
    <p class="mt-4">
      <a href={BASE}>Start again</a>
    </p>
  </Layout>
);
