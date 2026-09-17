/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Contributing: choosing what kind of submission this is, describing it, and
 * sending the file.
 *
 * The order matters and the pages follow it. A submission is a decision, then
 * a description, then bytes -- and each of those is a page, because answering
 * all three at once is how somebody uploads 30 GB before finding out the
 * catalogue name was taken.
 */

import { BASE } from "../base.js";
import { date, size } from "../views/format.jsx";
import { Command, Layout } from "../views/layout.jsx";
import {
  Field,
  Fields,
  Gate,
  ResubmitIcon,
  Section,
  SectionHead,
  StateBadge,
} from "./shared.jsx";
import {
  CheckBadge,
  CheckReport,
  verdictOf,
} from "./validation.jsx";

/** Data types a submission may claim, as the catalogue spells them. */
const DATA_TYPES = [
  "grid",
  "dust_grid",
  "instrument",
  "simulation_data",
  "generation_data",
  "synference_data",
  // Regression references. Present in the catalogue and missing from this
  // list until now, so there was a kind of data the form could not describe.
  "reference_data",
  "cache",
];

/**
 * What the submission form offers, which is one more than the catalogue holds.
 *
 * "other" is not a catalogue type and never becomes one. It is a submission
 * saying "this is none of those", which is a real and useful answer: the
 * alternative is a contributor picking whichever listed type is least wrong,
 * and a reviewer then having to work out that they did. A reviewer publishes
 * it under whatever type it turns out to be, minting a new one if that is
 * what it needs.
 */
export const SUBMISSION_TYPES = [...DATA_TYPES, "other"];

/**
 * One entry already in the catalogue, per data type.
 *
 * Shown as placeholder text in the boxes themselves: "what should I write
 * here" is answered better by a real entry than by instruction, and answered
 * best of all in the box being asked about. Short ones, since a placeholder
 * that overflows its input teaches nothing.
 *
 * Placeholders rather than prefilled values, deliberately. A prefilled
 * description is one somebody submits unchanged.
 */
const TYPE_EXAMPLES = {
  grid: {
    name: "bpass-2p2p1-bin-chabrier03-0p1-300p0",
    display_name: "BPASS 2.2.1 binary, Chabrier (2003) IMF",
    description:
      "BPASS binary models with a Chabrier (2003) IMF over 0.1 to 300 solar " +
      "masses. Incident only: not processed through a photoionisation code.",
  },
  dust_grid: {
    name: "draine-li-dust-extcurve-mrn",
    display_name: "Draine and Li MRN dust extinction curve grid",
    description:
      "Dust attenuation curves using an MRN grain size distribution, with " +
      "small, large and PAH grain centres.",
  },
  instrument: {
    name: "euclid-nisp-instrument",
    display_name: "Euclid NISP instrument",
    description:
      "Instrument cache for the Euclid NISP photometric imager. Filters and " +
      "resolution are read from the file, not entered here.",
  },
  simulation_data: {
    name: "sc-sam-sfhist-test",
    display_name: "SC-SAM test star-formation history",
    description:
      "Reduced SC-SAM star-formation history used by the test suite. Not " +
      "suitable for science.",
  },
  generation_data: {
    name: "generation-ssp-m11-pickles-ssz002",
    display_name: "Grid generation input: ssp_M11_Pickles.ssz002",
    description:
      "Raw model input used to build Maraston (2011) grids, kept so they can " +
      "be regenerated from their original inputs.",
  },
  synference_data: {
    name: "synference-grid-bpass-chab-densebasis-sfh",
    display_name: "Synference input: BPASS Chabrier, DenseBasis SFH",
    description:
      "Input file for Synference, the simulation based inference toolkit " +
      "built on Synthesizer.",
  },
  reference_data: {
    name: "golden-pipeline-reference",
    display_name: "Golden pipeline regression reference",
    description: "Float64 reference output for full-pipeline regression tests.",
  },
  cache: {
    name: "svo-filter-cache",
    display_name: "SVO filter profile service cache",
    description:
      "Archived SVO filter response curves, downloaded to avoid hammering " +
      "the SVO database during CI. A mechanical dependency, not science.",
  },
  other: {
    name: "my-new-kind-of-data",
    display_name: "Something the catalogue has no type for yet",
    description:
      "Say what this is and what it is for. A reviewer will decide what to " +
      "publish it as, and can add a new type if it needs one.",
  },
};

