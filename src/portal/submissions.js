/**
 * Taking a contributed file without letting it near the catalogue.
 *
 * The file arrives in parts, each an ordinary request the Worker writes
 * straight into a multipart upload on the submissions bucket. The credential
 * is the contributor's session: there is nothing else to hold, nothing minted
 * that outlives the request, and signing out ends the ability to write.
 *
 * This replaced a presigned PUT and a set of temporary R2 credentials, and
 * the reason is worth keeping. Those put the bytes on a path the Worker could
 * not see, which meant every limit had to be expressed as something signed
 * into a URL and hoped for: a content-length that was never signed, so the
 * size cap was advice; a key derived from whatever filename was submitted, so
 * one token could write unlimited objects; and twelve hours of prefix-scoped
 * write access handed out for viewing a page. Moving the bytes through here
 * does not fix those. It removes them. The Worker chooses the key, counts the
 * parts, and stops.
 *
 * What it costs is that the bytes pass through a Worker, which is only viable
 * because the runtime streams a request body into R2 without the bytes
 * passing through any JavaScript here -- waiting on I/O is not CPU time. The
 * ceiling is therefore a part count rather than a byte count, which needs no
 * measuring and cannot be lied about: a part larger than the platform's
 * request body limit is refused before this code runs at all.
 *
 * Nothing in this module writes to the catalogue's own bucket.
 */

/**
 * How much of the file each request carries.
 *
 * Under the 100 MB request body limit of the smallest Cloudflare plan, with
 * room to spare, and above R2's 5 MiB minimum part size. R2 requires every
 * part but the last to be the same size, so this is a contract with the
 * client rather than a suggestion.
 */
export const PART_SIZE = 90 * 1024 * 1024;

/**
 * The largest file a submission may be.
 *
 * Expressed as a part count because that is what is actually enforced: the
 * platform refuses a request body over its own limit before any of this runs,
 * so a client cannot exceed `PART_SIZE` per part however it lies, and the
 * total is therefore bounded by how many parts are accepted.
 *
 * 2000 parts is a little over 175 GB. The largest grids in the catalogue are
 * around 30 GB, so this is room for that to grow several times over rather
 * than a ceiling anybody is expected to meet; R2 itself allows 10,000 parts.
 */
export const MAX_PARTS = 2000;

/**
 * How much of that a browser is asked to attempt.
 *
 * A different question from what the service will store. An interrupted
 * browser upload starts again from the first piece -- the page cannot pick up
 * where a closed tab left off, because it no longer has the file -- so beyond
 * a certain size the browser is simply the wrong tool, and saying so is
 * better than letting somebody discover it four hours in.
 *
 * 106 parts is a shade over 10 GB. 233 of the catalogue's 244 datasets are
 * under 1 GB, so this is generous for everything the browser is actually for;
 * the eleven that are larger are grids on an HPC filesystem, where a browser
 * was never going to be the way to send them.
 *
 * `syndex-submit` has no such problem: it holds the file, so it resumes. That
 * is what the larger ceiling above is for.
 */
export const BROWSER_MAX_PARTS = 106;

/** The ceilings, for the pages that have to tell somebody what they are. */
export const MAX_UPLOAD_BYTES = PART_SIZE * MAX_PARTS;
export const BROWSER_UPLOAD_BYTES = PART_SIZE * BROWSER_MAX_PARTS;

/** How many submissions one account may have waiting at once. */
export const MAX_PENDING_PER_USER = 10;

/** How many submissions may be waiting in total, across everybody. */
export const MAX_PENDING_TOTAL = 50;

/**
 * Whether submissions can be accepted at all.
 *
 * Only the bucket now. The account id, the two R2 signing keys and the API
 * token that minted temporary credentials are all gone along with the code
 * that used them, which is the clearest measure of what moving the bytes
 * through the Worker bought.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {boolean} Whether the upload path is configured.
 */
export function submissionsOpen(env) {
  return Boolean(env.SUBMISSIONS);
}

