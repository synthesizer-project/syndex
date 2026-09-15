/**
 * Having a machine read a submitted file before a person does.
 *
 * `syndex check` is Python and needs h5py, so it cannot run in a Worker. It
 * runs on a GitHub Actions runner instead: the Worker asks for one when a
 * file finishes arriving, the runner installs the package, fetches the object
 * and reports back what the checker said. That is the whole of it -- the
 * rules live in one place and this only arranges for them to be applied.
 *
 * Everything here is advisory in the same way the issue notifications are. A
 * contributor's upload must not fail because GitHub is busy, so a dispatch
 * that cannot be sent is logged and the submission simply stays unvalidated,
 * which is the state it was in a moment earlier and which a reviewer can
 * still act on by running the checker themselves.
 *
 * The report comes back over the open internet, so it is authenticated: the
 * endpoint that accepts it is not a place anybody may write a verdict.
 */

const API = "https://api.github.com";

/** GitHub requires a User-Agent, and rejects requests without one. */
const USER_AGENT = "syndex-portal";

/**
 * How long a download link handed to the runner is good for.
 *
 * Long enough for a 30 GB fetch on a runner's connection, short enough that
 * one caught in a log is not a standing invitation.
 */
const FETCH_TTL_SECONDS = 6 * 60 * 60;

/**
 * Whether a validation run can be asked for at all.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {boolean} Whether the runner is configured.
 */
export function validationConfigured(env) {
  return Boolean(
    env.GITHUB_ISSUE_REPO && env.GITHUB_DISPATCH_TOKEN && env.SYNDEX_REPORT_SECRET,
  );
}

/**
 * Whether a report is from the runner this portal asked.
 *
 * A shared secret compared in constant time. Not because a timing attack on
 * this is plausible, but because the alternative is a comparison whose safety
 * depends on an argument about plausibility, and this one costs a loop.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string | undefined} presented The secret the caller sent.
 * @returns {boolean} Whether it matches.
 */
export function reportAuthorised(env, presented) {
  const expected = env.SYNDEX_REPORT_SECRET;
  if (!expected || typeof presented !== "string") {
    return false;
  }
  if (presented.length !== expected.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Ask GitHub to run the checker against one submission.
 *
 * The runner is given a link rather than credentials: it needs to read one
 * object once, and a signed URL says exactly that, where a token would say
 * rather more and last rather longer.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} origin Where to report back to.
 * @param {object} submission The submission whose file arrived.
 * @returns {Promise<boolean>} Whether a run was asked for.
 */
export async function requestValidation(env, origin, submission) {
  if (!validationConfigured(env)) {
    return false;
  }

  try {
    const response = await fetch(
      `${API}/repos/${env.GITHUB_ISSUE_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({
          event_type: "validate-submission",
          client_payload: {
            submission_id: submission.submission_id,
            // Both derived from the request rather than configured, so a run
            // asked for by a development deployment fetches from and reports
            // back to that deployment.
            fetch_url: await fetchUrl(env, origin, submission),
            report_url: `${origin}/syndex/validate/${submission.submission_id}`,
            filename: submission.filename,
            expected_size: submission.uploaded_size_bytes,
          },
        }),
      },
    );

    if (!response.ok) {
      console.error(
        JSON.stringify({
          message: "Could not ask for a validation run",
          status: response.status,
          submission: submission.submission_id,
        }),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Could not reach GitHub to ask for a validation run",
        error: error instanceof Error ? error.message : String(error),
        submission: submission.submission_id,
      }),
    );
    return false;
  }
}

/**
 * Reduce a report to the parts the portal stores and shows.
 *
 * The runner is on the other side of the internet and its output is written
 * by a version of the package this Worker did not install, so the shape is
 * confirmed rather than trusted: an unexpected state becomes "failed", which
 * is the answer that asks a person to look rather than the one that lets
 * something through.
 *
 * @param {object} report Whatever the runner posted.
 * @returns {{state: string, dataType: string | null, sha256: string | null}}
 *     What to record.
 */
export function readReport(report) {
  const states = ["passed", "failed", "ambiguous"];
  const state = states.includes(report?.state) ? report.state : "failed";

  const dataType =
    typeof report?.data_type === "string" && report.data_type !== ""
      ? report.data_type
      : null;

  const sha256 =
    typeof report?.sha256 === "string" && /^[0-9a-f]{64}$/.test(report.sha256)
      ? report.sha256
      : null;

  return { state, dataType, sha256 };
}

/**
 * Anything else holding the same bytes.
 *
 * Asked of the catalogue and of the queue together, because "we already have
 * this" and "somebody else is already submitting this" end a review the same
 * way and a reviewer wants to know either before reading anything else.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {number} submissionId The submission being reported on.
 * @param {string | null} sha256 Its digest.
 * @returns {Promise<{published: string | null, pending: string | null}>} What
 *     already holds these bytes, if anything.
 */
export async function duplicatesOf(env, submissionId, sha256) {
  if (sha256 === null) {
    return { published: null, pending: null };
  }

  const [published, pending] = await Promise.all([
    env.DB.prepare(
      `SELECT d.name FROM files f
       JOIN releases r ON r.file_id = f.file_id
       JOIN datasets d ON d.dataset_id = r.dataset_id
       WHERE f.sha256 = ? LIMIT 1`,
    )
      .bind(sha256)
      .first(),
    env.DB.prepare(
      `SELECT name FROM submissions
       WHERE sha256 = ? AND submission_id != ? AND state = 'pending' LIMIT 1`,
    )
      .bind(sha256, submissionId)
      .first(),
  ]);

  return {
    published: published?.name ?? null,
    pending: pending?.name ?? null,
  };
}

/**
 * Mint a link the runner can fetch the object with.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} origin Where the portal is served from.
 * @param {object} submission The submission whose file to fetch.
 * @returns {Promise<string>} A URL good for one object for a few hours.
 */
export async function fetchUrl(env, origin, submission) {
  const expires = Date.now() + FETCH_TTL_SECONDS * 1000;
  const signature = await sign(env, `${submission.submission_id}:${expires}`);
  return (
    `${origin}/syndex/validate/${submission.submission_id}/file` +
    `?expires=${expires}&signature=${signature}`
  );
}

/**
 * Whether a fetch link is one this portal minted and is still good.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {number} submissionId Which submission is being fetched.
 * @param {string | undefined} expires When the link stops working.
 * @param {string | undefined} signature What was signed.
 * @returns {Promise<boolean>} Whether to serve the object.
 */
export async function fetchAuthorised(env, submissionId, expires, signature) {
  const deadline = Number(expires);
  if (!Number.isFinite(deadline) || deadline < Date.now()) {
    return false;
  }
  const expected = await sign(env, `${submissionId}:${deadline}`);
  return reportAuthorised({ SYNDEX_REPORT_SECRET: expected }, signature);
}

/**
 * Sign one string with the shared secret.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} message What to sign.
 * @returns {Promise<string>} A hex digest.
 */
async function sign(env, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SYNDEX_REPORT_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