/** What the boxes show before a type has been chosen. */
const DEFAULT_EXAMPLE = TYPE_EXAMPLES.grid;

/**
 * How many citation rows are rendered without being asked for.
 *
 * One. Most submissions need one or none, and four empty boxes read as four
 * things somebody has failed to fill in. `submit.js` adds more on request,
 * which costs nothing that was not already spent: sending the file needs
 * JavaScript too, so a browser without it cannot complete a submission
 * whatever this number is.
 */
const CITATION_ROWS = 1;

/**
 * Where a submission starts: which of the two things this is.
 *
 * Asked first because the answer changes everything after it. A new dataset
 * is described from nothing and gets a name nobody has used; a new release
 * keeps the name of the dataset it belongs to and inherits its description.
 * Sending somebody down one path and refusing them at the end -- which is
 * what the name check used to do -- is a worse way to find out which they
 * needed.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const SubmitChoice = ({
  counts,
  open,
  user,
  limit,
  mine = [],
  more = false,
}) => (
  <Layout title="Submit a dataset" counts={counts} active={null} showSubmit={false}>
    <h1 class="text-3xl sm:text-4xl">Submit a dataset</h1>
    {open && (
      <p class="mt-3 max-w-2xl text-sm text-muted">
        Submitting as {user.login}
        {user.email === null ? "" : ` (${user.email})`}. Uploads are limited to{" "}
        {size(limit)}.
      </p>
    )}

    {!open && (
      <div role="status" class="card mt-5 max-w-2xl border-accent-light p-5">
        <p class="label-caps text-accent-light">Not open yet</p>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          Submission is not accepting uploads yet. Open an issue on{" "}
          <a
            href="https://github.com/synthesizer-project/synthesizer/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            the Synthesizer repository
          </a>{" "}
          and a maintainer will arrange to take the file.
        </p>
      </div>
    )}

    {open && (
      <div class="mt-8 grid gap-6 sm:grid-cols-2">
        {/* The whole card is the link, the way the landing page's data-type
            cards are. There is one thing to do in each, so a button inside
            would be a second, smaller target for the same thing -- and the
            portal already has this pattern rather than needing a new one. */}
        <a
          href={`${BASE}/submit/new`}
          class="card card-link block p-7 text-text no-underline"
        >
          <h2 class="text-xl">New dataset</h2>
          <p class="mt-3 text-sm text-muted">
            Submit a new dataset not already in the database.
          </p>
        </a>

        <a
          href={`${BASE}/submit/release`}
          class="card card-link block p-7 text-text no-underline"
        >
          <h2 class="text-xl">New release</h2>
          <p class="mt-3 text-sm text-muted">
            Find and submit a new version of an existing dataset.
          </p>
        </a>
      </div>
    )}

    <YourSubmissions mine={mine} more={more} />
  </Layout>
);

/**
 * The form that describes a submission, before any bytes are sent.
 *
 * Every field is here rather than spread over steps, because the answer to
 * "what else do you need from me" should be visible in one screen -- but
 * nothing is asked twice: the size, the digest and the filename are read off
 * the file once it arrives.
 *
 * It renders itself again with errors and with whatever was typed, so a
 * rejected submission is corrected rather than re-entered.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered form.
 */
