/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * What the checker made of a file, as a contributor and a reviewer see it.
 *
 * The check runs somewhere else entirely -- a GitHub Actions job, because
 * reading HDF5 needs h5py and a Worker has no Python -- and writes what it
 * found back as a row. Everything here is a reading of that row.
 *
 * It is shared because both sides of a submission look at the same verdict
 * from different angles: a contributor sees it to find out what to fix, a
 * reviewer to decide whether to trust the file. The wording differs, through
 * `forContributor`; the judgement does not.
 */

import { BASE } from "../base.js";
import { date } from "../views/format.jsx";
import { Fields, Section } from "./shared.jsx";

/**
 * The verdict a page shows, which is not always the one the checker recorded.
 *
 * A file whose bytes are already in the catalogue passes every check there
 * is: it is a valid grid, because it is a grid that was published. It still
 * cannot be published again, so "passed" is the wrong word for it -- the
 * submission is going nowhere and saying otherwise sends somebody off to wait
 * for a review that can only end one way.
 *
 * Computed rather than stored. The checker reads the file and knows nothing
 * of the catalogue, and whether something is a duplicate changes as the
 * catalogue does, so freezing this into `validation_state` would record a
 * judgement that could quietly become wrong.
 *
 * @param {object} submission The submission row.
 * @param {object | null} duplicate Whatever already holds these bytes.
 * @returns {string | null} The state to show.
 */
export const verdictOf = (submission, duplicate = null) =>
  duplicate === null || submission.validation_state === "running"
    ? submission.validation_state
    : "failed";

/**
 * What the checker made of a file, in a word and a colour.
 *
 * @param {object} props Component props.
 * @param {string | null} props.state The recorded validation state.
 * @returns {unknown} The rendered badge, or nothing when none has run.
 */
export const CheckBadge = ({ state, large = false }) => {
  if (state === null || state === undefined) {
    return null;
  }

  // Failure is the one that has to carry across a page at a glance, so it is
  // the only filled one. Passing is stated rather than shouted: a reviewer
  // reads the file either way, and a loud green tick is an invitation not to.
  const looks = {
    running: ["checking…", "border border-line text-muted"],
    passed: ["passed", "border border-accent-light text-accent-light"],
    failed: ["failed", "bg-accent-light text-bg"],
    ambiguous: ["needs categorising", "border border-line text-muted"],
  };
  const [word, style] = looks[state] ?? [state, "border border-line text-muted"];

  // Large where it is the answer the section exists to give, small where it
  // is one fact about a row among several.
  return (
    <span
      class={`rounded-full ${
        large ? "px-4 py-1 text-base" : "px-2.5 py-0.5 text-xs"
      } ${style}`}
    >
      {word}
    </span>
  );
};

/**
 * Everything the checker said, for a reviewer deciding on the strength of it.
 *
 * Errors first and in full: they are the reason a submission would be sent
 * back, and a reviewer who has to expand something to find out whether there
 * is a problem will eventually stop expanding it.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered report, or a note that none has run.
 */
export const CheckReport = ({
  submission,
  duplicate = null,
  forContributor = false,
}) => {
  const report = (() => {
    try {
      return JSON.parse(submission.validation_report_json ?? "null");
    } catch {
      return null;
    }
  })();

  const running = submission.validation_state === "running";

  return (
    // While a check is running this fetches itself every few seconds and
    // swaps itself for what comes back. The replacement carries no trigger
    // once the check has finished, so the polling stops on its own rather
    // than needing anything to stop it.
    <div
      id="check-report"
      hx-get={running ? `${BASE}/submit/${submission.upload_token}/check` : undefined}
      hx-trigger={running ? "every 5s" : undefined}
      hx-swap="outerHTML"
    >
    <Section
      title="Validation"
      action={<CheckBadge state={verdictOf(submission, duplicate)} large />}
    >
      {duplicate !== null && (
        <div role="alert" class="mb-4 rounded border border-accent-light p-4 text-sm">
          <p class="label-caps text-accent-light">Already in the catalogue</p>
          <p class="mt-2 leading-relaxed text-muted">
            These are byte for byte the same file as{" "}
            <strong class="text-text">{duplicate.name}</strong>, which is
            already {duplicate.published ? "published" : "waiting in the queue"}
            .{" "}
            {submission.release_of_name === duplicate.name
              ? "This release is the file that is already there, unchanged."
              : forContributor
                ? "There is nothing here to add. If this is a corrected or " +
                  "newer version of that dataset, submit it as a new release " +
                  "of it rather than as a second dataset."
                : "There is nothing here to publish."}
          </p>
        </div>
      )}

      {submission.validation_state === null &&
        (forContributor ? (
          <p class="text-sm text-muted">
            No check has run on this file. A reviewer will read it either way.
          </p>
        ) : (
          <p class="text-sm text-muted">
            No check has run. Fetch the file and run <code>syndex-check</code>{" "}
            on it yourself.
          </p>
        ))}
      {submission.validation_state === "running" && (
        <p class="text-sm text-muted">
          A check is running. Reload in a minute or two.
        </p>
      )}

      {report !== null && (
        <>
          <Fields
            entries={[
              ["detected as", submission.detected_data_type],
              ["because", report.reason],
              ["format", report.format],
              [
                "sha256",
                submission.sha256 === null ? null : (
                  <span class="font-mono text-xs break-all">
                    {submission.sha256}
                  </span>
                ),
              ],
              ["checked", date(submission.validated_at)],
            ]}
          />

          {(report.errors ?? []).length > 0 && (
            <ul class="mt-4 list-disc space-y-1 pl-5 text-sm">
              {report.errors.map((error) => (
                <li>{error}</li>
              ))}
            </ul>
          )}

          {(report.warnings ?? []).length > 0 && (
            <details class="mt-4">
              <summary class="cursor-pointer text-sm text-muted">
                {report.warnings.length} warning
                {report.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {report.warnings.map((warning) => (
                  <li>{warning}</li>
                ))}
              </ul>
            </details>
          )}

        </>
      )}
    </Section>

    {/* Its own card rather than something to expand. This is what the file
        says it is -- axes, model, emission type -- and it is most of what a
        reviewer is checking the submission's description against. */}
    {Object.keys(report?.detected ?? {}).length > 0 && (
      <Section title="What was read out of the file">
        <Fields
          entries={Object.entries(report.detected).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value
                  .map((item) =>
                    typeof item === "object" && item !== null
                      ? `${item.name}[${item.count}]`
                      : String(item),
                  )
                  .join(", ")
              : typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : value,
          ])}
        />
      </Section>
    )}
    </div>
  );
};
