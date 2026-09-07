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

/** Columns stored as serialized JSON, parsed before being returned. */
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
 * Strips the `_json` suffix from serialized columns and decodes their
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
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 100), 1), 1000);

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
              f.filename, f.format, f.size_bytes, f.sha256,
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
 * Assemble one release's complete metadata.
 *
 * Grid metadata, ordered axes, and instrument metadata are fetched in a
 * single batch. Both the dataset detail and the release detail responses use
 * this, so a release describes itself identically wherever it appears.
 *
 * @param {D1Database} db Catalogue database.
 * @param {Record<string, unknown>} row Decoded release row joined to its file.
 * @param {string} origin Origin of the incoming request.
 * @returns {Promise<Record<string, unknown>>} The release object.
 */
async function releasePayload(db, row, origin) {
  const releaseId = row.release_id;
  const [grid, axes, instrument] = await db.batch([
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
    synthesizer_min_version: row.synthesizer_min_version,
    synthesizer_max_version: row.synthesizer_max_version,
    provenance: row.provenance,
    file: {
      filename: row.filename,
      format: row.format,
      size_bytes: row.size_bytes,
      sha256: row.sha256,
    },
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
              f.filename, f.format, f.size_bytes, f.sha256
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
  if (!/^[0-9]+$/.test(releaseId)) {
    return error(400, "Release id must be an integer");
  }

  const row = await db
    .prepare(
      `SELECT r.release_id, r.published_at, r.deprecated_at,
              r.synthesizer_min_version, r.synthesizer_max_version,
              r.provenance_json,
              f.filename, f.format, f.size_bytes, f.sha256,
              d.name AS dataset, d.data_type, d.current_release_id
       FROM releases r
       JOIN files f ON f.file_id = r.file_id
       JOIN datasets d ON d.dataset_id = r.dataset_id
       WHERE r.release_id = ?`,
    )
    .bind(Number(releaseId))
    .first();

  if (row === null) {
    return error(404, `No release with id ${releaseId}`);
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
              r.provenance_json,
              f.filename, f.r2_path, f.format, f.size_bytes, f.sha256
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
  if (!/^[0-9]+$/.test(releaseId)) {
    return error(400, "Release id must be an integer");
  }

  const row = await env.DB.prepare(
    `SELECT f.r2_path, f.filename, f.size_bytes, f.sha256
     FROM releases r JOIN files f ON f.file_id = r.file_id
     WHERE r.release_id = ?`,
  )
    .bind(Number(releaseId))
    .first();

  if (row === null) {
    return error(404, `No release with id ${releaseId}`);
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
    "content-disposition": `attachment; filename="${row.filename}"`,
    "x-syndicate-sha256": row.sha256,
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
