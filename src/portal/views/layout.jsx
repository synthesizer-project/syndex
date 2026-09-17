/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The shell every page is rendered inside.
 *
 * The background, the header and its menu, the footer, and the document
 * around them. One `Layout` for the whole portal, because a page that got its
 * own shell would drift from the others in exactly the places -- the nav, the
 * sign-in state, the viewport meta -- where drift is most noticed.
 */

import { createContext, useContext } from "hono/jsx";

import { BASE } from "../base.js";
import { TABS } from "../data/catalogue.js";
import { typeUrl } from "./filters.jsx";
import { size } from "./format.jsx";

/**
 * Who is reading the page, and what is waiting for them.
 *
 * A context rather than a prop because only the header uses it, and every one
 * of the portal's dozen pages sits between the route and the header. Threading
 * `user` through all of them would add a parameter to every page component to
 * satisfy one bar at the top; `page()` provides it once instead.
 *
 * The default is the signed-out state, so a component rendered outside a
 * provider -- an htmx fragment, an error page -- renders correctly rather than
 * throwing.
 *
 * @type {import("hono/jsx").Context<{user: object | null, waiting: number}>}
 */
export const ViewerContext = createContext({ user: null, waiting: 0 });

/*
 * One family, one request. The name matters: the org site asks for
 * `Cormorant+Garant`, which is not a Google family, so the response silently
 * omits it. This URL was checked to return the family it names.
 */
const FONTS =
  "https://fonts.googleapis.com/css2" +
  "?family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap";

/**
 * The starfield behind every page.
 *
 * Inline SVG rather than an image: it is a few hundred bytes of markup, it
 * scales to any viewport without a second request, and it is the same one the
 * org site draws.
 *
 * @returns {unknown} The rendered background.
 */
const Background = () => (
  <svg
    class="bg-layer"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 1440 900"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
  >
    <circle cx="82" cy="78" r="3.5" fill="white" opacity="0.28" />
    <circle cx="375" cy="155" r="2.5" fill="white" opacity="0.22" />
    <circle cx="638" cy="48" r="4" fill="white" opacity="0.26" />
    <circle cx="935" cy="175" r="2.5" fill="white" opacity="0.20" />
    <circle cx="1160" cy="72" r="3.5" fill="white" opacity="0.24" />
    <circle cx="1385" cy="195" r="2" fill="white" opacity="0.18" />
    <circle cx="195" cy="490" r="3" fill="white" opacity="0.20" />
    <circle cx="58" cy="695" r="4" fill="white" opacity="0.24" />
    <circle cx="415" cy="830" r="2.5" fill="white" opacity="0.20" />
    <circle cx="785" cy="865" r="3" fill="white" opacity="0.18" />
    <circle cx="1110" cy="748" r="3.5" fill="white" opacity="0.22" />
    <circle cx="1340" cy="650" r="2.5" fill="white" opacity="0.20" />
    <circle cx="1425" cy="835" r="2" fill="white" opacity="0.18" />
    <circle cx="575" cy="445" r="2.5" fill="white" opacity="0.16" />
    <circle cx="1240" cy="415" r="3" fill="white" opacity="0.20" />
    <circle cx="862" cy="630" r="2" fill="white" opacity="0.16" />
    <circle cx="42" cy="335" r="2.5" fill="white" opacity="0.18" />
    <circle cx="1065" cy="310" r="2" fill="white" opacity="0.18" />
    <circle cx="705" cy="280" r="2" fill="white" opacity="0.14" />
    <circle cx="1395" cy="440" r="2" fill="white" opacity="0.16" />
    {[
      [148, 142, 10, "0.13"],
      [720, 85, 7, "0.11"],
      [1255, 215, 9, "0.12"],
      [318, 728, 8, "0.10"],
      [1088, 762, 10, "0.11"],
      [545, 195, 6, "0.09"],
      [980, 85, 8, "0.10"],
    ].map(([x, y, scale, opacity]) => (
      <path
        transform={`translate(${x},${y}) scale(${scale})`}
        fill="white"
        opacity={opacity}
        d="M 0,-1 L .1,-.1 L 1,0 L .1,.1 L 0,1 L -.1,.1 L -1,0 L -.1,-.1 Z"
      />
    ))}
  </svg>
);

