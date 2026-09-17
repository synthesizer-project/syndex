/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The pieces every page is built from.
 *
 * A definition list, a card, a copy button, a field, a badge, an overlay. None
 * of them knows what it is describing, which is what lets a submission, a
 * dataset and an account all look like one site.
 */

import { Scientific, num, size } from "../views/format.jsx";

/** A definition list of whatever is actually recorded. */
export const Fields = ({ entries, spaced = false }) => {
  const rows = entries.filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (rows.length === 0) {
    return null;
  }
  return (
    <dl
      class={`fields grid grid-cols-[max-content_1fr] gap-x-6 text-sm ${
        spaced ? "gap-y-4" : "gap-y-2"
      } ${rows.length > 6 ? "many-fields" : ""}`}
    >
      {rows.map(([label, value]) => (
        <>
          <dt class="label-caps pt-0.5">{label}</dt>
          <dd class="min-w-0 break-words">{value}</dd>
        </>
      ))}
    </dl>
  );
};

/** Flatten nested metadata into readable definition-list rows. */
export const expandedFields = (value, path = []) =>
  Object.entries(value).flatMap(([key, child]) => {
    const next = [...path, key];
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      return expandedFields(child, next);
    }
    const label = next
      .map((part) => part === "hdf5" ? "HDF5" : part.replace(/_/g, " "))
      .join(" · ");
    const display = Array.isArray(child)
      ? child.join(", ")
      : typeof child === "boolean"
        ? child ? "yes" : "no"
        : typeof child === "number" ? <Scientific>{num(child)}</Scientific> : child;
    return [[label, display]];
  });

/** A titled block. */
export const Section = ({ title, action = null, children }) => (
  <section class="card mb-5 p-6">
    {action === null ? (
      <h2 class="mb-4 text-xl">{title}</h2>
    ) : (
      <div class="mb-4 flex items-start justify-between gap-4">
        <h2 class="text-xl">{title}</h2>
        {action}
      </div>
    )}
    {children}
  </section>
);

/**
 * A section heading, with whatever leads out of it on the opposite side.
 *
 * @param {object} props Component props.
 * @param {string} props.title What the section is.
 * @param {unknown} props.action What leads out of it, or nothing.
 * @returns {unknown} The rendered heading row.
 */
export const SectionHead = ({ title, action = null }) => (
  <div class="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <h2 class="text-xl">{title}</h2>
    {action}
  </div>
);

/** Standard overlapping-squares control for copying a command. */
export const CopyButton = ({
  command,
  label = "Copy command",
  filename,
  large = false,
  sizeBytes,
  sizeLabel,
}) => (
  <button
    type="button"
    data-copy-command={command}
    class={`group relative inline-flex shrink-0 cursor-pointer items-center justify-center border border-muted bg-bg text-text transition-colors hover:border-accent-light hover:text-accent-light ${
      large ? "h-11 w-11 rounded-lg" : "h-8 w-8 rounded-lg"
    }`}
    aria-label={label}
    data-download-filename={filename}
    data-download-size={sizeBytes}
    data-download-size-label={sizeLabel}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class={large ? "h-5 w-5" : "h-4 w-4"}
    >
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    </svg>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface px-3.5 py-2 font-mono text-xs whitespace-nowrap text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      {command}
    </span>
  </button>
);

/** The same control, for copying a value that is already on the page. */
export const CopyTextButton = ({ text, label }) => (
  <button
    type="button"
    data-copy-text={text}
    data-copy-label={label}
    class="group relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-muted bg-bg text-text transition-colors hover:border-accent-light hover:text-accent-light"
    aria-label={label}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="h-4 w-4"
    >
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    </svg>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface px-3.5 py-2 text-xs whitespace-nowrap text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      {label}
    </span>
  </button>
);

/** Standard download-arrow control. */
export const DownloadButton = ({
  href,
  label,
  filename,
  large = false,
  sizeBytes,
  sizeLabel,
}) => (
  <a
    href={href}
    class={`group relative inline-flex shrink-0 items-center justify-center border border-muted bg-bg text-text no-underline transition-colors hover:border-accent-light hover:text-accent-light ${
      large ? "h-11 w-11 rounded-lg" : "h-8 w-8 rounded-lg"
    }`}
    aria-label={label}
    data-download-filename={filename}
    data-download-size={sizeBytes}
    data-download-size-label={sizeLabel}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class={large ? "h-5 w-5" : "h-4 w-4"}
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface px-3.5 py-2 text-xs whitespace-nowrap text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      {label}
    </span>
  </a>
);

/**
 * Decode a stored JSON column.
 *
 * @param {string | null} text The column value.
 * @param {unknown} fallback What to return when there is nothing stored.
 * @returns {unknown} The decoded value.
 */
