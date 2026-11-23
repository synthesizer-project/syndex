/**
 * Publishing an approved submission, on a GitHub Actions runner.
 *
 * Approving used to record a decision and leave publishing to whoever
 * approved, as a separate run of `syndex-upload`. Nothing noticed when that
 * run never happened, so approving now asks for it: the same dispatch an
 * upload uses to ask for validation, to a workflow that fetches the file
 * through a signed link, publishes it with what the contributor wrote, and
 * reports back.
 *
 * The runner holds the R2 and D1 credentials as Actions secrets; the Worker
 * hands it nothing but a link to one object and the metadata to publish it
 * with.
 */

import { dispatch, fetchUrl, validationConfigured } from "./validation.js";

/**
 * What syndex-upload needs to publish a submission as its contributor
 * described it.
 *
 * A bare `syndex-upload NAME` would publish the filename as the display name,
 * with no description, no citations, and no current release.
 *
 * @param {object} submission The submission row.
 * @returns {object} One `files` entry of a syndex-upload metadata file.
 */
export function publishMetadata(submission) {
  const entry = {
    name: submission.name,
    display_name: submission.display_name,
    set_current: true,
  };
  if (submission.description) entry.description = submission.description;
  if (submission.licence) entry.licence = submission.licence;
  const citations = (submission.citations ?? "").split(/\s+/).filter(Boolean);
  if (citations.length > 0) entry.citations = citations;
  return entry;
}

/**
 * Whether a submission can be published without a person choosing anything.
 *
 * "other" is a contributor saying the file is none of the catalogue's types,
 * and publishing it needs somebody to pick one.
 *
 * @param {object} submission The submission row.
 * @returns {boolean} Whether a runner can publish it as it stands.
 */
export function publishable(submission) {
  return submission.data_type !== "other" && submission.r2_key != null;
}

/**
 * How long a run may go without reporting before it can be asked for again.
 *
 * Longer than the workflow's two-hour limit, so a run that is still going is
 * never raced: by now it has reported, or it was killed without being able to.
 */
export const STALE_AFTER_MS = 150 * 60 * 1000;

/**
 * Whether a run can be asked for at all: a type to publish under, and runs
 * configured.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {object} submission The submission row.
 * @returns {boolean} Whether to try.
 */
export function publicationPossible(env, submission) {
  return publishable(submission) && validationConfigured(env);
}

/**
 * Ask a runner to publish an approved submission.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} origin Where the portal is served from.
 * @param {object} submission The approved submission row, claimed for an
 *     attempt.
 * @returns {Promise<boolean>} Whether a run was asked for.
 */
export async function requestPublication(env, origin, submission) {
  // Configured first: the link cannot be signed without the secret.
  if (!publicationPossible(env, submission)) {
    return false;
  }
  return dispatch(env, "publish-submission", {
    submission_id: submission.submission_id,
    attempt: submission.publication_attempt,
    name: submission.name,
    data_type: submission.data_type,
    metadata: { files: { [submission.name]: publishMetadata(submission) } },
    fetch_url: await fetchUrl(env, origin, submission),
    report_url: `${origin}/syndex/publish/${submission.submission_id}`,
  });
}

/**
 * Reduce a runner's publication report to what is stored.
 *
 * Anything but an explicit "published" is a failure: the answer that sends a
 * person to look, rather than the one that says something is in the
 * catalogue when it may not be.
 *
 * @param {object} report Whatever the runner posted.
 * @returns {string} "published" or "failed".
 */
export function readPublicationReport(report) {
  return report?.state === "published" ? "published" : "failed";
}
