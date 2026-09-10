/**
 * Read-only catalogue and download API for the Synthesizer data service.
 *
 * D1 is authoritative for catalogue metadata, R2 for immutable file bytes.
 * This Worker never parses HDF5 and never writes to either service.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60",
};

/** Columns stored as serialised JSON, parsed before being returned. */
const JSON_COLUMNS = new Set([
  "citations_json",
  "metadata_json",
  "provenance_json",
  "model_parameters_json",
  "photoionisation_parameters_json",
  "available_spectra_json",
  "available_lines_json",
  "capabilities_json",
  "filter_codes_json",
  "depth_json",
  "snrs_json",
  "psfs_json",
  "noise_maps_json",
  "noise_source_maps_json",
  "members_json",
  "values_json",
]);

/**
 * Convert one D1 row into an API object.
 *
 * Strips the `_json` suffix from serialised columns and decodes their
 * contents, and converts SQLite integer booleans into real booleans.
 *
 * @param {Record<string, unknown> | null} row Row returned by D1.
 * @param {string[]} booleans Columns holding 0/1 booleans.
 * @returns {Record<string, unknown> | null} Decoded object, or null.
 */
function decodeRow(row, booleans = []) {
  if (row === null || row === undefined) {
    return null;
  }
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key)) {
      result[key.slice(0, -"_json".length)] = value === null ? null : JSON.parse(value);
    } else if (booleans.includes(key)) {
      result[key] = Boolean(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Build a JSON response.
 *
 * @param {unknown} body Response body.
 * @param {number} status HTTP status code.
 * @returns {Response} JSON response with CORS and cache headers.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Parse a release id from a path segment.
 *
 * Deliberately strict: `Number()` accepts `0x10`, `1e3`, ` 1` and `1.0`, so
 * four handlers validating it four different ways disagreed about which of
 * those named a release. Only digits do.
 *
 * @param {string} text Path segment as it arrived.
 * @returns {number | null} The id, or null when it is not one.
 */
function releaseNumber(text) {
  return /^[0-9]+$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

/**
 * Quote a filename for a `content-disposition` header.
 *
 * Filenames come from D1 rather than from the request, but a header built by
 * interpolation is a header that can be split, so the quoting happens here
 * rather than resting on what the publisher happened to allow.
 *
 * @param {string} name Filename to offer the client.
 * @returns {string} A `filename="..."` parameter.
 */
function contentDisposition(name) {
  const safe = String(name).replace(/[^\w.\-+]/g, "_");
  return `attachment; filename="${safe}"`;
}

/**
 * Build a JSON error response.
 *
 * @param {number} status HTTP status code.
 * @param {string} message Human-readable explanation.
 * @returns {Response} JSON error response.
 */
function error(status, message) {
  return json({ error: message }, status);
}

/**
 * List catalogue datasets, newest release metadata included.
 *
 * Supports `data_type` and `is_test` filtering, plus `limit` and `after`
 * cursor pagination ordered by dataset name.
 *
 * @param {D1Database} db Catalogue database.
 * @param {URL} url Request URL carrying query parameters.
 * @returns {Promise<Response>} JSON listing.
 */
async function listDatasets(db, url) {
  const params = url.searchParams;
  // Number("abc") is NaN and both clamps preserve it, so an unparseable
  // limit used to reach D1 as `LIMIT NaN` and bound nothing at all.
  const requested = Number(params.get("limit") ?? 100);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 1000)
    : 100;

  /**
   * Read a boolean query parameter as the 0/1 D1 stores, or null for absent.
   *
   * @param {string} key Query parameter name.
   * @returns {number | null} Bound value for the query.
   */
  const flag = (key) => {
    const value = params.get(key);
    return value === null ? null : Number(value === "true" || value === "1");
  };

  const { results } = await db
    .prepare(
      `SELECT d.name, d.display_name, d.description, d.data_type, d.is_test,
              d.is_ci, d.is_recommended, d.licence,
              r.release_id, r.published_at,
              f.file_id, f.filename, f.format, f.size_bytes, f.sha256,
              g.has_spectra, g.has_lines
       FROM datasets d
       LEFT JOIN releases r ON r.release_id = d.current_release_id
       LEFT JOIN files f ON f.file_id = r.file_id
       LEFT JOIN grid_metadata g ON g.release_id = r.release_id
       WHERE (?1 IS NULL OR d.data_type = ?1)
         AND (?2 IS NULL OR d.is_test = ?2)
         AND (?3 IS NULL OR d.is_ci = ?3)
         AND (?4 IS NULL OR g.has_spectra = ?4)
         AND (?5 IS NULL OR g.has_lines = ?5)
         AND (?6 IS NULL OR d.name > ?6)
       ORDER BY d.name
       LIMIT ?7`,
    )
    .bind(
      params.get("data_type"),
      flag("is_test"),
      flag("is_ci"),
      flag("has_spectra"),
      flag("has_lines"),
      params.get("after"),
      limit,
    )
    .all();

  const datasets = results.map((row) => {
    const dataset = decodeRow(row, [
      "is_test",
      "is_ci",
      "is_recommended",
      "has_spectra",
      "has_lines",
    ]);
    // Only grids have contents worth reporting; other types have none.
    if (dataset.has_spectra === null || row.has_spectra === null) {
      delete dataset.has_spectra;
      delete dataset.has_lines;
    }
    dataset.download_url =
      dataset.release_id === null
        ? null
        : `${url.origin}/v1/releases/${dataset.release_id}/download`;
    return dataset;
  });
  return json({
    datasets,
    cursor: datasets.length === limit ? datasets[datasets.length - 1].name : null,
  });
}

/**
 * Serve a release's preview image.
 *
 * The bucket is private, so the image cannot be linked directly and has to be
 * proxied. The object is content addressed, but this URL names a release, and
 * regenerating a preview repoints it at new bytes -- so it revalidates rather
 * than being pinned in browsers as immutable.
 *
 * @param {object} env Worker bindings.
 * @param {Request} request Incoming request, for conditional handling.
 * @param {string} releaseId Release identifier from the path.
 * @returns {Promise<Response>} The PNG, or an error response.
 */
async function releasePreview(env, request, releaseId) {
  const numeric = releaseNumber(releaseId);
  if (numeric === null) {
    return error(400, "Release id must be a positive integer");
  }

  const row = await env.DB.prepare(
    `SELECT f.preview_path
     FROM releases r JOIN files f ON f.file_id = r.file_id
     WHERE r.release_id = ?`,
  )
    .bind(numeric)
    .first();

  if (row === null) {
    return error(404, `No release with id '${releaseId}'`);
  }
  if (row.preview_path === null) {
    // A file with nothing indicative to plot is a deliberate absence, not a
    // failure, so say so plainly rather than returning a broken image.
    return error(404, "No preview for this release");
  }

  const head = request.method === "HEAD";
  const object = head
    ? await env.FILES.head(row.preview_path)
    : await env.FILES.get(row.preview_path, { onlyIf: request.headers });

  if (object === null) {
    console.error(
      JSON.stringify({
        message: "R2 object missing for a recorded preview",
        release_id: numeric,
        preview_path: row.preview_path,
      }),
    );
    return error(502, "Preview is unavailable");
  }

  const headers = {
    "content-type": "image/png",
    "content-length": String(object.size),
    etag: object.httpEtag,
    "access-control-allow-origin": "*",
    // The object is content addressed but this URL is not: it names a
    // release, and regenerating a preview repoints that release at new
    // bytes. Marking it immutable therefore pinned stale plots in browsers
    // for a year. An hour with revalidation keeps it cheap -- the ETag
    // changes with the object, so a re-check costs a 304.
    "cache-control": "public, max-age=3600, must-revalidate",
  };

  // head() and a failed precondition both yield an object with no body, but
  // they mean opposite things: the first is a 200 whose body was not asked
  // for, the second is a 304.
  if (head) {
    return new Response(null, { headers });
  }
  if (object.body === undefined) {
    return new Response(null, { status: 304 });
  }
  return new Response(object.body, { headers });
}


/**
 * Serve a release's citations as a BibTeX file.
 *
 * A grid is not usable in a paper without its references, and retyping them
 * from a JSON payload is exactly the sort of transcription that introduces
 * errors. The stored BibTeX is returned verbatim, so what a user pastes into
 * their bibliography is what ADS produced.
 *
 * @param {D1Database} db Catalogue database.
 * @param {string} releaseId Release identifier from the path.
 * @returns {Promise<Response>} A BibTeX document, or an error response.
 */
async function releaseCitations(db, releaseId) {
  const numeric = releaseNumber(releaseId);
  if (numeric === null) {
    return error(400, "Release id must be a positive integer");
  }

  const release = await db
    .prepare(
      `SELECT r.release_id, d.name AS dataset
       FROM releases r
       JOIN datasets d ON d.dataset_id = r.dataset_id
       WHERE r.release_id = ?`,
    )
    .bind(numeric)
    .first();
  if (release === null) {
    return error(404, `No release with id '${releaseId}'`);
  }

  const { results } = await db
    .prepare(
      `SELECT c.bibtex
       FROM releases r
       JOIN file_citations fc ON fc.file_id = r.file_id
       JOIN citations c ON c.citation_id = fc.citation_id
       WHERE r.release_id = ? ORDER BY fc.position, c.year`,
    )
    .bind(numeric)
    .all();

  // A release with nothing recorded is a gap in the catalogue rather than an
  // error, so say so in a comment instead of returning an empty file.
  const body = results.length
    ? results.map((row) => row.bibtex.trim()).join("\n\n") + "\n"
    : `% No citations recorded for ${release.dataset} release ${numeric}.\n`;

  return new Response(body, {
    headers: {
      "content-type": "application/x-bibtex; charset=utf-8",
      "content-disposition": contentDisposition(`${release.dataset}.bib`),
      "access-control-allow-origin": "*",
      // Citations can be corrected, and this URL names a release rather than
      // the bytes, so it revalidates for the same reason the preview does.
      "cache-control": "public, max-age=3600, must-revalidate",
    },
  });
}


/**
 * Assemble one release's complete metadata.
 *
 * Grid metadata, ordered axes, instrument metadata and citations are fetched
 * in a single batch. Both the dataset detail and the release detail responses
 * use this, so a release describes itself identically wherever it appears.
 *
 * @param {D1Database} db Catalogue database.
 * @param {Record<string, unknown>} row Decoded release row joined to its file.
 * @param {string} origin Origin of the incoming request.
 * @returns {Promise<Record<string, unknown>>} The release object.
 */
async function releasePayload(db, row, origin) {
  const releaseId = row.release_id;
  const [grid, axes, instrument, citations] = await db.batch([
    db
      .prepare("SELECT * FROM grid_metadata WHERE release_id = ?")
      .bind(releaseId),
    db
      .prepare(
        `SELECT axis_index, name, units, scale, count, minimum, maximum,
                values_json
         FROM grid_axes WHERE release_id = ? ORDER BY axis_index`,
      )
      .bind(releaseId),
    db.prepare("SELECT * FROM instruments WHERE release_id = ?").bind(releaseId),
    // Citations hang off the file rather than the release, because that is the
    // artifact being cited and two releases can need different references.
    db
      .prepare(
        `SELECT c.bibcode, c.doi, c.authors, c.title, c.year, c.journal,
                c.bibtex
         FROM file_citations fc
         JOIN citations c ON c.citation_id = fc.citation_id
         WHERE fc.file_id = ? ORDER BY fc.position, c.year`,
      )
      .bind(row.file_id),
  ]);

  const gridRow = decodeRow(grid.results[0] ?? null, [
    "has_spectra",
    "has_lines",
  ]);
  if (gridRow !== null) {
    delete gridRow.release_id;
    gridRow.axes = axes.results.map((axis) => decodeRow(axis));
    // A processed grid names the incident release it came from, so give the
    // client somewhere to follow rather than a bare integer.
    gridRow.incident_release_url =
      gridRow.incident_release_id === null
        ? null
        : `${origin}/v1/releases/${gridRow.incident_release_id}`;
  }
  const instrumentRow = decodeRow(instrument.results[0] ?? null);
  if (instrumentRow !== null) {
    delete instrumentRow.release_id;
  }

  return {
    release_id: releaseId,
    published_at: row.published_at,
    deprecated_at: row.deprecated_at,
    known_bug: row.known_bug === 1,
    known_bug_description: row.known_bug_description,
    synthesizer_min_version: row.synthesizer_min_version,
    synthesizer_max_version: row.synthesizer_max_version,
    provenance: row.provenance,
    file: {
      filename: row.filename,
      format: row.format,
      size_bytes: row.size_bytes,
      sha256: row.sha256,
    },
    citations: citations.results.map((citation) => decodeRow(citation)),
    download_url: `${origin}/v1/releases/${releaseId}/download`,
    grid: gridRow,
    instrument: instrumentRow,
  };
}

/**
 * List every release of one dataset, newest publication first.
 *
 * A dataset accumulates releases as its file is regenerated. Older releases
 * stay downloadable forever, so this is how a client discovers which
 * versions exist and pins to one deliberately.
 *
 * @param {D1Database} db Catalogue database.
 * @param {string} name Stable dataset name.
 * @param {string} origin Origin of the incoming request.
 * @returns {Promise<Response>} JSON list of releases.
 */
async function listReleases(db, name, origin) {
  const dataset = await db
    .prepare(
      "SELECT dataset_id, name, data_type, current_release_id FROM datasets WHERE name = ?",
    )
    .bind(name)
    .first();

  if (dataset === null) {
    return error(404, `No dataset named '${name}'`);
  }

  const { results } = await db
    .prepare(
      `SELECT r.release_id, r.published_at, r.deprecated_at,
              r.synthesizer_min_version, r.synthesizer_max_version,
              r.known_bug, r.known_bug_description,
              f.file_id, f.filename, f.format, f.size_bytes, f.sha256
       FROM releases r
       JOIN files f ON f.file_id = r.file_id
       WHERE r.dataset_id = ?
       ORDER BY r.published_at DESC, r.release_id DESC`,
    )
    .bind(dataset.dataset_id)
    .all();

  return json({
    dataset: dataset.name,
    data_type: dataset.data_type,
    releases: results.map((row) => ({
      release_id: row.release_id,
      published_at: row.published_at,
      deprecated_at: row.deprecated_at,
      known_bug: row.known_bug === 1,
      known_bug_description: row.known_bug_description,
      is_current: row.release_id === dataset.current_release_id,
      synthesizer_min_version: row.synthesizer_min_version,
      synthesizer_max_version: row.synthesizer_max_version,
      file: {
        filename: row.filename,
        format: row.format,
        size_bytes: row.size_bytes,
        sha256: row.sha256,
      },
      url: `${origin}/v1/releases/${row.release_id}`,
      download_url: `${origin}/v1/releases/${row.release_id}/download`,
    })),
  });
}

/**
 * Return one release by id, whatever dataset it belongs to.
 *
 * Releases are referenced by id from elsewhere in the catalogue, most notably
 * by a photoionised grid naming the incident grid it was computed from, so
 * they need to be retrievable without knowing the dataset first.
 *
 * @param {D1Database} db Catalogue database.
 * @param {string} releaseId Release identifier from the path.
 * @param {string} origin Origin of the incoming request.
 * @returns {Promise<Response>} JSON release detail.
 */
async function getRelease(db, releaseId, origin) {
  const numeric = releaseNumber(releaseId);
  if (numeric === null) {
    return error(400, "Release id must be a positive integer");
  }

  const row = await db
    .prepare(
      `SELECT r.release_id, r.published_at, r.deprecated_at,
              r.synthesizer_min_version, r.synthesizer_max_version,
              r.known_bug, r.known_bug_description,
              r.provenance_json,
              f.file_id, f.filename, f.format, f.size_bytes, f.sha256,
              d.name AS dataset, d.data_type, d.current_release_id
       FROM releases r
       JOIN files f ON f.file_id = r.file_id
       JOIN datasets d ON d.dataset_id = r.dataset_id
       WHERE r.release_id = ?`,
    )
    .bind(numeric)
    .first();

  if (row === null) {
    return error(404, `No release with id '${releaseId}'`);
  }

  const decoded = decodeRow(row);
  return json({
    dataset: decoded.dataset,
    data_type: decoded.data_type,
    is_current: decoded.current_release_id === decoded.release_id,
    ...(await releasePayload(db, decoded, origin)),
  });
}

/**
 * Return one dataset with its current release and complete metadata.
 *
 * Assembles the whole stored record, so clients receive everything a
 * persisted manifest would have provided.
 *
 * @param {D1Database} db Catalogue database.
 * @param {string} name Stable dataset name.
 * @param {string} origin Origin of the incoming request, used to build an
 *     absolute download URL a client can use without rejoining it to a base.
 * @returns {Promise<Response>} JSON dataset detail.
 */
async function getDataset(db, name, origin) {
  const row = await db
    .prepare(
      `SELECT d.name, d.display_name, d.description, d.data_type, d.is_test,
              d.is_ci, d.is_recommended, d.licence, d.citations_json,
              d.metadata_json,
              r.release_id, r.published_at, r.deprecated_at,
              r.synthesizer_min_version, r.synthesizer_max_version,
              r.known_bug, r.known_bug_description,
              r.provenance_json,
              f.file_id, f.filename, f.r2_path, f.format, f.size_bytes, f.sha256
       FROM datasets d
       LEFT JOIN releases r ON r.release_id = d.current_release_id
       LEFT JOIN files f ON f.file_id = r.file_id
       WHERE d.name = ?`,
    )
    .bind(name)
    .first();

  if (row === null) {
    return error(404, `No dataset named '${name}'`);
  }

  const dataset = decodeRow(row, ["is_test", "is_ci", "is_recommended"]);
  const releaseId = dataset.release_id;
  if (releaseId === null) {
    return json({
      name: dataset.name,
      display_name: dataset.display_name,
      description: dataset.description,
      data_type: dataset.data_type,
      is_test: dataset.is_test,
      is_ci: dataset.is_ci,
      is_recommended: dataset.is_recommended,
      licence: dataset.licence,
      citations: dataset.citations,
      metadata: dataset.metadata,
      current_release: null,
    });
  }

  return json({
    name: dataset.name,
    display_name: dataset.display_name,
    description: dataset.description,
    data_type: dataset.data_type,
    is_test: dataset.is_test,
    is_ci: dataset.is_ci,
    is_recommended: dataset.is_recommended,
    licence: dataset.licence,
    citations: dataset.citations,
    metadata: dataset.metadata,
    current_release: await releasePayload(db, dataset, origin),
  });
}

/**
 * Interpret a Range header against a known object size.
 *
 * Only single byte ranges are honoured. A multi-range or malformed header is
 * treated as absent, which the HTTP specification permits and which keeps the
 * response a plain 200 rather than a multipart body no client here asks for.
 *
 * @param {string | null} header The request's Range header.
 * @param {number} size Total size of the object in bytes.
 * @returns {{offset: number, length: number} | "unsatisfiable" | null}
 *     The resolved range, the string "unsatisfiable" when it falls outside
 *     the object, or null when the whole object should be served.
 */
function parseRange(header, size) {
  if (header === null) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return null;
  }

  const [, startText, endText] = match;
  if (startText === "" && endText === "") {
    return null;
  }

  // "bytes=-N" asks for the final N bytes.
  if (startText === "") {
    const suffix = Number(endText);
    if (suffix === 0) {
      return "unsatisfiable";
    }
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const offset = Number(startText);
  if (offset >= size) {
    return "unsatisfiable";
  }

  // An absent or oversized end means "to the last byte".
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (end < offset) {
    return "unsatisfiable";
  }

  return { offset, length: end - offset + 1 };
}

/**
 * Stream one release's file bytes from R2.
 *
 * The bucket stays private: bytes are proxied rather than redirected to a
 * public URL. Objects are content-addressed and never overwritten, so they
 * are safe to cache indefinitely.
 *
 * @param {{ DB: D1Database, FILES: R2Bucket }} env Worker bindings.
 * @param {Request} request Incoming request, used for conditional headers.
 * @param {string} releaseId Release identifier from the path.
 * @returns {Promise<Response>} File bytes, 304, or a JSON error.
 */
async function downloadRelease(env, request, releaseId) {
  const numeric = releaseNumber(releaseId);
  if (numeric === null) {
    return error(400, "Release id must be a positive integer");
  }

  const row = await env.DB.prepare(
    `SELECT f.r2_path, f.filename, f.size_bytes, f.sha256
     FROM releases r JOIN files f ON f.file_id = r.file_id
     WHERE r.release_id = ?`,
  )
    .bind(numeric)
    .first();

  if (row === null) {
    return error(404, `No release with id '${releaseId}'`);
  }

  // Ranged reads let an interrupted download resume instead of restarting,
  // which matters for multi-gigabyte grids. The size comes from D1, so an
  // impossible range is rejected without touching R2 at all.
  const range = parseRange(request.headers.get("range"), row.size_bytes);
  if (range === "unsatisfiable") {
    return new Response(
      JSON.stringify({ error: "Requested range is outside the file" }),
      {
        status: 416,
        headers: {
          ...JSON_HEADERS,
          "content-range": `bytes */${row.size_bytes}`,
          "accept-ranges": "bytes",
        },
      },
    );
  }

  const object =
    request.method === "HEAD"
      ? await env.FILES.head(row.r2_path)
      : await env.FILES.get(row.r2_path, {
          onlyIf: request.headers,
          ...(range === null ? {} : { range }),
        });

  if (object === null) {
    // D1 references an object R2 does not hold. Publication uploads and
    // verifies R2 before writing D1, so this means the object was removed.
    console.error(
      JSON.stringify({
        message: "R2 object missing for published release",
        release_id: releaseId,
        r2_path: row.r2_path,
      }),
    );
    return error(502, "Published file is unavailable");
  }

  const headers = new Headers({
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "content-disposition": contentDisposition(row.filename),
    "x-syndex-sha256": row.sha256,
    etag: object.httpEtag,
  });
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  // A failed precondition yields an R2Object with no body: that is a 304.
  if (object.body === undefined || request.method === "HEAD") {
    headers.set("content-length", String(row.size_bytes));
    return new Response(null, {
      status: object.body === undefined && request.method !== "HEAD" ? 304 : 200,
      headers,
    });
  }

  // A ranged read is a partial response, and must say which bytes it holds.
  if (range !== null) {
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size_bytes}`,
    );
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  return new Response(object.body, { headers });
}

export default {
  /**
   * Route one request.
   *
   * @param {Request} request Incoming request.
   * @param {{ DB: D1Database, FILES: R2Bucket }} env Worker bindings.
   * @returns {Promise<Response>} API response.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return error(405, "Only GET, HEAD and OPTIONS are supported");
    }

    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/v1/datasets") {
        return await listDatasets(env.DB, url);
      }

      const dataset = /^\/v1\/datasets\/([^/]+)$/.exec(path);
      if (dataset !== null) {
        return await getDataset(env.DB, decodeURIComponent(dataset[1]), url.origin);
      }

      const releases = /^\/v1\/datasets\/([^/]+)\/releases$/.exec(path);
      if (releases !== null) {
        return await listReleases(
          env.DB,
          decodeURIComponent(releases[1]),
          url.origin,
        );
      }

      const download = /^\/v1\/releases\/([^/]+)\/download$/.exec(path);
      if (download !== null) {
        return await downloadRelease(env, request, download[1]);
      }

      const preview = /^\/v1\/releases\/([^/]+)\/preview\.png$/.exec(path);
      if (preview !== null) {
        return await releasePreview(env, request, preview[1]);
      }

      const citations = /^\/v1\/releases\/([^/]+)\/citations\.bib$/.exec(path);
      if (citations !== null) {
        return await releaseCitations(env.DB, citations[1]);
      }

      const release = /^\/v1\/releases\/([^/]+)$/.exec(path);
      if (release !== null) {
        return await getRelease(env.DB, release[1], url.origin);
      }

      return error(404, `No route for ${path}`);
    } catch (exc) {
      console.error(
        JSON.stringify({
          message: "Unhandled API error",
          path: url.pathname,
          error: exc instanceof Error ? exc.message : String(exc),
        }),
      );
      return error(500, "Internal error");
    }
  },
};
