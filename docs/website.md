# Syndex portal design

The portal described here is built and live at `synthesizer-project.org/syndex`.
This document records the decisions and the measurements behind them; it began
as a plan written when the catalogue had 240 datasets and no way to look at
them.

Every number was measured against the live catalogue rather than estimated,
because several of the design decisions turn on them. The figures here were
re-measured on 2026-09-10 against 244 datasets, of which 163 are grids or dust
grids.

## What it is

Syndex is three things, in this order of arrival:

1. A portal for exploring and searching what is in the catalogue.
2. A way to contribute new entries to it, reviewed before they go live.
3. Eventually, a utility that generates the job scripts needed to process an
   existing incident grid through Cloudy.

Only the first two are in the initial launch, and the second one deliberately
avoids the hard part.

## Where it lives

```
synthesizer-project.org/               GitHub Pages (org landing)
synthesizer-project.org/synthesizer/   GitHub Pages (docs)
synthesizer-project.org/syndex/*       Worker  <- the portal
data.synthesizer-project.org/v1/*      Worker  <- the API, unchanged
```

The org site is static GitHub Pages and the portal is the one dynamic thing in
the project, so `/syndex` is a routing decision rather than a hosting one. A
Cloudflare Worker route matches before the request reaches the origin, so the
Worker serves that path without GitHub Pages knowing about it. This matches the
path pattern already intended for project docs.

`data.synthesizer-project.org/v1/*` does not move. Every `synthesizer-download`
call and every CI run in the ecosystem resolves against it.

One Worker serves both, with API routes matched first. They share the D1 and R2
bindings, so portal pages query D1 in-process rather than making HTTP calls
back through their own API.

There is a `syndex` repository. If it ever enables GitHub Pages it would
claim the same path; the Worker route wins, but leave Pages off it anyway.

## Stack

| Piece | Job | Runs |
|---|---|---|
| Hono | routing, middleware, JSX rendering | Worker |
| Hono JSX | describes the HTML; escapes by default | server only |
| Tailwind v4 | styling, from the tokens below | build step |
| htmx | swaps the results table on filter changes | browser |
| D1 / R2 bindings | metadata and files, in-process | Worker |

Hono with JSX, server-rendered. Wrangler already bundles with esbuild, so JSX
costs no additional build step; Tailwind does add one, covered under Design.

No client-side framework, and no JSX in the browser: the server renders HTML
and htmx updates fragments of it. Nothing hydrates.

JSX rather than template literals specifically because the submission form
accepts user input and echoes it back, which makes HTML escaping a security
property rather than a matter of taste. JSX escapes by default. It also gives
real components for the card, filter rail and page shell that five routes
share, and middleware for protecting the review page later.

No client-side framework. The interactive parts are a filter rail and a form.

**Search state lives in URL query parameters.** `/syndex/search?type=grid&model=bpass`
is shareable, citable, back-button-correct, and works with JavaScript
disabled. The tab paths are shortcuts that redirect onto it, so
`/syndex/grids` lands on the canonical search URL. Filter changes are form submissions, which htmx then upgrades into
background requests that swap in just the updated table and rewrite the URL:

```html
<form hx-get="/syndex/grids" hx-target="#results"
      hx-push-url="true" hx-trigger="change">
```

htmx (~14 KB, vendored as a pinned file rather than loaded from a CDN) is used
in preference to hand-rolling this. The naive version is a few lines of
`fetch`, but the correct version also cancels in-flight requests when filters
change rapidly, shows loading state, handles failures and integrates with
history, which is materially more code than it first appears.

## Layout

A filter rail on the left, results on the right, tabs across the top. The tabs
are real URLs, not JavaScript state, because each data type needs its own
columns and its own filters.

```
Syndex           All 244 | Grids 160 | Dust 3 | Instruments 19
-------------------+-------------------------------------------------
 search [        ] |  23 grids   BPASS x  photoionised x   clear all
                   +-------------------------------------------------
 > DATA TYPE       | name             emission   ages      Z       size
 > FILE SIZE       | bpass-2.2.1-...  photoion  1e6-1e11  1e-5-.04 194M
 > KIND            | ...
 > MODEL           |
 > EMISSION        |
 > CONTENT         |
 > AXES            |
```

