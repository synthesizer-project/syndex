/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * The pages a route gives instead of the one that was asked for.
 *
 * Both are answers to "you cannot have this", and both are written to be the
 * next step rather than a dead end: a visitor with no account is offered the
 * sign-in, and somebody who asked for something that is not there is told
 * what was not there and pointed back at the catalogue.
 *
 * Neither is a bare status code. A 404 page that says only "404" is the same
 * refusal with the help taken out.
 */

import { BASE } from "../base.js";
import { Layout } from "../views/layout.jsx";

/**
 * What a visitor sees when a page needs an account and they have none.
 *
 * Deliberately not a 404 and not a bare refusal. The visitor is one click
 * from being allowed the page, so the page says so and offers the click.
 *
 * @param {object} props Component props.
 * @param {object} props.counts Tab counts for the header.
 * @param {boolean} props.configured Whether GitHub sign-in is set up.
 * @param {string} props.returnTo Where to send them once they are signed in.
 * @returns {unknown} The rendered page.
 */
export const SignInRequired = ({ counts, configured, returnTo }) => (
  <Layout title="Sign in" counts={counts} active={null} showSubmit={false}>
    <h1 class="text-3xl sm:text-4xl">Sign in</h1>
    {configured ? (
      <>
        <p class="mt-3 max-w-2xl text-muted">
          Contributing to the catalogue needs an account, so that a reviewer
          can see who sent a dataset and ask about it. Reading the catalogue
          never does.
        </p>
        <p class="mt-5">
          <a
            href={`${BASE}/login?return=${encodeURIComponent(returnTo)}`}
            class="btn no-underline"
          >
            Sign in with GitHub
          </a>
        </p>
        <p class="mt-4 max-w-2xl text-sm text-muted">
          Syndex reads your GitHub username and email address and nothing else.
          It asks for no access to any repository.
        </p>
      </>
    ) : (
      <p class="mt-3 max-w-2xl text-muted">
        Signing in is not available yet. In the meantime, open an issue on{" "}
        <a
          href="https://github.com/synthesizer-project/synthesizer/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          the Synthesizer repository
        </a>{" "}
        describing the dataset, and a maintainer will arrange to take the file.
      </p>
    )}
  </Layout>
);

/**
 * A page that is not there, or a page that is not yours.
 *
 * Carries the message rather than inventing one, because the reasons differ:
 * a dataset that does not exist, a submission belonging to somebody else, a
 * sign-in that could not be completed.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const NotFound = ({ counts, message }) => (
  <Layout title="Not found" counts={counts} active={null}>
    <h1 class="text-3xl sm:text-4xl">Not found</h1>
    <p class="mt-3 text-muted">{message}</p>
    <p class="mt-4">
      <a href={BASE}>Start again</a>
    </p>
  </Layout>
);
