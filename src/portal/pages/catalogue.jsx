/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Reading the catalogue: the landing page, the results page, and one dataset.
 *
 * Everything here is public and anonymous. No page in this file asks who is
 * reading it, and none of them writes anything.
 */

import { BASE, DATA_API } from "../base.js";
import { TABS } from "../data/catalogue.js";
import {
  Badge,
  Badges,
  Flag,
  Scientific,
  date,
  kindLabel,
  num,
  size,
} from "../views/format.jsx";
import { Layout } from "../views/layout.jsx";
import {
  CopyButton,
  CopyTextButton,
  DownloadButton,
  Fields,
  Section,
  decode,
  expandedFields,
} from "./shared.jsx";

/** What each tab is for, in as few words as say it. */
const TAB_BLURBS = {
  grids: "Stellar and AGN, incident and photoionised",
  dust: "Attenuation curves and dust emission",
  instruments: "Filters, PSFs, noise and depths",
};

// What an instrument can be asked to do, in the order the dataset page lists
// them: photometry before spectroscopy, and within each, plain before the
// versions that add a PSF or noise. The names are the columns' own, so a
// capability added to the schema shows up here by being added to this list.
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

/**
 * The landing page.
 *
 * The org site's shape: one screen, centred, three signposts and nothing
 * else. Someone arriving from a paper needs orientation, and someone who
 * knows what they want should be one keystroke from the search.
 */
export const Landing = ({ counts, datasets, bytes }) => (
  <Layout
    title="The Synthesizer data index"
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
        The Synthesizer data index
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
    title={filters.pick === "release" ? "Which dataset" : tab.label}
    counts={counts}
    active={tab.id === "search" && filters.type.length > 0 ? null : tab.id}
    filters={filters}
  >
    {filters.pick === "release" ? (
      // Picking, not browsing. The catalogue's own search, with the results
      // going to the submission form instead of to a dataset page -- so
      // every filter and facet is the one somebody has already used to find
      // a dataset, rather than a second search written beside it.
      <div class="mb-6">
        <p class="mb-3 text-sm">
          <a href={`${BASE}/submit`}>Back to submitting</a>
        </p>
        <h1 class="text-3xl sm:text-4xl">Which dataset</h1>
        <p class="mt-3 max-w-2xl text-muted">
          Choose the one this is a new version of. It will keep the same name
          but replace the existing version as the version people download.
          Note that all old releases are still available regardless.
        </p>
      </div>
    ) : (
      <h1 class="sr-only">{tab.label}</h1>
    )}
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
