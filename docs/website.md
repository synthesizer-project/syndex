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

## Submissions

A contributor submits metadata, and the file then goes straight to a separate
submissions bucket. Registering a submission mints an unguessable upload token
naming one writable prefix; the bytes go up through a presigned PUT from the
browser under 1 GB, or with an S3 client driven by prefix-scoped temporary
credentials above it. The bytes never pass through the Worker, and what
actually arrived is discovered by listing that prefix rather than by believing
a report of success.

The hard part this works around: **grids run to 30 GiB.** A browser form cannot
be the transfer mechanism for those, which is why anything large is handed to a
real S3 client that already resumes.

The review queue has its own table, and it is the one part of the portal that
writes. Submitters need no account, since every submission is reviewed by a
human before anything is published; the review page itself is protected.

### Why it is shut

`POST /syndex/submit` returns 503 and the form renders closed. The transfer
path is built, but as built it is unbounded storage that anyone can fill, and
R2 Standard bills every month until someone deletes what they left:

- `presignUpload` signs a method, a key and an expiry, and no
  `content-length`. `BROWSER_UPLOAD_LIMIT` reaches the browser as page copy
  and a `data-limit` attribute, so the advertised limit is advisory and the
  real ceiling is R2's 5 GiB single-part maximum.
- `POST /submit/:token/upload-url` takes the filename from the request, so
  each call signs a different key. One token can therefore write any number
  of objects, and `uploadedFile` only reports the extras after they are
  already stored.
- `GET /submit/:token` mints twelve hours of prefix-scoped
  `object-read-write` merely by being viewed, with no size or object-count
  ceiling, and the token that authorises it is in the URL.
- Nothing expires the submissions bucket.
- Turnstile stops a script, not a person with a solver: there is no per-IP,
  per-address or queue-depth limit on how many tokens can exist.

What has to land before it opens, cheapest first:

1. Sign `content-length` into the presigned PUT and refuse to sign anything
   over the limit, so the cap is enforced rather than advertised.
2. Record the key when it is first signed and refuse a second filename, so a
   submission is one object rather than as many as someone asks for.
3. Drop the temporary-credential path, or mint it only on a reviewer's
   action. The ten datasets over 1 GB can have credentials handed out by
   hand; that is rarer than the abuse it otherwise invites.
4. An R2 lifecycle rule deleting `submissions/` after fourteen days. A bucket
   setting rather than a code change, and the one control that bounds
   accumulation absolutely.
5. Caps in D1: at most a couple of pending submissions per address, and a
   ceiling on queue depth.

With those, the worst case is bounded — a limited number of submissions, one
object each, under the size limit, deleted automatically. Until then the door
stays shut and the page says where to knock. The form's own validation was
written and then removed with the handler; the rules it enforced were a
lowercase-hyphen catalogue name, a display name, a listed data type, a
contact name, an email address, and no collision with an existing dataset or
another pending submission.

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
