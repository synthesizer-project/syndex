/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Reviewing: the queue, one submission, and the decision taken on it.
 *
 * A reviewer decides two things -- whether the file is what it says it is, and
 * whether it belongs in the catalogue -- and nothing here does either for
 * them. Approving records a decision; publishing stays with `syndex-upload`.
 *
 * The queue also carries the people waiting for access, since granting one is
 * part of the same sitting: those rows are `people.jsx`, and the checker's
 * verdict on a file is `validation.jsx`. This file is what arranges them.
 */

import { BASE } from "../base.js";
import { date, size } from "../views/format.jsx";
import { Command, Layout } from "../views/layout.jsx";
import {
  ACCOUNTS_SHOWN,
  AccountRow,
  RequestRow,
  grantableFor,
} from "./people.jsx";
import {
  Fact,
  Fields,
  SectionHead,
  StateBadge,
} from "./shared.jsx";
import {
  CheckBadge,
  CheckReport,
  verdictOf,
} from "./validation.jsx";

/**
 * One step of a review, which opens when it is acknowledged.
 *
 * A checkbox rather than a details element, because what is wanted is not
 * "show me this" but "I have done this": the same control that reveals the
 * command is the record that somebody said they ran it. Nothing is enforced
 * -- a reviewer who wants to approve without fetching the file still can --
 * but skipping a step becomes something they did rather than something that
 * happened to them.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered step.
 */
const ReviewStep = ({ id, number, title, hint, children }) => (
  <li class="review-step">
    <input type="checkbox" id={id} class="peer sr-only" />
    <label
      for={id}
      class="flex cursor-pointer items-baseline gap-3 text-sm peer-checked:text-text"
    >
      <span class="label-caps">{number}</span>
      <span class="flex-1">
        {title}
        <span class="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
      <span aria-hidden="true" class="tick label-caps text-accent-light"></span>
    </label>
    <div class="mt-3 hidden peer-checked:block">{children}</div>
  </li>
);

/**
 * One waiting submission, summarised to what decides whether to open it.
 *
 * Four facts and a way in. The description, the citations, the digest and the
 * commands all live on the submission's own page: a queue is for choosing
 * what to look at, and a card carrying everything is not a summary.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @returns {unknown} The rendered card.
 */
const SubmissionCard = ({ submission }) => {
  const arrived = submission.uploaded_at !== null;

  return (
    <li>
      <a
        href={`${BASE}/review/${submission.submission_id}`}
        class="card card-link block p-6 text-text no-underline"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="font-mono text-lg break-all">{submission.name}</span>
          <StateBadge state={submission.state} />
          <CheckBadge
            state={verdictOf(submission, submission.duplicate ? {} : null)}
          />
        </div>
        <p class="mt-1 text-sm text-muted">{submission.display_name}</p>

        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>{submission.data_type}</span>
          <span class={arrived ? "" : "text-accent-light"}>
            {arrived ? size(submission.uploaded_size_bytes) : "no file yet"}
          </span>
          <span class="text-muted">{date(submission.submitted_at)}</span>
          <span class="text-muted">{submission.submitter_name}</span>
        </div>
      </a>
    </li>
  );
};

/**
 * One submission, as much of it as is worth reading.
 *
 * Ordered by what a reviewer actually decides on: what it claims to be, who
 * sent it, and whether a file of a plausible size arrived. The prose the
 * contributor wrote follows, and only when they wrote any. What is left out
 * matters as much: the R2 key is in the download command already, and
 * repeating it above only makes the things that need reading harder to find.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @param {string} props.bucket The submissions bucket's name.
 * @returns {unknown} The rendered submission.
 */