/**
 * The page shell: fonts, stylesheet, htmx, header, tabs.
 *
 * The tab bar is suppressed on the landing page, which signposts the same
 * four places at full size and does not need to do it twice.
 */
/**
 * The data-type tabs.
 *
 * Defined once and placed twice: in the bar on a wide screen, and inside the
 * menu on a narrow one, where a header holding four tabs and four buttons is
 * mostly header.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered links.
 */
const TabLinks = ({ counts, filters, active, stacked = false }) => (
  <>
    {TABS.map((tab) => (
      <a
        href={
          filters === null
            ? `${BASE}/search${tab.types === null ? "" : `?type=${tab.types[0]}`}`
            : typeUrl(filters, tab.types?.[0] ?? null)
        }
        aria-current={tab.id === active ? "page" : undefined}
        class={
          stacked
            ? `flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 no-underline ${
                tab.id === active ? "text-text" : "text-muted hover:text-text"
              }`
            : `flex items-baseline gap-2 border-b-2 pt-[calc(0.25rem+2px)] pb-1 no-underline transition-colors ${
                tab.id === active
                  ? "border-accent-light text-text"
                  : "border-transparent text-muted hover:text-text"
              }`
        }
      >
        {tab.label}
        <span class="text-xs text-muted tabular-nums">{counts[tab.id]}</span>
      </a>
    ))}
  </>
);

/**
 * Everything the header holds about you, behind one control.
 *
 * A details element rather than script, so the menu works with JavaScript
 * off like the rest of the portal. The one thing that costs is light
 * dismiss: it closes on the button, not on a click elsewhere.
 *
 * On a narrow screen it also swallows the data-type tabs. Four tabs beside
 * four buttons is a header with more chrome than page, and a phone has no
 * room to pretend otherwise.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered menu.
 */
const HeaderMenu = ({ counts, filters, active, nav, showSubmit }) => {
  const { user, waiting } = useContext(ViewerContext);
  const role = user?.role ?? null;
  const reviews = role === "reviewer" || role === "admin";

  return (
    <details class="header-menu relative ml-auto">
      <summary
        aria-label="Menu"
        class="btn-quiet flex cursor-pointer items-center gap-2 px-3 text-base leading-none"
      >
        <span aria-hidden="true">&#9776;</span>
        {waiting > 0 && (
          <span class="rounded-full bg-accent-light px-1.5 py-0.5 text-[0.65rem] leading-none text-bg tabular-nums">
            {waiting}
          </span>
        )}
      </summary>

      <nav
        aria-label="Menu"
        class="card absolute right-0 z-30 mt-2 flex w-60 flex-col gap-1 bg-surface p-3 text-sm shadow-2xl"
      >
        {nav && (
          <>
            <span class="label-caps px-3 pt-1 sm:hidden">Catalogue</span>
            <div class="flex flex-col sm:hidden">
              <TabLinks
                counts={counts}
                filters={filters}
                active={active}
                stacked
              />
            </div>
            <hr class="my-2 border-line sm:hidden" />
          </>
        )}

        {showSubmit && (
          <a href={`${BASE}/submit`} class="rounded-lg px-3 py-2 no-underline">
            Submit a dataset
          </a>
        )}
        {reviews && (
          <a
            href={`${BASE}/review`}
            class="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 no-underline"
          >
            Review
            {waiting > 0 && (
              <span class="rounded-full bg-accent-light px-1.5 py-0.5 text-[0.65rem] leading-none text-bg tabular-nums">
                {waiting}
              </span>
            )}
          </a>
        )}
        {role === "admin" && (
          <a href={`${BASE}/accounts`} class="rounded-lg px-3 py-2 no-underline">
            Admin
          </a>
        )}

        {user === null ? (
          <a href={`${BASE}/login`} class="rounded-lg px-3 py-2 no-underline">
            Sign in
          </a>
        ) : (
          <>
            <hr class="my-2 border-line" />
            <a
              href={`${BASE}/account`}
              class="rounded-lg px-3 py-2 no-underline"
            >
              {user.login}
            </a>
            {/* A form, because signing out changes something. A link would
                let any page anywhere sign a reader out by embedding it. */}
            <form method="post" action={`${BASE}/logout`}>
              <button
                type="submit"
                class="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-muted hover:text-text"
              >
                Sign out
              </button>
            </form>
          </>
        )}
      </nav>
    </details>
  );
};

