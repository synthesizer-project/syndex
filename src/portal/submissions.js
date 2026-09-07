/**
 * Accepting a contributed file without letting it near the catalogue.
 *
 * The bytes never pass through the Worker. Registering a submission mints an
 * unguessable upload token, which names one prefix of a separate submissions
 * bucket, and the file goes straight to R2 from wherever it already is:
 * under 1 GiB through a presigned PUT from the browser, above that with an
 * ordinary S3 client driven by prefix-scoped temporary credentials, so
 * multipart and resumption come from tooling that already does them
 * properly rather than from code written here.
 *
 * 233 of the catalogue's 241 datasets are under 1 GiB. The eight that are
 * not are grids on an HPC filesystem, where rclone is already installed and
 * a browser is the wrong tool anyway.
 *
 * Nothing in this module writes to the catalogue's own bucket, and the
 * credentials it holds are scoped so that they could not.
 */

import { AwsClient } from "aws4fetch";

/**
 * Largest file the browser is asked to send.
 *
 * A presigned PUT is one request and cannot resume, so this is a limit on
 * what will plausibly finish rather than the 5 GiB R2 allows.
 */
export const BROWSER_UPLOAD_LIMIT = 1024 ** 3;

/** How long a presigned upload URL stays valid. */
const UPLOAD_URL_TTL = 60 * 60;

/** How long temporary credentials for a large upload stay valid. */
const CREDENTIAL_TTL = 12 * 60 * 60;

/** Cloudflare's Turnstile verification endpoint. */
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Whether submissions can be accepted at all.
 *
 * Everything needed to take a file is configuration, and none of it has a
 * sensible default, so the form says it is closed rather than half working.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {boolean} Whether the upload path is fully configured.
 */
export function submissionsOpen(env) {
  return Boolean(
    env.SUBMISSIONS &&
      env.SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID &&
      env.SYNTHESIZER_SUBMISSIONS_BUCKET &&
      env.SYNTHESIZER_SUBMISSIONS_ACCESS_KEY_ID &&
      env.SYNTHESIZER_SUBMISSIONS_SECRET_ACCESS_KEY &&
      env.TURNSTILE_SITEKEY &&
      env.TURNSTILE_SECRET,
  );
}

/**
 * Check a Turnstile token.
 *
 * The form is anonymous, so this is what stops a script filling the queue.
 * It fails closed: an unconfigured or unreachable Turnstile means no
 * submission, not an unprotected one.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} token The `cf-turnstile-response` field.
 * @param {string | null} ip The visitor's address, when the edge gave one.
 * @returns {Promise<boolean>} Whether the challenge was passed.
 */
export async function verifyChallenge(env, token, ip) {
  if (!env.TURNSTILE_SECRET || !token) {
    return false;
  }

  const response = await fetch(SITEVERIFY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: token,
      ...(ip === null ? {} : { remoteip: ip }),
    }),
  });

  if (!response.ok) {
    console.error(
      JSON.stringify({
        message: "Turnstile verification was unreachable",
        status: response.status,
      }),
    );
    return false;
  }

  const result = await response.json();
  if (result.success !== true) {
    console.error(
      JSON.stringify({
        message: "Turnstile rejected a submission",
        errors: result["error-codes"] ?? [],
      }),
    );
  }
  return result.success === true;
}

/**
 * The prefix one submission is allowed to write to.
 *
 * @param {string} token The submission's upload token.
 * @returns {string} An R2 key prefix, with its trailing slash.
 */
export function uploadPrefix(token) {
  return `submissions/${token}/`;
}

/**
 * Reduce a submitted filename to something safe to use as an R2 key.
 *
 * The name arrives from a browser and becomes part of a key that credentials
 * are then scoped to, so anything that could climb out of the prefix or make
 * the key ambiguous is removed rather than rejected: the file is the point,
 * its name is not.
 *
 * @param {string} filename The name the browser reported.
 * @returns {string} A safe basename.
 */
