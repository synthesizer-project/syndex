/**
 * What to tell somebody when a request could not be answered.
 *
 * Shared by the API and the portal, because a reader of one is often a reader
 * of the other and the two should not describe the same outage differently.
 *
 * The rule here is that an unhelpful error is one that says only that
 * something is wrong. "Something went wrong" tells a visitor nothing they can
 * act on and tells a maintainer nothing they did not already know from the
 * page being blank. Where the cause is recognisable, this says what it is and
 * when to come back; where it is not, it says so plainly rather than
 * pretending to more certainty than it has.
 *
 * Nothing here returns the underlying message. That is logged, and a stack
 * trace on a public page is an invitation.
 */

/**
 * Seconds until the daily quotas reset, which happens at midnight UTC.
 *
 * @param {number} now Milliseconds since the epoch, for a test to fix.
 * @returns {number} Whole seconds until the next 00:00 UTC.
 */
export function secondsUntilUtcMidnight(now = Date.now()) {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.round((midnight.getTime() - now) / 1000));
}

/**
 * Say how long something is in words a person reads rather than counts.
 *
 * @param {number} seconds How long.
 * @returns {string} A rounded, readable interval.
 */
function readable(seconds) {
  if (seconds < 90) {
    return "less than a minute";
  }
  if (seconds < 5400) {
    const minutes = Math.round(seconds / 60);
    return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(seconds / 3600);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Work out what to say about a failure, and what status to say it with.
 *
 * Three outcomes, and the distinction matters to whoever is reading:
 *
 * - The database has hit its daily limit. This is not broken and not
 *   permanent, it fixes itself at a knowable time, and a visitor who is told
 *   that can come back rather than conclude the service is dead. It is a 503
 *   with a `Retry-After`, which also tells a crawler to stop asking -- the
 *   thing most likely to have caused it in the first place.
 * - The database could not be reached at all. Also a 503, but with no useful
 *   time to give, so it says a minute rather than inventing one.
 * - Anything else, which is a fault in this code and answers 500, because a
 *   client retrying it will only fail again.
 *
 * @param {unknown} error Whatever was thrown.
 * @param {number} now Milliseconds since the epoch, for a test to fix.
 * @returns {{status: number, retryAfter: number|null, title: string,
 *     detail: string, transient: boolean}} What to say and how to say it.
 */
export function describeFailure(error, now = Date.now()) {
  const message = error instanceof Error ? error.message : String(error);

  // Cloudflare's own wording. Matched on the phrase rather than on `D1_ERROR`
  // alone, since every D1 failure carries that prefix and only this one is
  // worth naming a time for.
  if (/daily row read limit|exceeded .* limit/i.test(message)) {
    const seconds = secondsUntilUtcMidnight(now);
    return {
      status: 503,
      retryAfter: seconds,
      transient: true,
      title: "The catalogue is resting",
      detail:
        `Its database has reached the number of rows it may read in a day. ` +
        `Nothing is lost and nothing is broken: the allowance resets at ` +
        `midnight UTC, in ${readable(seconds)}, and everything comes back ` +
        `on its own.`,
    };
  }

  if (/D1_ERROR|Network connection lost|storage.*unavailable/i.test(message)) {
    return {
      status: 503,
      retryAfter: 60,
      transient: true,
      title: "The catalogue is unavailable",
      detail:
        "Its database could not be reached. This is usually brief — try " +
        "again in a minute.",
    };
  }

  return {
    status: 500,
    retryAfter: null,
    transient: false,
    title: "Something went wrong",
    detail:
      "This request could not be completed. The failure has been logged " +
      "with enough detail to find it; if it keeps happening, a report " +
      "saying what you were doing is the useful part.",
  };
}

/** Headers every failure carries, plus `Retry-After` when one is knowable. */
export function failureHeaders({ retryAfter }, extra = {}) {
  return {
    "cache-control": "no-store",
    ...(retryAfter === null ? {} : { "retry-after": String(retryAfter) }),
    ...extra,
  };
}