const Submission = ({ submission, bucket }) => {
  const pending = submission.state === "pending";
  const arrived = submission.uploaded_at !== null;

  return (
    <section class="card mb-6 p-6">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="font-mono text-lg break-all">{submission.name}</h3>
        <StateBadge state={submission.state} />
        <CheckBadge
          state={verdictOf(submission, submission.duplicate ? {} : null)}
        />
        <span class="text-sm text-muted">{submission.display_name}</span>
      </div>

      <div class="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="type">{submission.data_type}</Fact>
        {submission.release_of_name && (
          <Fact label="new release of">
            <span class="font-mono break-all">{submission.release_of_name}</span>
          </Fact>
        )}
        <Fact label="size">
          {arrived ? (
            size(submission.uploaded_size_bytes)
          ) : (
            <em class="text-muted">no file yet</em>
          )}
        </Fact>
        <Fact label="submitted">{date(submission.submitted_at)}</Fact>
        <Fact label="by">
          {submission.submitter_name}
          {submission.submitter_email ? (
            <>
              {" "}
              <a
                href={`mailto:${submission.submitter_email}`}
                class="text-xs break-all"
              >
                {submission.submitter_email}
              </a>
            </>
          ) : null}
        </Fact>
      </div>

      <div class="mt-5 border-t border-line pt-5">
        <Fields
          spaced
          entries={[
            ["description", submission.description],
            ["citations", submission.citations],
            ["licence", submission.licence],
            ["notes", submission.notes],
            ["reviewer note", submission.reviewer_note],
            [
              "reviewed",
              submission.reviewed_at ? date(submission.reviewed_at) : null,
            ],
          ]}
        />
      </div>

      {pending && arrived && (
        // Three steps rather than one list of commands, each acknowledged
        // before the next opens. syndex-upload publishes a local file -- it
        // opens the HDF5, verifies the digest and registers R2 and D1 in one
        // transaction, none of which a Worker can do -- so approving without
        // having fetched and opened the file is approving something nobody
        // has looked at. The ticks do not enforce that; they make skipping it
        // a thing somebody did rather than a thing that happened.
        <ol class="review-steps mt-5 space-y-3 border-t border-line pt-4">
          <ReviewStep
            id={`fetch-${submission.submission_id}`}
            number={1}
            title="Fetch the file"
            hint="Download from the submissions bucket."
          >
            <Command>
              npx wrangler r2 object get {bucket}/{submission.r2_key} --file{" "}
              {submission.name} --remote
            </Command>
          </ReviewStep>

          <ReviewStep
            id={`check-${submission.submission_id}`}
            number={2}
            title="Check it yourself"
            hint={
              "Review the file format, structure, and metadata, and " +
              "optionally rerun the validation for yourself."
            }
          >
            <Command>syndex-check {submission.name}</Command>
          </ReviewStep>

          <ReviewStep
            id={`publish-${submission.submission_id}`}
            number={3}
            title={
              submission.release_of_name
                ? "Publish it as a new release"
                : "Publish it"
            }
            hint={
              submission.release_of_name
                ? "Publish it as a new release of that dataset and approve below if all looks well."
                : "Publish it to the database and approve below if all looks well."
            }
          >
            <Command>
              syndex-upload {submission.name} --data-type{" "}
              {submission.data_type === "other"
                ? "CHOOSE-A-TYPE"
                : submission.data_type}
            </Command>
            {submission.data_type === "other" && (
              <p class="mt-2 text-xs text-muted">
                Submitted as <strong>other</strong>, so the type is yours to
                choose. It may be one the catalogue does not have yet.
              </p>
            )}
          </ReviewStep>
        </ol>
      )}

      {pending && (
        <form
          method="post"
          action={`${BASE}/review/${submission.submission_id}`}
          class="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
        >
          <label for={`note-${submission.submission_id}`} class="min-w-48 flex-1">
            <span class="label-caps mb-1 block">Note</span>
            <input
              id={`note-${submission.submission_id}`}
              name="reviewer_note"
              maxlength="1000"
              placeholder="Why, especially if you are rejecting it — this is what the contributor is told."
              class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
            />
          </label>
          <button type="submit" name="decision" value="approved" class="btn">
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            class="btn-quiet"
          >
            Reject
          </button>
        </form>
      )}
    </section>
  );
};