export function decode(text, fallback = null) {
  if (text === null || text === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    // A column that will not decode is a publication bug, not a page
    // failure: show the raw text rather than a 500.
    return text;
  }
}

/** One labelled form control. */
export const Field = ({ label, name, value = "", hint = null, ...rest }) => (
  <label for={name} class="block">
    <span class="label-caps mb-1 block">
      {label}
      {rest.required === true && <span aria-hidden="true"> *</span>}
    </span>
    {rest.rows === undefined ? (
      <input
        id={name}
        name={name}
        value={value}
        class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
        {...rest}
      />
    ) : (
      <textarea
        id={name}
        name={name}
        class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
        {...rest}
      >
        {value}
      </textarea>
    )}
    {hint !== null && (
      <span class="mt-1 block text-xs leading-relaxed text-muted">{hint}</span>
    )}
  </label>
);

/**
 * A question whose answer reveals the fields it applies to.
 *
 * The panel is hidden by CSS rather than by script, so it works with
 * JavaScript disabled like the rest of the portal -- and better than an htmx
 * version would, which with no script would have to show everything at once.
 *
 * A hidden field still submits, so the server reads the tick rather than the
 * fields: somebody who fills a box and then unticks the question has changed
 * their mind, and the tick is the answer to honour.
 *
 * @param {object} props Component props.
 * @param {string} props.name The checkbox's field name.
 * @param {string} props.question What is being asked.
 * @param {boolean} props.checked Whether it was answered yes already.
 * @param {unknown} props.children The fields it reveals.
 * @returns {unknown} The rendered question.
 */
export const Gate = ({ name, question, checked = false, children }) => (
  <div class="sm:col-span-2">
    <input
      type="checkbox"
      id={name}
      name={name}
      value="yes"
      checked={checked}
      class="peer mr-2 align-middle accent-accent-light"
    />
    <label for={name} class="align-middle text-sm">
      {question}
    </label>
    <div class="mt-4 hidden peer-checked:block">{children}</div>
  </div>
);

/**
 * What state a submission is in, said in a word and a colour.
 *
 * @param {object} props Component props.
 * @param {string} props.state The submission's state.
 * @returns {unknown} The rendered badge.
 */
export const StateBadge = ({ state }) => (
  <span
    class={`rounded-full px-2.5 py-0.5 text-xs ${
      state === "pending"
        ? "bg-accent-light text-bg"
        : state === "approved"
          ? "border border-accent-light text-accent-light"
          : "border border-line text-muted"
    }`}
  >
    {state}
  </span>
);

/**
 * The review queue.
 *
 * The one page in the portal that writes. Approving records the decision and
 * prints the command that publishes the file: the Worker never parses HDF5
 * and never writes to R2, so publication stays with the tooling that
 * validates, hashes and registers in one transaction.
 */
/**
 * One fact about a submission, in a row of them.
 *
 * @param {object} props Component props.
 * @param {string} props.label What it is.
 * @param {unknown} props.children The value.
 * @returns {unknown} The rendered fact.
 */
export const Fact = ({ label, children }) => (
  <div>
    <span class="label-caps block text-xs">{label}</span>
    <span class="text-sm">{children}</span>
  </div>
);

/**
 * An overlay, opened by a button and closed by the browser.
 *
 * The native popover attribute rather than a dialog: `showModal()` needs
 * script, and the review page should not stop working because one file failed
 * to load. This way the top layer, the backdrop, Escape and clicking away are
 * all the browser's job, and there is no JavaScript here at all.
 *
 * `m-auto` is load-bearing. Tailwind's reset sets `margin: 0` on everything,
 * and an author rule beats the browser's own `[popover] { margin: auto }`
 * whatever their specificity -- so without it the overlay pins to the
 * top-left corner instead of centring. The dialogs in the layout carry it for
 * the same reason.
 *
 * @param {object} props Component props.
 * @param {string} props.id What the opening button points at.
 * @param {string} props.title What the overlay is for.
 * @param {unknown} props.children Its contents.
 * @returns {unknown} The rendered overlay.
 */
export const Overlay = ({ id, title, children }) => (
  <div
    id={id}
    popover="auto"
    class="card m-auto max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-6 text-text shadow-2xl backdrop:bg-bg/85"
  >
    <div class="mb-4 flex items-start justify-between gap-4">
      <h3 class="text-lg">{title}</h3>
      <button
        type="button"
        popovertarget={id}
        popovertargetaction="hide"
        aria-label="Close"
        class="btn-quiet cursor-pointer px-2 py-0.5 text-lg leading-none"
      >
        &times;
      </button>
    </div>
    {children}
  </div>
);

/** An up arrow, for starting a new submission from one already sent. */
export const ResubmitIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="h-4 w-4"
  >
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);

/** A pencil, for the control that opens an account to be edited. */
export const PencilIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="h-4 w-4"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
