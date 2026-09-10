/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The pages that are not a filtered table: the landing page, dataset
 * detail, the submission form and the review queue.
 */

import { TABS } from "./catalogue.js";
import { BROWSER_UPLOAD_LIMIT } from "./submissions.js";
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
  "cache",
];

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
const Section = ({ title, children }) => (
  <section class="card mb-5 p-6">
    <h2 class="mb-4 text-xl">{title}</h2>
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
  <div>
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
        <h1 class="mt-8 text-3xl leading-tight sm:text-4xl">
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
            <Section title="Citations">
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
                  {dataset.release_id ? (
                    <p class="mb-3 text-sm">
                      <a
                        href={`${DATA_API}/v1/releases/${dataset.release_id}/citations.bib`}
                      >
                        Download {citations.length === 1 ? "it" : `all ${citations.length}`}{" "}
                        as BibTeX
                      </a>
                    </p>
                  ) : null}
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
export const Submit = ({ counts, open, sitekey, values = {}, errors = [] }) => (
  <Layout title="Submit a dataset" counts={counts} active={null} showSubmit={false}>
    <h1 class="text-3xl sm:text-4xl">Submit a dataset</h1>
    <p class="mt-3 max-w-2xl text-muted">
      Describe the dataset, then send the file. A maintainer reads every
      submission, opens the file, and publishes it through the usual path, so
      nothing reaches the catalogue unread. You do not need an account.
    </p>

    {!open && (
      <div
        role="status"
        class="card mt-5 max-w-2xl border-accent-light p-5"
      >
        <p class="label-caps text-accent-light">Not open yet</p>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          Dataset submission is not accepting uploads yet. In the meantime,
          open an issue on{" "}
          <a
            href="https://github.com/synthesizer-project/synthesizer/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            the Synthesizer repository
          </a>{" "}
          describing the dataset, and a maintainer will arrange to take the
          file.
        </p>
      </div>
    )}

    {errors.length > 0 && (
      <div
        role="alert"
        class="mt-4 rounded border border-accent-light p-3 text-sm"
      >
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
        method="post"
        action={`${BASE}/submit`}
        class="card mt-4 grid max-w-3xl gap-4 p-4 sm:grid-cols-2"
      >
        <Field
          label="Catalogue name"
          name="name"
          value={values.name}
          required
          maxlength="128"
          pattern="[a-z0-9][a-z0-9-]*"
          hint="Lowercase, digits and hyphens. This is the name people download by."
        />
        <Field
          label="Display name"
          name="display_name"
          value={values.display_name}
          required
          maxlength="256"
        />
        <label for="data_type" class="block">
          <span class="label-caps mb-1 block">
            Data type <span aria-hidden="true">*</span>
          </span>
          <select
            id="data_type"
            name="data_type"
            required
            class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
          >
            {DATA_TYPES.map((type) => (
              <option value={type} selected={values.data_type === type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Licence"
          name="licence"
          value={values.licence}
          maxlength="128"
          hint="For example CC-BY-4.0."
        />
        <div class="sm:col-span-2">
          <Field
            label="Description"
            name="description"
            value={values.description}
            rows="3"
            maxlength="4000"
            hint="What the data is, and what it is not suitable for."
          />
        </div>
        <div class="sm:col-span-2">
          <Field
            label="Citations"
            name="citations"
            value={values.citations}
            rows="3"
            maxlength="4000"
            hint={
              "ADS bibcodes, one per line, such as 2017PASA...34...58E. " +
              "Include the model paper, the paper this grid was released in, " +
              "and the photoionisation code if it was processed through one. " +
              "The citation itself is fetched from ADS, so a bibcode is all " +
              "that is needed."
            }
          />
        </div>
        <Field
          label="Your name"
          name="submitter_name"
          value={values.submitter_name}
          required
          maxlength="128"
        />
        <Field
          label="Your email"
          name="submitter_email"
          value={values.submitter_email}
          type="email"
          required
          maxlength="256"
          hint="Only used to ask about this submission."
        />
        <div class="sm:col-span-2">
          <Field
            label="Notes for the reviewer"
            name="notes"
            value={values.notes}
            rows="3"
            maxlength="4000"
          />
        </div>
        {/* The queue is anonymous, so this is what stops a script filling
            it. Verification fails closed. */}
        <div class="sm:col-span-2">
          <div class="cf-turnstile" data-sitekey={sitekey}></div>
        </div>
        <div class="sm:col-span-2">
          <button type="submit" class="btn">
            Continue to the upload
          </button>
        </div>
      </form>
    )}
    {open && (
      <script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        defer
      ></script>
    )}
  </Layout>
);

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
export const Upload = ({ counts, submission, credentials }) => {
  const uploaded = submission.uploaded_at !== null;
  const complete = `${BASE}/submit/${submission.upload_token}/complete`;

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
      <p class="mt-3 max-w-2xl">
        <span class="font-mono">{submission.name}</span> is submission{" "}
        {submission.submission_id}, waiting for review.
        {uploaded
          ? " A maintainer will check the file and publish it."
          : " It is not in the queue properly until the file is here."}
      </p>
      <p class="mt-2 max-w-2xl text-sm text-muted">
        Keep this page's address. It is the only way back to this submission,
        and the only thing that authorises the upload.
      </p>

      {uploaded ? (
        <Section title="What arrived">
          <Fields
            entries={[
              ["file", <span class="font-mono">{submission.filename}</span>],
              ["size", size(submission.uploaded_size_bytes)],
              ["received", date(submission.uploaded_at)],
              [
                "sha256, as declared",
                submission.declared_sha256 === null ? null : (
                  <span class="font-mono text-xs break-all">
                    {submission.declared_sha256}
                  </span>
                ),
              ],
            ]}
          />
          <p class="mt-3 text-sm text-muted">
            The digest is checked where the file is opened, by the same
            publishing path that verifies every other release. If it does not
            match, a maintainer will email {submission.submitter_email}.
          </p>
        </Section>
      ) : (
        <>
          <Section title="From this browser">
            <p class="mb-3 text-sm text-muted">
              For files up to {size(BROWSER_UPLOAD_LIMIT)}. The file goes
              straight to storage, not through this site. One request, so it
              cannot resume: use the command below for anything large or on a
              connection you do not trust.
            </p>
            {/* Revealed by upload.js. A browser running no JavaScript is
                never shown a picker that could not do anything with the
                file it picked. */}
            <input
              type="file"
              id="pick"
              hidden
              class="block w-full text-sm"
            />
            <button
              type="button"
              id="send"
              hidden
              disabled
              data-mint={`${BASE}/submit/${submission.upload_token}/upload-url`}
              data-limit={String(BROWSER_UPLOAD_LIMIT)}
              class="btn mt-4"
            >
              Send this file
            </button>
            <progress id="progress" hidden value="0" class="mt-3 w-full">
              0%
            </progress>
            <p id="upload-status" role="status" class="mt-2 text-sm">
              <noscript>
                Sending a file from the browser needs JavaScript. Use the
                command below instead.
              </noscript>
            </p>
          </Section>

          <Section title="From a machine that already has the file">
            {credentials === null ? (
              <p class="text-sm text-muted">
                Credentials for a command-line upload could not be issued.
                Try the browser upload, or email a maintainer.
              </p>
            ) : (
              <>
                <p class="mb-3 text-sm text-muted">
                  Any size, and it resumes if it is interrupted. These
                  credentials can write to this one submission and nothing
                  else, and they expire in {credentials.hours} hours; reload
                  this page for a fresh set. rclone works the same way.
                </p>
                <Command>
                  AWS_ACCESS_KEY_ID={credentials.accessKeyId} \
                  {"\n"}AWS_SECRET_ACCESS_KEY={credentials.secretAccessKey} \
                  {"\n"}AWS_SESSION_TOKEN={credentials.sessionToken} \
                  {"\n"}aws s3 cp YOUR-FILE s3://{credentials.bucket}/
                  {credentials.prefix} \
                  {"\n"}  --endpoint-url {credentials.endpoint}
                </Command>
              </>
            )}
          </Section>

          <Section title="When the file is there">
            <form method="post" action={complete} id="confirm">
              <label for="declared_sha256" class="block max-w-xl">
                <span class="label-caps mb-1 block">sha256 of the file</span>
                <input
                  id="declared_sha256"
                  name="declared_sha256"
                  maxlength="64"
                  pattern="[0-9a-fA-F]{64}"
                  class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5 font-mono text-sm"
                />
                <span class="text-xs text-muted">
                  Optional, and worth the ten seconds:{" "}
                  <code>shasum -a 256 YOUR-FILE</code>. It is what catches a
                  transfer that finished but was truncated.
                </span>
              </label>
              <button
                type="submit"
                class="btn-quiet mt-4"
              >
                Check for the file
              </button>
            </form>
          </Section>
        </>
      )}
      <script src={`${BASE}/static/upload.js`} defer></script>
    </Layout>
  );
};

/** Told to someone whose upload has not turned up. */
export const NothingArrived = ({ counts, submission }) => (
  <Layout title="Nothing arrived" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Nothing arrived</h1>
    <p class="mt-3 max-w-2xl">
      There is no file under this submission yet. If an upload is still
      running, let it finish and press the button again. If it failed part
      way, start it again: an interrupted browser upload has to be repeated
      from the beginning, while the command-line one resumes.
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
export const Review = ({ counts, submissions, bucket, note = null }) => (
  <Layout title="Review queue" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Review queue</h1>
    {note !== null && (
      <p role="status" class="mt-3 rounded border border-accent-light p-3 text-sm">
        {note}
      </p>
    )}
    {submissions.length === 0 && (
      <p class="mt-4 text-muted">Nothing is waiting.</p>
    )}
    {submissions.map((submission) => (
      <Section title={submission.name}>
        <Fields
          entries={[
            ["state", submission.state],
            ["submitted", date(submission.submitted_at)],
            ["display name", submission.display_name],
            ["type", submission.data_type],
            ["licence", submission.licence],
            ["description", submission.description],
            ["citations", submission.citations],
            [
              "file",
              submission.uploaded_at === null ? (
                <em>no file uploaded yet</em>
              ) : (
                <span class="font-mono">{submission.filename}</span>
              ),
            ],
            [
              "size",
              submission.uploaded_at === null
                ? null
                : size(submission.uploaded_size_bytes),
            ],
            ["in bucket", submission.r2_key],
            [
              "sha256",
              submission.declared_sha256 === null ? (
                <em>not declared</em>
              ) : (
                <span class="font-mono text-xs break-all">
                  {submission.declared_sha256}
                </span>
              ),
            ],
            [
              "submitter",
              `${submission.submitter_name} <${submission.submitter_email}>`,
            ],
            ["notes", submission.notes],
            ["reviewer note", submission.reviewer_note],
          ]}
        />
        {submission.state === "pending" && (
          <>
            {/* syndex-upload publishes a local file: it opens the HDF5,
                verifies the digest and registers R2 and D1 in one
                transaction, none of which a Worker can do. So the bytes come
                down out of the submissions bucket first, as a separate and
                visible step. */}
            {submission.uploaded_at !== null && (
              <>
                <div class="mt-3">
                  <Command>
                    npx wrangler r2 object get {bucket}/{submission.r2_key}{" "}
                    --file {submission.filename} --remote
                  </Command>
                </div>
                <div class="mt-2">
                  <Command>
                    syndex-upload {submission.filename} --data-type{" "}
                    {submission.data_type}
                  </Command>
                </div>
              </>
            )}
            <form
              method="post"
              action={`${BASE}/review/${submission.submission_id}`}
              class="mt-3 flex flex-wrap items-end gap-3"
            >
              <label for={`note-${submission.submission_id}`} class="flex-1">
                <span class="label-caps mb-1 block">Note</span>
                <input
                  id={`note-${submission.submission_id}`}
                  name="reviewer_note"
                  maxlength="1000"
                  class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
                />
              </label>
              <button
                type="submit"
                name="decision"
                value="approved"
                class="btn"
              >
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
          </>
        )}
      </Section>
    ))}
  </Layout>
);

/** Anything that is not there. */
export const NotFound = ({ counts, message }) => (
  <Layout title="Not found" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Not found</h1>
    <p class="mt-3 text-muted">{message}</p>
    <p class="mt-4">
      <a href={BASE}>Start again</a>
    </p>
  </Layout>
);