/**
 * The prefix one submission is allowed to occupy.
 *
 * @param {string} token The submission's upload token.
 * @returns {string} An R2 key prefix, with its trailing slash.
 */
export function uploadPrefix(token) {
  return `submissions/${token}/`;
}

/**
 * The one key a submission may write.
 *
 * Fixed when the submission is registered and never derived from a later
 * request, which is what makes one submission one object. The old presigned
 * path took the filename from whichever request asked for a URL, so every
 * call signed a different key and a single token could write as many objects
 * as somebody cared to name.
 *
 * Deliberately carries no extension. The key is chosen before the file is,
 * so any extension here would be a guess -- and the guess would be wrong for
 * the quarter of the catalogue that is not HDF5. Nothing needs it: R2 does
 * not care, and `syndex check` reads the format out of the bytes.
 *
 * @param {object} submission The submission row.
 * @returns {string} The R2 key its bytes belong at.
 */
export function uploadKey(submission) {
  return `${uploadPrefix(submission.upload_token)}${submission.filename}`;
}

/**
 * Begin, or pick up, the multipart upload a submission's file arrives through.
 *
 * Resuming rather than restarting is what lets a transfer survive a dropped
 * connection, a closed laptop, or a client that sends its parts over an hour.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {object} submission The submission row.
 * @returns {Promise<{upload: R2MultipartUpload, uploadId: string}>} The
 *     upload to write parts into, and its id.
 */
export async function openUpload(env, submission) {
  const key = uploadKey(submission);

  if (submission.upload_id) {
    return {
      upload: env.SUBMISSIONS.resumeMultipartUpload(key, submission.upload_id),
      uploadId: submission.upload_id,
    };
  }

  const upload = await env.SUBMISSIONS.createMultipartUpload(key);

  // Claim it, but only if nothing else already has. A client is free to send
  // parts concurrently, and two of them arriving at once on a submission that
  // has not started would otherwise each create an upload and each believe
  // theirs was the one -- leaving the parts split across two uploads, neither
  // of which can be completed.
  const claimed = await env.DB.prepare(
    `UPDATE submissions SET upload_id = ?
     WHERE submission_id = ? AND upload_id IS NULL
     RETURNING upload_id`,
  )
    .bind(upload.uploadId, submission.submission_id)
    .first();

  if (claimed === null) {
    // Somebody else got there first. Abandon the one just created rather than
    // leaving it to accumulate parts nobody will complete, and use theirs.
    const winner = await env.DB.prepare(
      "SELECT upload_id FROM submissions WHERE submission_id = ?",
    )
      .bind(submission.submission_id)
      .first();
    await upload.abort().catch(() => {});
    return {
      upload: env.SUBMISSIONS.resumeMultipartUpload(key, winner.upload_id),
      uploadId: winner.upload_id,
    };
  }

  return { upload, uploadId: upload.uploadId };
}

/**
 * Write one part, and remember that it landed.
 *
 * The body is handed to R2 as the stream it arrived as. Nothing here reads
 * it, which is what keeps a ninety megabyte request within a ten millisecond
 * CPU budget: waiting on I/O is not CPU time, but copying bytes in JavaScript
 * would be.
 *
 * Re-sending a part replaces its record rather than adding a second one, so a
 * client that retries after a timeout ends up with the file it meant to send.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {object} submission The submission row.
 * @param {number} partNumber Which part this is, counting from one.
 * @param {ReadableStream} body The part's bytes.
 * @returns {Promise<void>} Resolves once the part is stored and recorded.
 */