`/syndex` itself is a separate, thin landing page: what this is, headline
counts, and a search box that searches the whole catalogue.
Someone arriving from a paper needs orientation; someone who knows what they
want should be one keystroke from the search. A wall of 244 rows serves
neither.

### Tabs

Tabs are shortcuts for the data-type filter on one `/syndex/search` page.
Search terms and generic filters survive a tab change; incompatible specialist
filters do not.

| Tab | Filter | Columns |
|---|---|---|
| All | none | type, size, published date |
| Grids | `grid` | model, photoionised, spectra, lines, age range, metallicity range, wavelengths |
| Dust grids | `dust_grid` | emission, size, spectra, lines, model, axes, wavelengths |
| Instruments | `instrument` | filters, resolving power, PSF, noise, depth |

Dust grids stay a separate tab despite holding three datasets. They are not
grids and nothing that consumes a grid can consume one.

The rail leads with **stellar or AGN** (`grid_type`, 143 and 17), above the
models, because it is the first cut anyone makes and it is one column. The
models below it are then almost a restatement of that choice — every BPASS
grid is stellar, every QSOSED grid is AGN — which is why the counts beside
each are computed against the other active filters rather than against the
whole tab.

Generic results stay compact; descriptions remain on dataset summary pages.

## The search interface

This is the substance of the portal, and its design follows from one
measurement: **fifteen of the seventeen grid axes appear on 17 grids or
fewer.** Only `ages` (143 grids) and `metallicities` (155) are close to
universal. A fixed panel listing every axis would therefore be mostly
irrelevant rows.

All facet groups use native collapsed disclosure controls. Data type and file
size are always available. Selecting a grid, dust grid, or instrument type
reveals only the facets supported by that type's structured metadata. File
size uses stable buckets from under 10 MB through over 10 GB.

So the axis filter starts empty and the user adds axes to it:

- **Adding an axis filters to grids that have that axis.** This is useful on
  its own: adding `spins` finds the six RELAGN grids, and nothing else.
- **Adding several requires all of them.**
- **An added axis expands to accept a range**, with a toggle for how the range
  should match.

For a grid axis spanning `[gmin, gmax]` and a query of `[qmin, qmax]`:

| Toggle | Means | Condition |
|---|---|---|
| Any overlap | the grid covers some of the requested range | `gmin <= qmax AND gmax >= qmin` |
| Full range included | the grid covers all of it | `gmin <= qmin AND gmax >= qmax` |

Axis minima and maxima are stored as **physical values**, not log10; `scale` is
a display hint only. Range comparisons across grids with different `scale`
values are therefore safe. Units are consistent per axis with one exception:
`masses` carries three spellings of the same unit, so a mass range filter must
normalise before comparing.

`grid_axes` holds 405 rows, 393 of them on current releases, so each axis
condition is an `EXISTS` subquery and no index is required.

The axis picker lists available axes with the number of grids that have each,
counted against the other active filters, so an axis that would return nothing
is never offered as a live option.

### Cloudy parameters are display-only

There are no Cloudy filters beyond the existing emission-type checkbox. Two
reasons, both from the data:

- Cloudy quantities that are *varied* are already grid axes, so they are
  already filterable through the axis mechanism.
- Of 31 Cloudy keys, **only 7 vary at all** across the catalogue. The other 24
  hold one value on all 80 photoionised grids and cannot narrow anything.

The seven that vary are `hydrogen_density`, `resolution`, `depletion_model`,
`depletion_scale`, `geometry`, `grains` and `ionisation_parameter_model`, none
with more than three distinct values. These are the ones worth showing as table
columns. All 31 belong on the dataset detail page, where a constant value is
informative rather than dead weight.

### Table columns

Core columns, plus one column for every axis currently in the filter. "Show a
column for what you filtered on" is a single rule and less code than a column
picker, which would make the user configure columns separately from filters.
The table scrolls horizontally inside its own container when someone adds six
axes; the page never scrolls sideways.

## Design

Tailwind CSS v4 (4.3.3 at time of writing), which configures itself in CSS
rather than a JavaScript config file. The tokens below become `@theme`
variables and generate utilities directly:

```css
@import "tailwindcss";

@theme {
  --color-bg: #07101f;
  --color-surface: #0c1829;
  --color-muted: #6484a0;
  --color-accent: #2b6090;
  --color-accent-light: #4a9acc;
}
```