/**
 * The document every page is rendered inside.
 *
 * One shell for the whole portal: the head, the starfield, the header and its
 * menu, the main column and the footer. A page passes what is different about
 * it -- its title, whether it wants the filter nav, whether it is the bare
 * landing page -- and inherits everything else, so the things most noticed
 * when they drift cannot drift.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered document.
 */
export const Layout = ({
  title,
  description = null,
  counts = null,
  active = null,
  filters = null,
  nav = counts !== null,
  bare = false,
  footer = null,
  showSubmit = true,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Syndex</title>
      {/* A catalogue exists to be found, so every page says what it is. */}
      <meta
        name="description"
        content={
          description ??
          "A searchable index of stellar population synthesis and AGN grids, " +
          "dust models and instruments for the Synthesizer project."
        }
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link rel="stylesheet" href={FONTS} />
      <link rel="stylesheet" href={`${BASE}/static/app.css`} />
      {/* Vendored and pinned rather than loaded from a CDN, so the portal
          has one origin and one thing that can go down. */}
      <script src={`${BASE}/static/htmx.min.js`} defer></script>
      <script src={`${BASE}/static/filters.js`} defer></script>
      <script src={`${BASE}/static/preview.js`} defer></script>
      <script src={`${BASE}/static/header.js`} defer></script>
    </head>
    <body class="flex min-h-screen flex-col bg-bg text-text">
      <Background />
      {/* There is only something to skip when there is a header above the
          content to skip past. */}
      {!bare && (
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:card focus:px-3 focus:py-2"
        >
          Skip to results
        </a>
      )}
      {/* The landing page carries no header, as the org site's does not:
          it signposts the same places at full size, and a bar above that
          would only say them twice. */}
      {!bare && (
        <header class="relative border-b border-line">
          <div class="flex w-full flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6 sm:py-5">
            <a
              href={BASE}
              class="flex items-center gap-2 text-xl font-medium tracking-tight text-text no-underline"
            >
              <img
                src={`${BASE}/static/syndex_logo_2.png`}
                alt=""
                width="824"
                height="862"
                class="h-9 w-auto"
              />
              Syndex
            </a>
            {/* Hidden on a phone, where they live in the menu instead. */}
            {nav && (
              <nav
                aria-label="Data types"
                class="hidden flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:flex"
              >
                <TabLinks counts={counts} filters={filters} active={active} />
              </nav>
            )}
            <HeaderMenu
              counts={counts}
              filters={filters}
              active={active}
              nav={nav}
              showSubmit={showSubmit}
            />
          </div>
        </header>
      )}
      {bare && (
        <div class="landing-links flex w-full px-6 pt-6">
          <HeaderMenu
            counts={counts}
            filters={filters}
            active={active}
            nav={false}
            showSubmit
          />
        </div>
      )}
      {/* On the landing page the content is centred in whatever room the
          viewport has, which is what stops a tall screen ending in a field
          of nothing. */}
      <main
        id="main"
        class={
          bare
            ? "mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-12"
            : "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-6 py-8"
        }
      >
        {children}
      </main>
      <footer
        class={`${bare
            ? "landing-footer w-full px-6 pb-8 text-center"
            : "mx-auto w-full max-w-7xl px-6 pt-4 pb-12"
          } text-sm text-muted`}
      >
        <div class={`${bare ? "" : "border-t border-line pt-6"} text-center`}>
          {footer !== null && <div class="mb-5">{footer}</div>}
          <a
            href="https://synthesizer-project.github.io"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-normal tracking-[0.12em] text-muted uppercase no-underline transition-colors hover:text-text"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              class="h-5 w-5"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            synthesizer-project
          </a>
        </div>
      </footer>
      <dialog
        id="bulk-command"
        class="card m-auto w-[min(46rem,calc(100%-2rem))] overflow-visible border-line-hover bg-surface p-0 text-text shadow-2xl backdrop:bg-bg/85"
      >
        <div class="flex items-start gap-5 px-6 pt-6 pb-5 sm:px-8 sm:pt-8">
          <div class="min-w-0 flex-1">
            <p data-command-eyebrow class="label-caps mb-2 text-accent-light">Ready to run</p>
            <h2 data-command-title class="text-2xl leading-tight">Download command</h2>
            <p data-command-intro class="mt-2 text-sm text-muted">Copied to your clipboard.</p>
          </div>
          <div>
            <button
              type="button"
              data-close-command-dialog
              aria-label="Close"
              class="btn-quiet inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-2xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>
        <div data-command-content class="flex flex-col">
          <div data-command-size-panel class="border-y border-line bg-bg/55 px-6 py-5 sm:px-8">
            <p data-command-filename class="font-mono text-sm break-all text-text" hidden></p>
            <p data-bulk-size class="mt-3 text-3xl font-medium text-accent-light tabular-nums"></p>
            <p data-command-size-label class="label-caps mt-1">Download size</p>
          </div>
          <div data-command-box class="px-6 pt-5 pb-6 sm:px-8 sm:pb-8">
            <div class="relative">
              <pre class="max-h-72 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-bg p-4 pr-20 text-sm leading-relaxed"><code data-bulk-command-text=""></code></pre>
              <button
                type="button"
                data-copy-bulk-command=""
                aria-label="Copy command"
                class="group absolute top-3 right-3 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-muted bg-surface text-text shadow-lg transition-colors hover:border-accent-light hover:text-accent-light"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
                  <rect x="8" y="8" width="14" height="14" rx="2" />
                  <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
                </svg>
                <span role="tooltip" class="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-max rounded-lg border border-line bg-surface px-3 py-2 text-xs text-text opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100">Copy command</span>
              </button>
            </div>
          </div>
        </div>
      </dialog>
      <dialog
        id="download-notice"
        class="card m-auto w-[min(34rem,calc(100%-2rem))] overflow-hidden border-line-hover bg-surface p-0 text-text shadow-2xl backdrop:bg-bg/85"
      >
        <div class="flex items-start gap-5 px-6 pt-6 pb-5 sm:px-8 sm:pt-8">
          <div class="min-w-0 flex-1">
            <p class="label-caps mb-2 text-accent-light">Direct download</p>
            <h2 class="text-2xl leading-tight">Ready to download?</h2>
          </div>
          <button
            type="button"
            data-close-download-notice
            aria-label="Close"
            class="btn-quiet inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div class="border-y border-line bg-bg/55 px-6 py-5 sm:px-8">
          <p data-download-filename class="font-mono text-sm break-all text-text"></p>
          <p data-download-size-value class="mt-3 text-3xl font-medium text-accent-light tabular-nums"></p>
          <p class="label-caps mt-1">Download size</p>
        </div>
        <div class="flex items-center justify-end gap-3 px-6 py-5 sm:px-8">
          <button type="button" data-close-download-notice class="btn-quiet cursor-pointer px-4 py-2 text-sm">Cancel</button>
          <button type="button" data-confirm-download class="btn cursor-pointer px-5 py-2 text-sm">Download</button>
        </div>
      </dialog>
    </body>
  </html>
);

/** A command someone is meant to copy. */
export const Command = ({ children }) => (
  <code class="block overflow-x-auto rounded-lg border border-line bg-bg px-4 py-3 text-left font-mono text-sm whitespace-pre-wrap text-text">
    {children}
  </code>
);