export function safeFilename(filename) {
  const basename = String(filename).split(/[\\/]/).pop() ?? "";
  const cleaned = basename.replace(/[^A-Za-z0-9._+,-]/g, "_").slice(0, 200);
  // A name of only dots would resolve to a directory rather than a file.
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : "submission.bin";
}

/**
 * Build a client for the submissions bucket over the S3 API.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {AwsClient} A signer for that bucket's endpoint.
 */
function signer(env) {
  return new AwsClient({
    accessKeyId: env.SYNTHESIZER_SUBMISSIONS_ACCESS_KEY_ID,
    secretAccessKey: env.SYNTHESIZER_SUBMISSIONS_SECRET_ACCESS_KEY,
    service: "s3",
  });
}

/**
 * Mint a presigned PUT for one file of one submission.
 *
 * The URL authorises exactly one key for one hour. It is the only write the
 * browser is ever given, and it points at the submissions bucket's S3
 * endpoint rather than at this Worker.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} token The submission's upload token.
 * @param {string} filename The name the browser reported.
 * @returns {Promise<{url: string, key: string}>} Where to PUT, and the key.
 */
export async function presignUpload(env, token, filename) {
  const key = `${uploadPrefix(token)}${safeFilename(filename)}`;
  const endpoint =
    `https://${env.SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` +
    `/${env.SYNTHESIZER_SUBMISSIONS_BUCKET}/${key}`;

  const signed = await signer(env).sign(
    new Request(`${endpoint}?X-Amz-Expires=${UPLOAD_URL_TTL}`, {
      method: "PUT",
    }),
    { aws: { signQuery: true } },
  );

  return { url: signed.url.toString(), key };
}

/**
 * Mint temporary credentials for a large upload.
 *
 * Scoped to one prefix of one bucket, with write access and nothing else, so
 * the worst a leaked set can do is add or replace files inside a submission
 * that is already waiting to be read by a human.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} token The submission's upload token.
 * @returns {Promise<object | null>} Credentials and where to use them, or
 *     null when minting failed.
 */
export async function temporaryCredentials(env, token) {
  const account = env.SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/temp-access-credentials`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.SYNTHESIZER_SUBMISSIONS_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bucket: env.SYNTHESIZER_SUBMISSIONS_BUCKET,
        parentAccessKeyId: env.SYNTHESIZER_SUBMISSIONS_ACCESS_KEY_ID,
        permission: "object-read-write",
        ttlSeconds: CREDENTIAL_TTL,
        prefixes: [uploadPrefix(token)],
      }),
    },
  );

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    console.error(
      JSON.stringify({
        message: "Could not mint upload credentials",
        status: response.status,
        errors: body?.errors ?? [],
      }),
    );
    return null;
  }

  return {
    ...body.result,
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    bucket: env.SYNTHESIZER_SUBMISSIONS_BUCKET,
    prefix: uploadPrefix(token),
    hours: CREDENTIAL_TTL / 3600,
  };
}

/**
 * Find out what actually arrived for one submission.
 *
 * Asked of R2 through the binding rather than taken from whoever says the
 * upload finished, which is what makes the browser's report of success
 * advisory rather than authoritative. One file per submission: anything
 * beyond the first is ignored, and the reviewer sees the count.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} token The submission's upload token.
 * @returns {Promise<{key: string, filename: string, size: number,
 *     extras: number} | null>} What is there, or null when nothing is.
 */
export async function uploadedFile(env, token) {
  const prefix = uploadPrefix(token);
  const listed = await env.SUBMISSIONS.list({ prefix, limit: 10 });
  const [object] = listed.objects;
  if (object === undefined) {
    return null;
  }

  return {
    key: object.key,
    filename: object.key.slice(prefix.length),
    size: object.size,
    extras: listed.objects.length - 1,
  };
}