export const Submit = ({
  counts,
  open,
  user,
  limit,
  releaseOf = null,
  values = {},
  errors = [],
}) => {
  const rows = values.citation_rows ?? [];

  return (
    <Layout title="Submit a dataset" counts={counts} active={null} showSubmit={false}>
      <p class="mb-4 text-sm">
        <a href={`${BASE}/submit`}>Back to submitting</a>
      </p>
      <h1 class="text-3xl sm:text-4xl">
        {releaseOf === null ? "A new dataset" : "A new release"}
      </h1>
      <p class="mt-3 max-w-2xl text-muted">
        {releaseOf === null
          ? "Describe it, then send the file."
          : `Of ${releaseOf.display_name}. Its details are filled in below; change whatever this version changes, then send the file.`}
      </p>
      {open && (
        <>
          <p class="mt-2 max-w-2xl text-sm text-muted">
            Submitting as {user.login}
            {user.email === null ? "" : ` (${user.email})`}. Uploads are
            limited to {size(limit)}. Fields marked{" "}
            <span aria-hidden="true">*</span> are required.
          </p>
        </>
      )}

      {!open && (
        <div role="status" class="card mt-5 max-w-2xl border-accent-light p-5">
          <p class="label-caps text-accent-light">Not open yet</p>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Submission is not accepting uploads yet. Open an issue on{" "}
            <a
              href="https://github.com/synthesizer-project/synthesizer/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              the Synthesizer repository
            </a>{" "}
            and a maintainer will arrange to take the file.
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" class="mt-4 rounded border border-accent-light p-3 text-sm">
          <p class="mb-1">This submission was not accepted:</p>
          <ul class="list-disc pl-5">
            {errors.map((message) => (
              <li>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <form
          id="submit-form"
          method="post"
          action={`${BASE}/submit/new`}
          // Read by submit.js to swap the placeholders when the type changes.
          // An attribute rather than a script tag: attribute values are
          // entity-decoded by the parser, and a script's text is not, so an
          // ampersand in an example would arrive as "&amp;".
          data-examples={JSON.stringify(TYPE_EXAMPLES)}
          class="mt-6 max-w-3xl"
        >
          <fieldset class="card grid gap-5 p-6 sm:grid-cols-2">
            <legend class="label-caps px-2">What it is</legend>

            {/* First and alone, because everything below reads differently
                depending on the answer -- and because an unanswered question
                is a better prompt than a field whose default is a guess. */}
            {releaseOf !== null && (
              <input type="hidden" name="release_of" value={releaseOf.dataset_id} />
            )}
            <label for="data_type" class="block sm:col-span-2">
              <span class="label-caps mb-1 block">
                Data type <span aria-hidden="true">*</span>
              </span>
              <select
                id="data_type"
                name="data_type"
                required
                class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
              >
                <option value="" disabled selected={!values.data_type}>
                  Select a data type…
                </option>
                {SUBMISSION_TYPES.map((type) => (
                  <option value={type} selected={values.data_type === type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>

            {/* The placeholders start on the commonest type and are swapped
                by submit.js when another is chosen. With no script they stay
                as they are, which is a real example rather than nothing. */}
            <div class="needs-type contents">
              <Field
                label="Catalogue name"
                name="name"
                value={values.name}
                required
                readonly={releaseOf !== null}
                maxlength="128"
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder={DEFAULT_EXAMPLE.name}
                hint={
                  releaseOf === null
                    ? "Lowercase, digits and hyphens. No spaces. People download by this."
                    : "Fixed: keeping the name is what makes this a new release rather than a second dataset."
                }
              />
              <Field
                label="Display name"
                name="display_name"
                value={values.display_name}
                required
                maxlength="256"
                placeholder={DEFAULT_EXAMPLE.display_name}
              />
              <div class="sm:col-span-2">
                <Field
                  label="Description"
                  name="description"
                  value={values.description}
                  rows="4"
                  maxlength="4000"
                  placeholder={DEFAULT_EXAMPLE.description}
                  hint="What it is, and what it is not suitable for."
                />
              </div>
            </div>
          </fieldset>

          <div class="needs-type">
            <fieldset class="card mt-5 p-6">
              <legend class="label-caps px-2">Citation</legend>
              <Gate
                name="has_citations"
                question="This data requires citations"
                checked={values.has_citations === true}
              >
                <p class="mb-3 text-sm text-muted">
                  Enter the ADS bibcodes for your citations.
                </p>
                <div id="citations" class="grid gap-2">
                  {Array.from({
                    length: Math.max(CITATION_ROWS, rows.length),
                  }).map((_, index) => (
                    <input
                      name="citation"
                      value={rows[index] ?? ""}
                      maxlength="19"
                      placeholder="2017PASA...34...58E"
                      class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5 font-mono text-sm"
                    />
                  ))}
                </div>
                {/* Revealed by submit.js: with no script there are already
                    more boxes than any ordinary submission needs. */}
                <button
                  type="button"
                  id="add-citation"
                  hidden
                  class="btn-quiet mt-2 cursor-pointer text-xs"
                >
                  Add another
                </button>
              </Gate>
            </fieldset>

            <fieldset class="card mt-5 p-6">
              <legend class="label-caps px-2">Licence</legend>
              <Gate
                name="has_licence"
                question="This data comes with a licence"
                checked={values.has_licence === true}
              >
                <Field
                  label="Licence"
                  name="licence"
                  value={values.licence}
                  maxlength="128"
                  placeholder="GPL-3.0-or-later"
                  hint="An SPDX identifier, such as GPL-3.0-or-later or CC-BY-4.0."
                />
              </Gate>
            </fieldset>

            <fieldset class="card mt-5 p-6">
              <legend class="label-caps px-2">Anything else</legend>
              <Field
                label="Notes for the reviewer"
                name="notes"
                value={values.notes}
                rows="3"
                maxlength="4000"
                hint="Anything worth knowing before the file is opened."
              />
            </fieldset>

            {/* Here rather than in the preamble: it is what to do next, and
                what to do next belongs beside the button that does it. */}
            <button type="submit" class="btn mt-5">
              Continue to upload
            </button>
          </div>
        </form>
      )}

      {open && <script src={`${BASE}/static/submit.js`} defer></script>}
    </Layout>
  );
};

/**
 * The page that takes the bytes.
 *
 * Two ways up, because one size of file does not fit both: a presigned PUT
 * from the browser for anything under 1 GB, which is 233 of the
 * catalogue's 244 datasets, and an S3 client for the eleven that are larger,
 * where multipart and resumption matter and a browser tab is the wrong
 * place to be holding 26 GiB.
 *
 * Whichever is used, the Worker then looks in the bucket itself rather than
 * believing a report of success, which is also why the confirm button is an
 * ordinary form: someone who uploaded with rclone presses it by hand.
 */
export const Upload = ({
  counts,
  submission,
  partSize,
  browserParts,
  browserLimit,
  limit,
  duplicate = null,
}) => {
  const uploaded = submission.uploaded_at !== null;

  return (
    <Layout
      title={uploaded ? "Submission complete" : "Upload dataset"}
      counts={counts}
      active={null}
      showSubmit={false}
    >
      <h1 class="text-3xl sm:text-4xl">
        {uploaded ? "Submission complete" : "Upload dataset"}
      </h1>
      <p class="mt-3 mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span class="font-mono break-all text-text">{submission.name}</span>
        <span>submission {submission.submission_id}</span>
        <StateBadge state={uploaded ? submission.state : "no file yet"} />
      </p>

      {uploaded ? (
        <>
          <Section title="What arrived">
            <Fields
              entries={[
                ["file", <span class="font-mono">{submission.filename}</span>],
                ["size", size(submission.uploaded_size_bytes)],
                ["received", date(submission.uploaded_at)],
              ]}
            />
          </Section>

          {submission.reviewed_at !== null && (
            <Section
              title={
                submission.state === "approved"
                  ? "Approved"
                  : "Not accepted"
              }
            >
              <Fields
                entries={[
                  ["decided", date(submission.reviewed_at)],
                  ["reviewer said", submission.reviewer_note],
                ]}
              />
              {submission.state === "rejected" && (
                <p class="mt-3 text-sm text-muted">
                  Fix what is described above and submit it again from{" "}
                  <a href={`${BASE}/submit/new?like=${submission.upload_token}`}>
                    your submissions
                  </a>
                  , which fills the form in from this one.
                </p>
              )}
            </Section>
          )}

          <CheckReport submission={submission} duplicate={duplicate} forContributor />
          <p class="mt-4 text-sm">
            <a href={`${BASE}/submissions`}>Your submissions</a>
          </p>
        </>
      ) : (
        <>
          <Section title="Check your upload">
            <p class="text-sm leading-relaxed text-muted">
              Your submission will go through automated checks when you submit
              it. To make sure your submission passes, use the CLI to check.
            </p>
            <div class="mt-3">
              <Command>syndex-check YOUR-FILE</Command>
            </div>
            <p class="mt-3 text-right text-xs">
              <a
                href="https://github.com/synthesizer-project/syndex#readme"
                target="_blank"
                rel="noopener noreferrer"
              >
                Installation instructions
              </a>
            </p>
          </Section>

          {/* Hidden by upload.js once a file too large for a browser is
              chosen. Until then it is the way a file gets chosen at all, so
              it cannot start hidden. */}
          <div id="browser-upload">
            <Section title="Upload the file">
              <p class="mb-4 text-sm text-muted">
                Up to {size(browserLimit)} from a browser. Anything larger
                goes up from the command line.
              </p>
              <div id="picker" hidden class="flex flex-wrap items-center gap-3">
                <input type="file" id="pick" class="sr-only" />
                <label
                  for="pick"
                  id="pick-label"
                  class="btn w-36 cursor-pointer text-center"
                >
                  Choose file
                </label>
                <button
                  type="button"
                  id="send"
                  hidden
                  disabled
                  data-part-url={`${BASE}/submit/${submission.upload_token}/part`}
                  data-part-size={String(partSize)}
                  data-max-parts={String(browserParts)}
                  class="btn w-36 text-center"
                >
                  Upload
                </button>
                <span id="chosen" class="text-sm text-muted">
                  No file chosen
                </span>
              </div>
              <progress id="progress" hidden value="0" class="mt-4 w-full">
                0%
              </progress>
              <p id="upload-status" role="status" class="mt-2 text-sm">
                <noscript>
                  Sending a file needs JavaScript. Ask a maintainer to take it
                  another way.
                </noscript>
              </p>
            </Section>
          </div>

          {/* Folded away, because most files do not need it -- and opened by
              upload.js when one does. */}
          <details id="cli-upload" class="card mb-5 p-6">
            <summary class="cursor-pointer text-xl">Upload with the CLI</summary>
            <div
              id="too-large"
              hidden
              role="alert"
              class="mt-4 rounded border border-accent-light p-4 text-sm"
            >
              <p class="label-caps text-accent-light">
                Too large to upload via the browser
              </p>
              <p id="too-large-detail" class="mt-2 leading-relaxed text-muted"></p>
            </div>
            <p class="mt-4 text-sm leading-relaxed text-muted">
              Upload from the command line, useful for remote machines.
              Resumable, and takes files up to {size(limit)} rather than{" "}
              {size(browserLimit)}. The token below links the file to this
              submission.
            </p>
            <div class="mt-3">
              <Command>
                syndex-submit {submission.upload_token} YOUR-FILE
              </Command>
            </div>
            <p class="mt-3 text-xs leading-relaxed text-muted">
              It will ask you to sign in the first time, by opening a code on
              github.com. Nothing is stored but a token for this site, in{" "}
              <code>~/.config/syndex/</code>.
            </p>
            <p class="mt-3 text-right text-xs">
              <a
                href="https://github.com/synthesizer-project/syndex#readme"
                target="_blank"
                rel="noopener noreferrer"
              >
                Installation instructions
              </a>
            </p>
          </details>

          {/* Submitted by upload.js when the last piece lands. No button:
              pressing one by hand only ever asked the Worker to look in the
              bucket, which it does anyway the moment there is a reason to. */}
          <form
            method="post"
            action={`${BASE}/submit/${submission.upload_token}/complete`}
            id="confirm"
          >
            <input type="hidden" name="expected_size" id="expected-size" />
          </form>
        </>
      )}
      <script src={`${BASE}/static/upload.js`} defer></script>
    </Layout>
  );
};

/**
 * Told to someone whose file arrived the wrong size.
 *
 * The one failure a transfer of this length actually has: it stopped part way
 * and nothing said so. Comparing what the sender sent against what the bucket
 * holds catches it without asking anybody to run shasum by hand, which was
 * the old answer and one most people skipped.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Truncated = ({ counts, submission, arrived, expected }) => (
  <Layout title="The file is incomplete" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">The file is incomplete</h1>
    <p class="mt-3 max-w-2xl text-muted">
      {size(arrived)} arrived, out of {size(expected)}. The transfer stopped
      part way, so the submission has not been marked as having its file.
    </p>
    <p class="mt-4 max-w-2xl text-muted">
      Send it again from the start: the pieces already there are replaced
      rather than added to.
    </p>
    <p class="mt-4">
      <a href={`${BASE}/submit/${submission.upload_token}`}>
        Back to the upload
      </a>
    </p>
  </Layout>
);

/** Told to someone whose upload has not turned up. */
export const NothingArrived = ({ counts, submission }) => (
  <Layout title="Nothing arrived" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Nothing arrived</h1>
    <p class="mt-3 max-w-2xl">
      There is no file under this submission yet. If an upload is still
      running, let it finish and press the button again. If it stopped part
      way, start it again and it will carry on from where it got to: the
      pieces that already arrived are kept, whichever way you sent them.
    </p>
    <p class="mt-4">
      <a href={`${BASE}/submit/${submission.upload_token}`}>
        Back to the upload
      </a>
    </p>
  </Layout>
);

/**
 * Everything one account has ever submitted.
 *
 * The chooser shows the last few, because getting back to a transfer part way
 * through is the common reason to look. This is the rest of them, which is a
 * different question and was answered by sending somebody to the page that
 * starts a new submission -- a link that read like a way out and was a way
 * back to where they already were.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Submissions = ({ counts, mine }) => (
  <Layout title="Your submissions" counts={counts} active={null}>
    <p class="mb-4 text-sm">
      <a href={`${BASE}/account`}>Back to your account</a>
    </p>
    <h1 class="text-3xl sm:text-4xl">Your submissions</h1>
    <p class="mt-3 text-muted">
      {mine.length} in total, newest first.
    </p>

    {mine.length === 0 ? (
      <p class="mt-8 text-muted">
        Nothing yet. <a href={`${BASE}/submit`}>Submit a dataset</a>.
      </p>
    ) : (
      <div class="mt-8">
        <SubmissionRows mine={mine} />
      </div>
    )}
  </Layout>
);

/**
 * What this account has already sent, and what became of it.
 *
 * @param {object} props Component props.
 * @param {object[]} props.mine The account's own submissions.
 * @returns {unknown} The rendered list, or nothing when there are none.
 */
const YourSubmissions = ({ mine, more = false }) =>
  mine.length === 0 ? null : (
    <section class="mt-10">
      <SectionHead
        title="Your submissions"
        action={
          more ? (
            <a href={`${BASE}/submissions`} class="text-sm">
              All your submissions
            </a>
          ) : null
        }
      />
      <SubmissionRows mine={mine} />
    </section>
  );

/**
 * One account's submissions, as rows.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered list.
 */
const SubmissionRows = ({ mine }) => (
  <ul class="card divide-y divide-line p-0">
    {mine.map((submission) => (
          <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <a
              href={`${BASE}/submit/${submission.upload_token}`}
              class="font-mono text-sm"
            >
              {submission.name}
            </a>
            <span class="flex-1 truncate text-sm text-muted">
              {submission.display_name}
            </span>
            <span class="text-xs text-muted">
              {submission.uploaded_at === null
                ? "no file sent yet"
                : date(submission.submitted_at)}
            </span>
            <StateBadge state={submission.state} />
            <CheckBadge
              state={verdictOf(submission, submission.duplicate ? {} : null)}
            />
            <a
              href={`${BASE}/submit/new?like=${submission.upload_token}`}
              aria-label={`Start a new submission like ${submission.name}`}
              title="Submit again with these details"
              class="btn-quiet inline-flex items-center gap-1.5 px-2 py-1 text-xs no-underline"
            >
              <ResubmitIcon />
              Resubmit
        </a>
      </li>
    ))}
  </ul>
);