/**
 * The review queue.
 *
 * A way in to the things that need deciding, rather than the deciding itself.
 * Three kinds of thing wait here and they are not the same kind: people
 * nobody has answered, files nobody has read, and the record of everything
 * already settled. Each is summarised to what decides whether to open it, and
 * opening it is a page of its own -- which is what stops one long submission
 * with a lot to say from burying the six behind it.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Review = ({
  counts,
  submissions,
  approvedCount = 0,
  rejectedCount = 0,
  recent = [],
  people = [],
  accountCount = 0,
  viewer,
  note = null,
}) => {
  const grantable = grantableFor(viewer);
  const asking = people.filter((person) => person.access_requested_at !== null);
  const holding = people.filter((person) => person.access_requested_at === null);

  return (
    <Layout title="Review queue" counts={counts} active={null}>
      <h1 class="mb-8 text-3xl sm:text-4xl">Review queue</h1>

      {note !== null && (
        <p role="status" class="mb-8 rounded border border-accent-light p-3 text-sm">
          {note}
        </p>
      )}

      {asking.length > 0 && (
        <section class="mb-10">
          <SectionHead title={`Waiting for access (${asking.length})`} />
          <ul class="card divide-y divide-line p-0">
            {asking.map((person) => (
              <RequestRow
                person={person}
                grantable={grantable}
                viewer={viewer}
                from="review"
              />
            ))}
          </ul>
        </section>
      )}

      <section class="mb-10">
        <SectionHead
          title={
            submissions.length === 0
              ? "Nothing waiting to be read"
              : `Waiting to be read (${submissions.length})`
          }
        />
        {submissions.length === 0 ? (
          <p class="text-muted">
            Every submission has been decided. Contributors are told the
            outcome on their own submission page.
          </p>
        ) : (
          <ul class="grid gap-6 sm:grid-cols-2">
            {submissions.map((submission) => (
              <SubmissionCard submission={submission} />
            ))}
          </ul>
        )}
      </section>

      {approvedCount + rejectedCount > 0 && (
        <section class="mb-10">
          <SectionHead title="Past submissions" />
          <a
            href={`${BASE}/review/previous`}
            class="card card-link block p-6 text-text no-underline"
          >
            <div class="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <span class="block text-2xl tabular-nums">{approvedCount}</span>
                <span class="label-caps">approved</span>
              </div>
              <div>
                <span class="block text-2xl tabular-nums">{rejectedCount}</span>
                <span class="label-caps">rejected</span>
              </div>
            </div>
            {recent.length > 0 && (
              <ul class="mt-5 grid gap-2 border-t border-line pt-4 text-sm">
                {recent.map((submission) => (
                  <li class="flex flex-wrap items-baseline gap-x-3">
                    <span class="flex-1 font-mono break-all">
                      {submission.name}
                    </span>
                    <StateBadge state={submission.state} />
                    <span class="text-xs text-muted">
                      {date(submission.reviewed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </a>
        </section>
      )}

      {holding.length > 0 && (
        <section>
          <SectionHead
            title="Accounts"
            action={
              <a href={`${BASE}/accounts`} class="text-sm">
                {accountCount > ACCOUNTS_SHOWN
                  ? `All ${accountCount} accounts`
                  : "Manage accounts"}
              </a>
            }
          />
          <ul class="card divide-y divide-line p-0">
            {holding.slice(0, ACCOUNTS_SHOWN).map((person) => (
              <AccountRow
                person={person}
                grantable={grantable}
                viewer={viewer}
                from="review"
              />
            ))}
          </ul>
        </section>
      )}
    </Layout>
  );
};

/**
 * One submission, on a page of its own, with the decision on it.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const SubmissionReview = ({
  counts,
  submission,
  bucket,
  duplicate = null,
}) => (
  <Layout title={`Review ${submission.name}`} counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/review`}>Back to the queue</a>
    </p>
    <h1 class="mb-8 text-3xl break-all sm:text-4xl">{submission.name}</h1>
    <Submission submission={submission} bucket={bucket} />
    <CheckReport submission={submission} duplicate={duplicate} />
  </Layout>
);

/**
 * Everything already settled, on a page of its own.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const PreviousSubmissions = ({ counts, submissions, bucket }) => (
  <Layout title="Past submissions" counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/review`}>Back to the queue</a>
    </p>
    <h1 class="mb-8 text-3xl sm:text-4xl">Past submissions</h1>
    {submissions.length === 0 && (
      <p class="text-muted">Nothing has been decided yet.</p>
    )}
    {submissions.map((submission) => (
      <Submission submission={submission} bucket={bucket} />
    ))}
  </Layout>
);
