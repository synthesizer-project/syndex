/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * What somebody sees about their own account.
 *
 * Asking for access, and the record of what they have submitted or reviewed.
 * Everything about anybody else's account -- the rows a reviewer acts on, and
 * the forms that change a role -- is `people.jsx`, and the page somebody sees
 * when they are not signed in at all is `refusals.jsx`.
 *
 * Roles are ordered, so most of this is about which end of that order the
 * reader is at: what they can already do, and what the next role would add.
 */

import { BASE } from "../base.js";
import { date, size } from "../views/format.jsx";
import { Layout } from "../views/layout.jsx";
import {
  Field,
  Fields,
  Section,
  StateBadge,
} from "./shared.jsx";

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
/**
 * Asking for permission to submit.
 *
 * A new account cannot submit, because an account that could would leave the
 * queue as open to being filled as it was before there were accounts. What it
 * can do is say who it is and what it has, which is what a reviewer reads
 * before granting access.
 *
 * @param {object} props Component props.
 * @param {object} props.counts Tab counts for the header.
 * @param {object} props.user The signed-in account.
 * @param {boolean} props.sent Whether a request was just made.
 * @param {string | null} props.error Why the request was not accepted.
 * @returns {unknown} The rendered page.
 */
export const RequestAccess = ({ counts, user, sent = false, error = null }) => {
  const allowed = user.role !== "pending";
  const waiting = !allowed && user.access_requested_at !== null;

  return (
    <Layout title="Request access" counts={counts} active={null} showSubmit={false}>
      <h1 class="text-3xl sm:text-4xl">
        {allowed ? "You can submit datasets" : "Request submit access"}
      </h1>

      {allowed && (
        <>
          <p class="mt-3 max-w-2xl text-muted">
            Your account is a {user.role}, so you already have what this page
            asks for.
          </p>
          <p class="mt-5">
            <a href={`${BASE}/submit`} class="btn no-underline">
              Submit a dataset
            </a>
          </p>
        </>
      )}

      {!allowed && (
        <p class="mt-3 max-w-2xl text-muted">
          Anyone can read the catalogue, but sending a file to it needs a
          maintainer to say yes first. That is what keeps the queue a queue of
          real datasets. Say what you would like to contribute and someone will
          look.
        </p>
      )}

      {waiting && (
        <div role="status" class="card mt-5 max-w-2xl border-accent-light p-5">
          <p class="label-caps text-accent-light">
            {sent ? "Request sent" : "Request waiting"}
          </p>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Asked on {date(user.access_requested_at)}. A maintainer will be in
            touch through GitHub. Sending it again replaces what you wrote
            rather than joining the queue twice.
          </p>
        </div>
      )}

      {error !== null && (
        <p role="alert" class="mt-4 rounded border border-accent-light p-3 text-sm">
          {error}
        </p>
      )}

      {!allowed && (
        <form
          method="post"
          action={`${BASE}/access`}
          class="card mt-4 grid max-w-2xl gap-4 p-4"
        >
          <Field
            label="What you would like to contribute"
            name="note"
            rows="4"
            maxlength="2000"
            required
            hint={
              "A sentence or two: what the data is, roughly how large, and " +
              "how it was produced. Enough for a maintainer to recognise it."
            }
          />
          <div>
            <button type="submit" class="btn">
              {waiting ? "Update request" : "Request access"}
            </button>
          </div>
        </form>
      )}

      <p class="mt-6 text-sm text-muted">
        Signed in as {user.login}
        {user.name === null ? "" : ` (${user.name})`}.
      </p>
    </Layout>
  );
};

/**
 * What each role is allowed to do, in the order the roles are granted.
 *
 * Written out rather than derived from `atLeast`, because a list of what you
 * may do is not the same text as the rule that decides it: "may grant the
 * reviewer role" is worth saying to an admin and worth not saying to anybody
 * else, and neither sentence lives anywhere in the check.
 */
const ROLE_ALLOWS = {
  pending: ["Browse and download everything in the catalogue"],
  contributor: [
    "Browse and download everything in the catalogue",
    "Submit new datasets and new releases",
  ],
  reviewer: [
    "Browse and download everything in the catalogue",
    "Submit new datasets and new releases",
    "Read the review queue and decide submissions",
    "Grant and withdraw the contributor role",
  ],
  admin: [
    "Browse and download everything in the catalogue",
    "Submit new datasets and new releases",
    "Read the review queue and decide submissions",
    "Grant and withdraw any role, including reviewer and admin",
  ],
};

/**
 * One account's own page.
 *
 * The only view somebody has of themselves: who the portal thinks they are,
 * what that lets them do, and what they have done with it. Signing out lives
 * here rather than in the header, where it was one misclick from the button
 * beside it and offered nothing else.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Account = ({ counts, user, submitted = [], reviewed = [] }) => {
  const byState = Object.fromEntries(
    submitted.map((row) => [row.state, row.n]),
  );
  const reviews = user.role === "reviewer" || user.role === "admin";
  const total = submitted.reduce((sum, row) => sum + row.n, 0);

  return (
    <Layout title="Your account" counts={counts} active={null}>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h1 class="text-3xl sm:text-4xl">{user.login}</h1>
        {/* A form, because signing out changes something. A link would let
            any page anywhere sign a reader out by embedding it. */}
        <form method="post" action={`${BASE}/logout`}>
          <button type="submit" class="btn cursor-pointer">
            Sign out
          </button>
        </form>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <Section title="Account">
          <Fields
            entries={[
              ["github", user.login],
              ["name", user.name],
              ["email", user.email],
              ["role", user.role],
              ["joined", date(user.created_at)],
            ]}
          />
        </Section>

        <Section title="What you can do">
          <ul class="space-y-2 text-sm">
            {(ROLE_ALLOWS[user.role] ?? []).map((allowed) => (
              <li class="flex gap-2">
                <span aria-hidden="true" class="text-accent-light">
                  ·
                </span>
                <span>{allowed}</span>
              </li>
            ))}
          </ul>
          {user.role === "pending" && (
            <p class="mt-4 text-sm text-muted">
              <a href={`${BASE}/access`}>Ask for submit access</a> to contribute
              datasets.
            </p>
          )}
        </Section>
      </div>

      <Section title="Your submissions">
        {total === 0 ? (
          <p class="text-sm text-muted">
            You have not submitted anything yet.
          </p>
        ) : (
          <>
            <div class="flex flex-wrap gap-x-10 gap-y-4">
              {["pending", "approved", "rejected"].map((state) => (
                <div>
                  <span class="block text-2xl tabular-nums">
                    {byState[state] ?? 0}
                  </span>
                  <span class="label-caps">{state}</span>
                </div>
              ))}
            </div>
            <p class="mt-5 text-sm">
              <a href={`${BASE}/submissions`}>All your submissions</a>
            </p>
          </>
        )}
      </Section>

      {reviews && (
        <Section title="What you have reviewed">
          {reviewed.length === 0 && (
            <p class="text-sm text-muted">Nothing reviewed yet.</p>
          )}
          <ul class="divide-y divide-line">
            {reviewed.map((submission) => (
              <li class="flex flex-wrap items-baseline gap-x-3 py-2 first:pt-0 last:pb-0">
                <a
                  href={`${BASE}/review/${submission.submission_id}`}
                  class="flex-1 font-mono text-sm break-all"
                >
                  {submission.name}
                </a>
                <StateBadge state={submission.state} />
                <span class="text-xs text-muted">
                  {date(submission.reviewed_at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Layout>
  );
};