Tokens are copied from `synthesizer-project.github.io` and the source recorded
in a comment. There is little else to share: the org site is cards and a centre
glow, and the portal needs tables, filter rails, form controls and badges, none
of which the org site has any styling for. Cohesion comes from the tokens, the
card idiom and the centre glow; the typeface is deliberately the project's own
rather than the org site's.

**Tailwind introduces a build step, so `wrangler deploy` on its own is no
longer sufficient** and would ship stale styling. Wrap it: the deploy script
must generate the CSS first, so the step cannot be skipped by anyone who
forgets it exists.

The generated stylesheet is served by Workers Static Assets from
`dist/assets`, configured in `wrangler.jsonc`. Assets are matched before the
Worker runs and nothing in there sits at a `/v1` path, so the API cannot be
shadowed; with no matching asset the request falls through to the Worker,
which is every page the portal serves.

Dark only, matching the org site.

Three tokens need correcting first, because a data portal is read for far
longer than a landing page and these were measured against WCAG:

| Token | Value | Contrast | Use |
|---|---|---|---|
| `--color-text` | `#dce8f2` | 15.29 | body text |
| `--color-muted` | `#5a7a96` -> **`#6d8ea9`** | 4.22 fails AA -> 5.52 | secondary metadata, which is most of a table |
| `--color-accent` | `#2b6090` | 2.88 | **fill only**, never text or a border |
| `--color-accent-light` | `#4a9acc` | 6.15 | links, interactive text, focus rings |
| `--color-dim` | `#304a62` | 2.07 | **non-text only**: borders, dividers |

`--color-muted` at the org site's value fails AA body text on both
backgrounds. Its first correction, `#6484a0`, cleared AA at rest (4.54) but not
on a hovered table row, where the accent tint lifts the ground to `#102135` and
the same colour measures 4.14 — for the secondary text that fills most of the
table. `#6d8ea9` measures 5.52 on the page, 5.17 on a card and 4.72 on a
hovered row.

`--color-accent` fails as text and also fails the 3.0 floor for interactive
boundaries, so it can only sit behind light text. That floor also moved the
`.btn` border from `rgba(74, 150, 210, 0.55)` (2.62) to `0.7` (3.51): a button
whose fill measures 1.63 and whose border measured 2.62 was identifiable only
by its text. The names carry Tailwind v4's
`--color-` prefix, which is what makes each one generate utilities.

Typography: **`JetBrains Mono` throughout**, at 400 for body text, UI and
tables, and 500 for headings. It is the project's own typeface, and using it
here is a deliberate divergence from the org landing page, which has not
adopted it: a catalogue is mostly identifiers, digits and numeric ranges, all
of which a monospace sets better than a proportional face. Weight 400 rather
than the 300 the org landing page uses, which is too light for dense tables
and lighter still in a monospace.

One family, and no display serif: hierarchy comes from size and weight.
`Cormorant Garamond` was tried for headings and dropped — a serif over
monospace tables reads as two unrelated documents, and mono headings at weight
500 carry the hierarchy on their own.

Note on the org site's own request: it asks for `family=Cormorant+Garant` [sic],
which is not a Google family. That request now returns **HTTP 200 carrying
only Outfit** — it returned 400 when this was first measured — so either way
the org site's display font falls back to a generic serif. That should still
be fixed there, but the portal no longer shares the face.

Accessibility, treated as requirements rather than aspirations: visible focus
rings on every control, the filter rail reachable and operable by keyboard,
filters collapsing into a labelled sheet on narrow screens, every table
scrolling within its own container, and identity never carried by colour alone.

## Accounts

Identity comes from GitHub through the ordinary OAuth web flow. No password
reaches this service, so there is none to store, hash, reset or leak, and the
audience already has a GitHub account because Synthesizer is developed there.

Reading the catalogue stays anonymous. An account is needed only to contribute
and to review.

Four roles, ordered, each able to do everything the one before it can:

| Role | May |
| --- | --- |
| `pending` | browse, and ask for submit access |
| `contributor` | submit datasets |
| `reviewer` | read the queue, decide submissions, promote a pending account |
| `admin` | also grant the reviewer and admin roles |

The split between the last two is deliberate: letting somebody submit is a
small decision a reviewer should not have to escalate, and letting somebody
publish into the catalogue is not.

