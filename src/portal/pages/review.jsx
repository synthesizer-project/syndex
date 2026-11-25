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
import {
  STALE_AFTER_MS,
  publishMetadata,
  publishable,
} from "../data/publication.js";
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
  Section,
  SectionHead,
  StateBadge,
} from "./shared.jsx";
import {
  CheckBadge,
  CheckReport,
  verdictOf,
} from "./validation.jsx";

/**
 * What a reviewer can do to a dataset from its own page: retire it, retire
 * one release of it, or take either back.
 *
 * Rendered on the dataset page but kept here, with everything else only a
 * reviewer is shown. One form with a choice of what, rather than a button per
 * release, because every deprecation needs a reason and a reason field on
 * every row of the release table would be most of the table.
 *
 * @param {object} props Component props.
 * @param {object} props.dataset The dataset, with its releases.
 * @returns {unknown} The rendered section.
 */
export const Deprecation = ({ dataset }) => {
  const action = `${BASE}/datasets/${encodeURIComponent(dataset.name)}/deprecate`;
  const field = "w-full rounded-lg border border-muted bg-bg px-3 py-1.5";
  const deprecated = [
    ...(dataset.deprecated_at != null
      ? [{ label: "the whole dataset", release: "" }]
      : []),
    ...dataset.releases
      .filter((release) => release.deprecated_at != null)
      .map((release) => ({
        label: `release ${release.release_id}`,
        release: release.release_id,
      })),
  ];

  return (
    <Section title="Deprecate">
      <p class="mb-4 text-sm text-muted">
        Only reviewers see this. Nothing is deleted: the files stay
        downloadable, and the catalogue says they are deprecated and why.
        Deprecate the whole dataset when people should use something else, or
        one release when they should use a newer one.
      </p>
      <form
        method="post"
        action={action}
        data-confirm={`Mark this as deprecated? The catalogue and the API will say so at once.`}
        class="flex flex-wrap items-end gap-3"
      >
        <label for="deprecate-what">
          <span class="label-caps mb-1 block">What</span>
          <select id="deprecate-what" name="release" class={field}>
            <option value="">The whole dataset</option>
            {dataset.releases.map((release) => (
              <option value={release.release_id}>
                Release {release.release_id}
              </option>
            ))}
          </select>
        </label>
        <label for="deprecate-reason" class="min-w-48 flex-1">
          <span class="label-caps mb-1 block">Reason</span>
          <input
            id="deprecate-reason"
            name="reason"
            required
            maxlength="1000"
            placeholder="What to use instead, or what is wrong with it."
            class={field}
          />
        </label>
        <button type="submit" class="btn">
          Deprecate
        </button>
      </form>
      {deprecated.map((item) => (
        <form method="post" action={action} class="mt-3">
          <input type="hidden" name="undo" value="1" />
          <input type="hidden" name="release" value={item.release} />
          <button type="submit" class="btn-quiet">
            Remove the deprecation from {item.label}
          </button>
        </form>
      ))}
    </Section>
  );
};

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
 * The commands that publish a submission, carrying what its contributor wrote.
 *
 * A bare `syndex-upload NAME` publishes the file with its filename as the
 * display name, no description, no citations, and no current release -- which
 * is how two approved grids once reached nobody. Everything the contributor
 * filled in goes in a metadata file instead, written by a quoted heredoc so
 * that nothing in their prose is read by the shell.
 *
 * @param {object} submission The submission row.
 * @returns {string} The shell commands, a dry run before the real one.
 */
export function publishCommands(submission) {
  const entry = publishMetadata(submission);
  const type =
    submission.data_type === "other" ? "CHOOSE-A-TYPE" : submission.data_type;
  const metadata = `${submission.name}.json`;
  const upload = `syndex-upload ${submission.name} --metadata ${metadata} --data-type ${type}`;
  const json = JSON.stringify({ files: { [submission.name]: entry } }, null, 2);

  return [
    `cat > ${metadata} <<'SYNDEX_EOF'`,
    json,
    "SYNDEX_EOF",
    `${upload} --dry-run`,
    upload,
    `syndex-previews --only ${submission.name} --apply`,
  ].join("\n");
}

