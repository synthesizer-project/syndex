/**
 * Telling a maintainer that something is waiting.
 *
 * The portal has no mail sender, and a queue nobody is told about is a queue
 * nobody empties: the count in the header only works for a reviewer who
 * happens to open the portal. An issue on the repository reaches the people
 * who already watch it, through notifications they already have set up.
 *
 * Every call here is advisory. Opening an issue must never decide whether a
 * request succeeded, so failures are logged and swallowed, and the caller
 * hands this to `ctx.waitUntil` rather than awaiting it: a contributor's
 * submission does not become slower or fail because GitHub is having an
 * afternoon.
 *
 * Nothing written here includes an email address. The issue is visible to
 * everyone who can see the repository, which is a wider audience than the
 * reviewer the address was given to; a GitHub login identifies the person
 * well enough for a maintainer to find them in the portal.
 */

const API = "https://api.github.com";

/**
 * The line that says where to go, and who it will work for.
 *
 * An issue on the repository is read by everyone who can see the repository,
 * which is a wider group than the people who can act on it. Somebody without
 * the role does not reach a broken link -- the portal tells them what role
 * the page needs -- but being told that after following a link reads like a
 * fault, so the link says who it is for before it is followed.
 *
 * @param {string} origin Where the portal is being served from.
 * @returns {string[]} Lines to append to an issue body.
 */
function reviewFooter(origin) {
  return [
    `[Open the review queue](${origin}/syndex/review)`,
    "",
    "_That page needs the reviewer role. If you do not have it, it will say",
    "so rather than showing you the queue._",
  ];
}

/** GitHub requires a User-Agent, and rejects requests without one. */
const USER_AGENT = "syndex-portal";

/**
 * Whether issues can be opened at all.
 *
 * @param {object} env Worker bindings and secrets.
 * @returns {boolean} Whether the repository and token are configured.
 */
export function notificationsConfigured(env) {
  return Boolean(env.GITHUB_ISSUE_REPO && env.GITHUB_ISSUE_TOKEN);
}

/**
 * Open one issue, or quietly do nothing.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} title The issue title.
 * @param {string} body The issue body, in Markdown.
 * @param {string[]} labels Labels to apply, if they exist on the repository.
 * @returns {Promise<void>} Resolves whether or not the issue was created.
 */
export async function openIssue(env, title, body, labels = []) {
  if (!notificationsConfigured(env)) {
    return;
  }

  try {
    const response = await fetch(
      `${API}/repos/${env.GITHUB_ISSUE_REPO}/issues`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${env.GITHUB_ISSUE_TOKEN}`,
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({ title, body, labels }),
      },
    );
    if (!response.ok) {
      console.error(
        JSON.stringify({
          message: "Could not open a notification issue",
          status: response.status,
          title,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Could not reach GitHub to open a notification issue",
        error: error instanceof Error ? error.message : String(error),
        title,
      }),
    );
  }
}

/**
 * Say that somebody has asked for submit access.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} origin Where the portal is being served from.
 * @param {object} user The account that asked.
 * @param {string} note What they said about what they want to contribute.
 * @returns {Promise<void>} Resolves whether or not the issue was created.
 */
export function notifyAccessRequest(env, origin, user, note) {
  return openIssue(
    env,
    `Access requested: @${user.login}`,
    [
      `@${user.login} has asked for submit access to the data catalogue.`,
      "",
      "They said:",
      "",
      // Quoted so that a note containing Markdown cannot restructure the
      // issue around it.
      note
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
      "",
      ...reviewFooter(origin),
      "",
      "Closing this issue does not grant anything.",
    ].join("\n"),
    ["access-request"],
  );
}

/**
 * Say that a submission's file has arrived and is waiting to be read.
 *
 * @param {object} env Worker bindings and secrets.
 * @param {string} origin Where the portal is being served from.
 * @param {object} submission The submission row.
 * @returns {Promise<void>} Resolves whether or not the issue was created.
 */
export function notifySubmission(env, origin, submission) {
  return openIssue(
    env,
    `Submission waiting: ${submission.name}`,
    [
      `**${submission.display_name}** has been submitted for review.`,
      "",
      `- catalogue name: \`${submission.name}\``,
      `- data type: ${submission.data_type ?? "not yet categorised"}`,
      `- size: ${submission.uploaded_size_bytes ?? "not yet uploaded"} bytes`,
      "",
      "The file itself is in the submissions bucket and is not attached here.",
      "",
      ...reviewFooter(origin),
    ].join("\n"),
    ["submission"],
  );
}