A new account is `pending`, because one that could submit on creation would
leave the queue as open to being filled as it was when there were no accounts
at all. A pending account is sent to `/syndex/access` to say what it wants to
contribute, which is what a reviewer reads before granting anything.

### Sessions

A session is a row in D1 holding the SHA-256 digest of a random token; the
token itself only ever lives in the browser's cookie, so a copy of the table
is not enough to sign in as anybody in it. The role is read from `users` on
every request rather than carried in the cookie, which is what makes a
promotion take effect on the next page and a demotion take effect at all.

Signed-in pages are sent `private, no-store`. The anonymous rendering of the
same page is still cacheable, which is what keeps the catalogue cheap to serve
to the people who only read it.

### Configuration

Sign-in is unavailable, rather than broken, until all of this exists:

- A GitHub OAuth App whose callback is
  `https://synthesizer-project.org/syndex/auth/callback`.
- `GITHUB_CLIENT_ID` in `vars` — it is not a secret.
- `GITHUB_CLIENT_SECRET` through `wrangler secret put`.
- `SYNDEX_ADMIN_LOGINS`, a comma-separated list of GitHub logins that hold
  `admin` whatever the table says. This is how the first administrator exists,
  and the way back in if the last one's role is removed by accident.

Notification issues need `GITHUB_ISSUE_REPO` (`owner/name`) in `vars` and
`GITHUB_ISSUE_TOKEN` as a secret, with permission to open issues there. They
are advisory: a failure is logged and the request it was about still succeeds.
Nothing written into an issue includes an email address, since an issue is
visible to everyone who can see the repository.

`SYNDEX_REVIEW_USER` and `SYNDEX_REVIEW_PASSWORD` are gone. The review page was
guarded by one shared password, which said that somebody with the credential
was reviewing and never which somebody.

## Submissions

A contributor describes the dataset, then sends the file in pieces. Each piece
is an ordinary request the Worker writes straight into a multipart upload on a
separate submissions bucket; the credential is the contributor's session, so
there is nothing minted that outlives the request and signing out ends the
ability to write.

The hard part this works around: **grids run to 30 GiB.** Pieces of 90 MiB
mean a dropped connection costs one piece rather than the transfer, and the
same endpoint serves a browser and `syndex submit`, so there is one upload
path rather than one per audience.

### What replaced the presigned path

The form used to be shut, and deliberately so: the write path existed but was
unbounded storage anyone could fill. Most of that was not fixed so much as
removed.

The bytes used to go browser-to-R2 through a presigned PUT, on a path the
Worker could not see, so every limit had to be something signed into a URL and
hoped for:

- `presignUpload` signed a method, a key and an expiry, and no
  `content-length`, so the advertised size limit was advertising and the real
  ceiling was R2's 5 GiB single-part maximum.
- `POST /submit/:token/upload-url` took the filename from the request, so each
  call signed a different key and one token could write any number of objects.
- `GET /submit/:token` minted twelve hours of prefix-scoped
  `object-read-write` merely by being viewed.

None of those exist now. The Worker chooses the key at registration from the
catalogue name, so one submission is one object whatever a later request says
the file is called. The ceiling is a part count it enforces, and since the
platform refuses a request body over its own limit before any Worker code
runs, a client cannot exceed the per-part size however it lies. There are no
temporary credentials to leak because none are minted, and `aws4fetch`, the
two R2 signing keys and the credential-minting API token all went with them.

Moving the bytes through a Worker is only viable because the runtime streams a
request body into R2 without it passing through any JavaScript: waiting on I/O
is not CPU time. That is worth measuring rather than assuming — push a file
through and read the CPU time off `wrangler tail`. If it ever stops holding,
the fallback is presigned URLs per part, which keeps the same endpoint and the
same client.

### What bounds it

- **Accounts.** Only a contributor may submit, and only an admin or reviewer
  grants that. Turnstile is gone: it told a script from a person on an
  anonymous form, and there is no anonymous form.
- **Ownership.** The token addresses a submission; the session authorises it.
  Before accounts the token was both, so anyone who came by one could write to
  somebody else's submission.
- **Caps.** Three pending submissions per account, fifty across everybody.
  The first stops a contributor submitting a directory one file at a time; the
  second is the only limit that holds if an account is ever granted to the
  wrong person.