/**
 * The stages a submission passes through, in order.
 *
 * One list read twice: as the flow chart across the top of the queue, and as
 * the sections of the page each box links to, so the two cannot disagree.
 */
export const STAGES = [
  {
    id: "submitted",
    title: "Submitted",
    who: "Contributor",
    summary: "Metadata and file sent",
    body: [
      "Somebody with the contributor role fills in the form at /syndex/submit, or runs syndex-submit from a machine that already has the file. The file arrives in 90 MiB pieces in the submissions bucket.",
      "A submission only reaches this queue once its file has arrived. One registered and abandoned stays on the contributor's own page, marked as having sent nothing.",
    ],
  },
  {
    id: "validated",
    title: "Validated",
    who: "Automatic",
    summary: "syndex-check runs on GitHub Actions",
    body: [
      "Completing an upload starts a GitHub Actions run that fetches the file, runs syndex-check, hashes it, and posts the verdict back. The badge on each card is that verdict: passed, failed, or ambiguous (nothing identified, so the type is the reviewer's call).",
      "It also says whether the catalogue or the queue already holds exactly these bytes. A failed or missing verdict blocks nothing: read the report, or run the checker yourself in the next stage.",
    ],
  },
  {
    id: "checked",
    title: "Checked",
    who: "Reviewer",
    summary: "Fetch the file and read it",
    body: [
      "Download the file from the submissions bucket with the command on the submission's page, and run syndex-check on it. Look at the type, the axes, and whether the name, description and citations describe what is actually there.",
      "Questions go to the contributor by email; their address is on the submission. If it is wrong in a way they cannot fix, reject it now with a note saying why.",
    ],
  },
  {
    id: "decided",
    title: "Approved",
    who: "Reviewer",
    summary: "Approve, or reject with a note",
    body: [
      "Approve on the submission's page once you are satisfied. Approving publishes it: the next stage starts at once, with nothing more for you to run.",
      "Rejecting can be done at any stage, with a note the contributor reads on their submission page. Neither decision is undone from here; a published mistake is a deprecation and a new release.",
    ],
  },
  {
    id: "published",
    title: "Published",
    who: "Automatic",
    summary: "syndex-upload runs on GitHub Actions",
    body: [
      "Approval starts a GitHub Actions run that fetches the file, publishes it with syndex-upload using what the contributor wrote (display name, description, citations), makes it the dataset's current release, and renders its preview plot. The submission's page says whether it is running, done, or failed.",
      "A failed run, or one that could not be started, leaves a Try again button and the commands to publish it by hand. Runners have 14 GB of disk, so the largest grids are published by hand from a machine that already has them.",
    ],
  },
];

/**
 * The stages as a row of linked boxes, wrapping to a column on a phone.
 *
 * @returns {unknown} The rendered flow chart.
 */