export async function writePart(env, submission, partNumber, body) {
  // Part one is the beginning of a transfer, so anything already half sent is
  // abandoned rather than merged with it. Without this, choosing a different
  // file after a failed attempt leaves the earlier file's higher-numbered
  // parts in place and assembles the two into an object that is neither --
  // caught later by the digest and by `syndex check`, but only after 30 GB
  // has been sent for nothing.
  //
  // A client resuming an interrupted transfer continues from where it
  // stopped and so never re-sends part one; one starting afresh always does.
  if (partNumber === 1 && submission.upload_id) {
    await abandonUpload(env, submission);
    submission = { ...submission, upload_id: null };
  }

  const { upload } = await openUpload(env, submission);
  const part = await upload.uploadPart(partNumber, body);

  await env.DB.prepare(
    `INSERT INTO submission_parts (submission_id, part_number, etag)
     VALUES (?, ?, ?)
     ON CONFLICT (submission_id, part_number) DO UPDATE SET etag = excluded.etag`,
  )
    .bind(submission.submission_id, partNumber, part.etag)
    .run();
}

/**
 * Finish the upload, and find out what actually arrived.
 *
 * The size is read back from R2 rather than taken from whoever said the
 * transfer finished, which is what makes a client's report of success
 * advisory. A file assembled from the wrong number of parts is a file that is
 * the wrong size, and the reviewer sees the size.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {object} submission The submission row.
 * @returns {Promise<{key: string, size: number} | null>} What is there, or
 *     null when the parts do not assemble into an object.
 */
export async function finishUpload(env, submission) {
  const { results } = await env.DB.prepare(
    `SELECT part_number, etag FROM submission_parts
     WHERE submission_id = ? ORDER BY part_number`,
  )
    .bind(submission.submission_id)
    .all();

  if (results.length === 0) {
    return null;
  }

  const { upload } = await openUpload(env, submission);
  try {
    await upload.complete(
      results.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    );
  } catch (error) {
    // R2 refuses a completion whose parts do not line up -- a missing part in
    // the middle, or parts of unequal size. That is a client that stopped
    // part way, not a server fault, so it is reported rather than thrown.
    console.error(
      JSON.stringify({
        message: "A multipart upload would not complete",
        submission: submission.submission_id,
        parts: results.length,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }

  const key = uploadKey(submission);
  const object = await env.SUBMISSIONS.head(key);
  return object === null ? null : { key, size: object.size };
}

/**
 * Abandon a transfer, releasing whatever R2 is holding for it.
 *
 * Parts of an incomplete multipart upload are billed like any other stored
 * object, so a submission that is replaced or withdrawn part way through has
 * to let go of them rather than leave them for the lifecycle rule.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {object} submission The submission row.
 * @returns {Promise<void>} Resolves once it is abandoned.
 */
export async function abandonUpload(env, submission) {
  if (submission.upload_id) {
    await env.SUBMISSIONS.resumeMultipartUpload(
      uploadKey(submission),
      submission.upload_id,
    )
      .abort()
      // An upload that is already gone is the state being asked for.
      .catch(() => {});
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM submission_parts WHERE submission_id = ?").bind(
      submission.submission_id,
    ),
    env.DB.prepare(
      "UPDATE submissions SET upload_id = NULL WHERE submission_id = ?",
    ).bind(submission.submission_id),
  ]);
}

/**
 * Whether this account may open another submission.
 *
 * Two limits, because they stop different things. The per-account one stops a
 * contributor filling the queue by accident, by submitting a directory one
 * file at a time; the total one stops everybody doing it at once, which is
 * the only limit that holds if an account is ever granted to the wrong
 * person.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {number} userId The account asking.
 * @returns {Promise<string | null>} Why not, or null when they may.
 */
export async function submissionRefusal(env, userId) {
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM submissions
        WHERE state = 'pending' AND user_id = ?) AS mine,
       (SELECT COUNT(*) FROM submissions WHERE state = 'pending') AS everyone`,
  )
    .bind(userId)
    .first();

  if (counts.mine >= MAX_PENDING_PER_USER) {
    return (
      `You already have ${counts.mine} submissions waiting to be reviewed, ` +
      "which is the most one account may have at a time. They will free up " +
      "as they are reviewed."
    );
  }
  if (counts.everyone >= MAX_PENDING_TOTAL) {
    return (
      "The review queue is full. This is a deliberate ceiling rather than a " +
      "fault; please try again once some of it has been read."
    );
  }
  return null;
}