- **Part count.** 400 parts of 90 MiB, a little over 35 GB.
- **An R2 lifecycle rule** deleting `submissions/` after fourteen days. A
  bucket setting rather than a code change, and the one control that bounds
  accumulation absolutely. **Outstanding.**

The review queue has its own table and is the one part of the portal that
writes. Approving records a decision; it does not publish. Publication stays
with the tooling that opens the HDF5, verifies the digest, and registers R2
and D1 in one transaction.

## Validation

Every uploaded file is read by `syndex check` before a reviewer opens it. The
checker is Python and needs h5py, so it cannot run in the Worker that took the
file: the Worker fires a `repository_dispatch` when an upload completes, and a
GitHub Actions runner installs the package, fetches the object and posts the
verdict back.

A runner rather than a Cloudflare container because a container needs a paid
Workers plan and this does not. Runner disk is 14 GB, larger than any
container tier offered, which matters for a catalogue whose grids reach 30 GB.

The rules live in one place. A contributor is told to run `syndex-check` before
submitting, the runner runs the same command, and a reviewer runs it again on
the file they downloaded, so "it passed for me" and "it passed for the
reviewer" cannot mean different things.

### What the runner is given

A signed link to one object, good for six hours, and nowhere else to send the
answer. It has no account on the portal and is given no credentials: the link
says "this object, until this time", where a token would say rather more and
last rather longer. The report comes back to an endpoint authenticated by a
shared secret, compared in constant time.

What arrives is confirmed rather than trusted -- the runner installs a version
of the checker the Worker did not -- and a state the Worker does not recognise
is read as `failed`, which asks a person to look rather than letting something
through.

### The digest

The runner reads every byte anyway, so it hashes the file while it is there.
That is what `files.sha256` needs at publication, and it answers "have we
already got exactly these bytes" against the catalogue and against the rest of
the queue, which is the one question that can end a review before it starts.

The submission form used to ask a contributor for the digest. It was optional,
unchecked, and asked somebody to hash 30 GB by hand to catch a truncated
transfer -- which the sizes now catch on their own, since the browser knows
what it set out to send and R2 knows what it holds.

### Configuration

Validation is skipped, silently and without failing anything, unless all of
this exists:

- `GITHUB_ISSUE_REPO` in `vars` (already set; the same repository).
- `GITHUB_DISPATCH_TOKEN` as a secret: a fine-grained token with **Contents:
  read and write** on that repository, which is what `repository_dispatch`
  requires.
- `SYNDEX_REPORT_SECRET` as a secret, and the same value as a GitHub Actions
  secret of that name.

A submission whose validation never runs is not blocked. It sits with no
verdict, the review page says so, and a reviewer can fetch the file and run
the checker themselves.

## Prerequisites

These block launch or make the portal much less useful:

1. **DNS for the apex**, plus GitHub Pages as origin and the `/syndex/*`
   Worker route. Outstanding.
2. **The Cloudflare Gateway policy inspects `data.synthesizer-project.org`**,
   which breaks HTTPS to it from any local tool while the VPN is up. The
   browser hits the same domain. A "Do Not Inspect" rule for the apex and for
   `data.synthesizer-project.org` is outstanding; without it, anyone on the VPN
   chases phantom fetch failures.
3. **Model naming needs a tidy for facet labels.** `Draine & Li` and
   `Draine & Li dust extinction curves` are the same model spelled two ways and
   appear as two facet rows. `Bruzual & Charlot (2003), 2016 update` is a
   correct name but unusable as a label in a narrow rail, so models want a
   short label alongside the full name.

`synthesizer-download --dataset NAME [NAME ...]` accepts one or more catalogue
names and resolves them through the API rather than through Box. Bulk selection
in the results table emits that single command; `--release` remains available
when exactly one dataset is named.

## Deferred

- **v2**: multipart uploads driven by the portal itself, so a browser can send
  a file larger than 1 GB and resume it. Anything that big goes up with an S3
  client today.
- **v2**: an interactive coverage view (age/metallicity, Cloudy, IMF). The
  static `syndex-plots` output already covers sharing with colleagues, which
  was its purpose.
- **v3**: generating the job scripts to process an incident grid through
  Cloudy, delivered as a downloadable bundle.
- `GET /v1/facets` is **not** being built. Server-rendered pages compute facet
  counts from D1 directly, and an endpoint with no caller outside the site
  would be speculative.