const ReviewFlow = () => (
  <nav aria-label="How a submission is reviewed" class="mb-10">
    <ol class="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      {STAGES.map((stage, index) => (
        <li class="flex flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <a
            href={`${BASE}/review/process#${stage.id}`}
            class="card card-link block flex-1 p-3 text-text no-underline"
          >
            <span class="label-caps block">
              {index + 1} · {stage.who}
            </span>
            <span class="block">{stage.title}</span>
            <span class="block text-xs text-muted">{stage.summary}</span>
          </a>
          {index < STAGES.length - 1 && (
            <span aria-hidden="true" class="text-center text-muted">
              <span class="sm:hidden">↓</span>
              <span class="hidden sm:inline">→</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

/**
 * What each stage of a review involves, one section per box of the chart.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const ReviewProcess = ({ counts }) => (
  <Layout title="How review works" counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/review`}>Back to the queue</a>
    </p>
    <h1 class="mb-8 text-3xl sm:text-4xl">How review works</h1>
    <ReviewFlow />
    {STAGES.map((stage, index) => (
      <section id={stage.id} class="card mb-5 scroll-mt-6 p-6">
        <h2 class="mb-1 text-xl">
          {index + 1}. {stage.title}
        </h2>
        <p class="label-caps mb-4">{stage.who}</p>
        {stage.body.map((paragraph) => (
          <p class="mb-3 max-w-prose last:mb-0">{paragraph}</p>
        ))}
      </section>
    ))}
  </Layout>
);

/**
 * Where an approved submission's publication has got to.
 *
 * Approving asks a GitHub Actions run to publish the file; this is what that
 * run reported. When there is no run to wait for -- it failed, or one could
 * not be asked for -- the commands to do it by hand are here, and so is the
 * button to ask again.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The approved submission row.
 * @param {string} props.bucket The submissions bucket's name.
 * @returns {unknown} The rendered panel.
 */
const Publication = ({ submission, bucket }) => {
  const state = submission.publication_state ?? null;
  let report = null;
  try {
    report = JSON.parse(submission.publication_report_json ?? "null");
  } catch {
    report = null;
  }
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  // A run that has had longer than the workflow may take and never reported:
  // killed, or its report lost. Publishing upserts, so asking again is safe.
  const stale =
    state === "running" &&
    Date.now() - Date.parse(submission.publication_started_at ?? "") > STALE_AFTER_MS;
  const retryable = state === null || state === "failed" || stale;

  return (
    <div class="text-sm">
      {state === "published" && (
        <p>
          Published {date(submission.published_at)}:{" "}
          <a href={`${BASE}/datasets/${encodeURIComponent(submission.name)}`}>
            {submission.name}
          </a>
        </p>
      )}
      {state === "running" && !stale && (
        <p>Being published by a GitHub Actions run. This page updates when it reports back.</p>
      )}
      {stale && (
        <p class="text-accent-light">
          The publication run never reported back. It may have published and
          lost its report; asking again is safe either way.
        </p>
      )}
      {state === "failed" && (
        <>
          <p class="text-accent-light">The publication run failed.</p>
          {errors.length > 0 && (
            <ul class="mt-2 list-disc pl-5">
              {errors.map((error) => (
                <li>{String(error)}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {state === null && (
        <p>
          {publishable(submission)
            ? "Not sent to be published: a run could not be asked for."
            : "Not sent to be published: submitted as other, so the type is yours to choose."}
        </p>
      )}
      {retryable && (
        <>
          {publishable(submission) && (
            <form
              method="post"
              action={`${BASE}/review/${submission.submission_id}/publish`}
              class="mt-3"
            >
              <button type="submit" class="btn">
                {state === null ? "Publish" : "Try again"}
              </button>
            </form>
          )}
          <details class="mt-3">
            <summary class="cursor-pointer text-muted">Publish it by hand</summary>
            <p class="my-2 text-xs text-muted">
              Read the dry run before the real one.
            </p>
            <Command>
              {`npx wrangler r2 object get ${bucket}/${submission.r2_key} --file ${submission.name} --remote\n`}
              {publishCommands(submission)}
            </Command>
          </details>
        </>
      )}
    </div>
  );
};

/**
 * Where an approved submission's publication is, in a word and a colour.
 *
 * @param {object} props Component props.
 * @param {string | null} props.state The recorded publication state.
 * @returns {unknown} The rendered badge.
 */
const PublicationBadge = ({ state }) => {
  const looks = {
    published: ["published", "border border-accent-light text-accent-light"],
    running: ["publishing…", "border border-line text-muted"],
    failed: ["failed", "bg-accent-light text-bg"],
  };
  const [word, style] = looks[state] ?? ["not started", "border border-line text-muted"];
  return <span class={`rounded-full px-2.5 py-0.5 text-xs ${style}`}>{word}</span>;
};

/**
 * The three things a submission's status is made of, each named.
 *
 * Side by side, two unlabelled pills read as one status said twice; "pending"
 * next to "passed" says nothing about which is the review and which the file.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @param {object | null} props.duplicate Whatever already holds its bytes.
 * @returns {unknown} The rendered strip.
 */
const StatusStrip = ({ submission, duplicate = null }) => (
  <dl class="flex flex-wrap gap-x-8 gap-y-3">
    <div>
      <dt class="label-caps mb-1">Review</dt>
      <dd><StateBadge state={submission.state} /></dd>
    </div>
    <div>
      <dt class="label-caps mb-1">Validation</dt>
      <dd>
        <CheckBadge state={verdictOf(submission, duplicate)} />
        {submission.validation_state == null && (
          <span class="text-xs text-muted">not run</span>
        )}
      </dd>
    </div>
    {submission.state === "approved" && (
      <div>
        <dt class="label-caps mb-1">Publication</dt>
        <dd><PublicationBadge state={submission.publication_state ?? null} /></dd>
      </div>
    )}
  </dl>
);

/**
 * One submission, summarised to what decides whether to open it.
 *
 * Name, status, and four labelled facts. The description, the citations, the
 * digest and the commands all live on the submission's own page: a queue is
 * for choosing what to look at, and a card carrying everything is not a
 * summary.
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
        class="card card-link block h-full p-6 text-text no-underline"
      >
        <span class="block font-mono text-lg break-all">{submission.name}</span>
        <p class="mt-1 text-sm text-muted">{submission.display_name}</p>

        <div class="mt-4">
          <StatusStrip
            submission={submission}
            duplicate={submission.duplicate ? {} : null}
          />
        </div>

        <div class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          <Fact label="type">{submission.data_type}</Fact>
          <Fact label="size">
            {arrived ? (
              size(submission.uploaded_size_bytes)
            ) : (
              <span class="text-accent-light">no file yet</span>
            )}
          </Fact>
          <Fact label="submitted">{date(submission.submitted_at)}</Fact>
          <Fact label="by">{submission.submitter_name}</Fact>
        </div>
      </a>
    </li>
  );
};

/**
 * What a reviewer has to do next, and the controls to do it.
 *
 * One card, first on the page and set apart by its border, because it is the
 * reason the page was opened. What it holds follows the state: the checks and
 * the decision while pending, the publication once approved, the note once
 * rejected.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @param {string} props.bucket The submissions bucket's name.
 * @returns {unknown} The rendered card.
 */
const NextStep = ({ submission, bucket }) => {
  const pending = submission.state === "pending";
  const arrived = submission.uploaded_at !== null;
  const title = pending
    ? "Decide"
    : submission.state === "approved"
      ? "Publication"
      : "Rejected";

  return (
    <section class="card mb-6 border-accent-light p-6">
      <h2 class="mb-4 text-xl">{title}</h2>

      {pending && !arrived && (
        <p class="text-sm text-muted">
          The file has not arrived yet, so there is nothing to approve. It can
          still be rejected.
        </p>
      )}

      {pending && arrived && (
        // Each step acknowledged before the next opens. Nothing is enforced
        // -- a reviewer can approve without fetching the file -- but skipping
        // a step becomes a thing somebody did rather than a thing that
        // happened.
        <ol class="review-steps mb-5 space-y-3">
          <ReviewStep
            id={`fetch-${submission.submission_id}`}
            number={1}
            title="Fetch the file"
            hint="Download it from the submissions bucket."
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
              "Compare what the file contains with what the contributor " +
              "says, and optionally rerun the validation."
            }
          >
            <Command>syndex-check {submission.name}</Command>
          </ReviewStep>
        </ol>
      )}

      {pending && (
        <form
          method="post"
          action={`${BASE}/review/${submission.submission_id}`}
          class="flex flex-wrap items-end gap-3 border-t border-line pt-4"
        >
          <label for={`note-${submission.submission_id}`} class="min-w-48 flex-1">
            <span class="label-caps mb-1 block">Note to the contributor</span>
            <input
              id={`note-${submission.submission_id}`}
              name="reviewer_note"
              maxlength="1000"
              placeholder="Why, especially if you are rejecting it."
              class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
            />
          </label>
          <button
            type="submit"
            name="decision"
            value="approved"
            data-confirm={`Approve ${submission.name}? It is published to the catalogue at once, the contributor is told, and neither is undone from here.`}
            class="btn"
          >
            Approve and publish
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            data-confirm={`Reject ${submission.name}? The contributor is told, with the note above, and the decision is not undone from here.`}
            class="btn-quiet"
          >
            Reject
          </button>
        </form>
      )}

      {submission.state === "approved" && (
        <Publication submission={submission} bucket={bucket} />
      )}

      {!pending && (
        <div class={submission.state === "approved" ? "mt-4 border-t border-line pt-4" : ""}>
          <Fields
            entries={[
              ["decided", submission.reviewed_at ? date(submission.reviewed_at) : null],
              ["note", submission.reviewer_note],
            ]}
          />
        </div>
      )}
    </section>
  );
};

/**
 * What the contributor says the submission is.
 *
 * Kept apart from what the file contains, because comparing the two is most
 * of a review.
 *
 * @param {object} props Component props.
 * @param {object} props.submission The submission row.
 * @returns {unknown} The rendered card.
 */
const Claim = ({ submission }) => (
  <Section title="What the contributor says">
    <Fields
      spaced
      entries={[
        ["type", submission.data_type],
        [
          "new release of",
          submission.release_of_name ? (
            <span class="font-mono break-all">{submission.release_of_name}</span>
          ) : null,
        ],
        ["description", submission.description],
        [
          "citations",
          submission.citations ? (
            <ul>
              {submission.citations
                .split(/\s+/)
                .filter(Boolean)
                .map((bibcode) => (
                  <li class="font-mono">{bibcode}</li>
                ))}
            </ul>
          ) : null,
        ],
        ["licence", submission.licence],
        ["notes", submission.notes],
        [
          "size",
          submission.uploaded_at !== null ? size(submission.uploaded_size_bytes) : "no file yet",
        ],
        ["submitted", date(submission.submitted_at)],
        [
          "by",
          <>
            {submission.submitter_name}
            {submission.submitter_email && (
              <a
                href={`mailto:${submission.submitter_email}`}
                class="block text-xs break-all"
              >
                {submission.submitter_email}
              </a>
            )}
          </>,
        ],
      ]}
    />
  </Section>
);

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
      <ReviewFlow />

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
 * Status first, then what to do about it, then the two things a reviewer
 * compares: what the contributor says, and what the file contains.
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
    <h1 class="text-2xl break-all sm:text-3xl">{submission.name}</h1>
    <p class="mt-1 mb-6 text-muted">{submission.display_name}</p>
    <div class="mb-8">
      <StatusStrip submission={submission} duplicate={duplicate} />
    </div>

    <NextStep submission={submission} bucket={bucket} />

    <div class="grid items-start gap-x-6 lg:grid-cols-2">
      <Claim submission={submission} />
      <CheckReport submission={submission} duplicate={duplicate} />
    </div>
  </Layout>
);

/**
 * Everything already settled, on a page of its own.
 *
 * The same cards as the queue, newest decision first: each opens the
 * submission's own page, where the detail is.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const PreviousSubmissions = ({ counts, submissions }) => (
  <Layout title="Past submissions" counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/review`}>Back to the queue</a>
    </p>
    <h1 class="mb-8 text-3xl sm:text-4xl">Past submissions</h1>
    {submissions.length === 0 ? (
      <p class="text-muted">Nothing has been decided yet.</p>
    ) : (
      <ul class="grid gap-6 sm:grid-cols-2">
        {submissions.map((submission) => (
          <SubmissionCard submission={submission} />
        ))}
      </ul>
    )}
  </Layout>
);
