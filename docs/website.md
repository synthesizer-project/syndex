# Syndex Portal Plan

The catalogue has 240 datasets and no way to look at them. This is the plan for
the portal that fixes that, and eventually for accepting contributions to it.

Every number in this document was measured against the live catalogue rather
than estimated, because several of the design decisions turn on them.

## What it is

Syndex is three things, in this order of arrival:

1. A portal for exploring and searching what is in the database.
2. A way to contribute new entries to it, reviewed before they go live.
3. Eventually, a utility that generates the job scripts needed to process an
   existing incident grid through Cloudy.

Only the first two are in the initial launch, and the second one deliberately
avoids the hard part.

## Where it lives

```
synthesizer-project.org/            GitHub Pages (org landing)
synthesizer-project.org/synthesizer/  GitHub Pages (docs)
synthesizer-project.org/syndex/*   Worker  <- the portal
data.synthesizer-project.org/v1/*     Worker  <- the API, unchanged
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

**Search state lives in URL query parameters.** `/syndex/grids?model=bpass`
is shareable, citable, back-button-correct, and works with JavaScript
disabled. Filter changes are form submissions, which htmx then upgrades into
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
Syndex            Grids 156 | Dust 3 | Instruments 19 | Data 62
-------------------+-------------------------------------------------
 search [        ] |  23 grids   BPASS x  photoionised x   clear all
                   +-------------------------------------------------
 KIND              | name             emission   ages      Z      size
 [ ] stellar   142 | bpass-2.2.1-...  photoion  1e6-1e11  1e-5-.04 194M
 [ ] AGN        15 | ...
                   |
 MODEL             |
 [x] BPASS      47 |
 [ ] FSPS       54 |
 > 8 more          |
                   |
 EMISSION          |
 [x] photoionised  |
 [ ] incident      |
                   |
 CONTENT           |
 [ ] has spectra   |
 [ ] has lines     |
                   |
 AXES              |
 + add axis        |
                   |
```

`/syndex` itself is a separate, thin landing page: what this is, the install
command, headline counts, and a search box that drops into the Grids tab.
Someone arriving from a paper needs orientation; someone who knows what they
want should be one keystroke from the search. A wall of 156 rows serves
neither.

### Tabs

| Tab | Datasets | Columns |
|---|---|---|
| Grids | 156 | model, emission, age range, metallicity range, wavelengths, spectra/lines |
| Dust grids | 3 | curve or emission, axes |
| Instruments | 19 | filters, resolving power, PSF, noise, depth |
| Other data | 62 | type filter, name, size, version |

Dust grids stay a separate tab despite holding three datasets. They are not
grids and nothing that consumes a grid can consume one.

The rail leads with **stellar or AGN** (`grid_type`, 142 and 15), above the
models, because it is the first cut anyone makes and it is one column. The
models below it are then almost a restatement of that choice — every BPASS
grid is stellar, every QSOSED grid is AGN — which is why the counts beside
each are computed against the other active filters rather than against the
whole tab.

Every dataset on the **Other data** tab carries a description and nothing else
that distinguishes it: no model, no axes, no filters. So that tab shows the
description as a column. All 49 generation inputs are Maraston SEDs — 12 from
2005, 8 from 2011, 9 from 2013 and 20 from 2024 — which their descriptions say
and their names do not.

## The search interface

This is the substance of the portal, and its design follows from one
measurement: **ten of the twelve grid axes appear on 13 grids or fewer.** Only
`ages` (143 grids) and `metallicities` (152) are close to universal. A fixed
panel listing every axis would therefore be mostly irrelevant rows.

So the axis filter starts empty and the user adds axes to it:

- **Adding an axis filters to grids that have that axis.** This is useful on
  its own: adding `spins` finds the five RELAGN grids, and nothing else.
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

`grid_axes` holds roughly 400 rows, so each axis condition is an `EXISTS`
subquery and no index is required.

The axis picker lists available axes with the number of grids that have each,
counted against the other active filters, so an axis that would return nothing
is never offered as a live option.

### Cloudy parameters are display-only

There are no Cloudy filters beyond the existing emission-type checkbox. Two
reasons, both from the data:

- Cloudy quantities that are *varied* are already grid axes, so they are
  already filterable through the axis mechanism.
- Of 31 Cloudy keys, **only 7 vary at all** across the catalogue. The other 24
  hold one value on all 73 photoionised grids and cannot narrow anything.

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

The generated stylesheet needs serving, and `wrangler.jsonc` currently
configures no static assets. Use Workers Static Assets, checking the current
documentation for how assets and routes interact so that `/v1/*` is not
shadowed by the asset handler.

Dark only, matching the org site.

Three tokens need correcting first, because a data portal is read for far
longer than a landing page and these were measured against WCAG:

| Token | Value | Contrast | Use |
|---|---|---|---|
| `--text` | `#dce8f2` | 15.29 | body text |
| `--text-muted` | `#5a7a96` -> **`#6484a0`** | 4.22 fails AA -> 4.54 passes | secondary metadata, which is most of a table |
| `--accent` | `#2b6090` | 2.88 | **fill only**, never text or a border |
| `--accent-light` | `#4a9acc` | 6.15 | links, interactive text, focus rings |
| `--text-dim` | `#304a62` | 2.07 | **non-text only**: borders, dividers |

`--text-muted` at its current value fails AA body text on both backgrounds.
`--accent` fails as text and also fails the 3.0 floor for interactive
boundaries, so it can only sit behind light text.

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

Note on the org site's own request: it asks for `family=Cormorant+Garant`,
which is not a Google family. That request now returns **HTTP 200 carrying
only Outfit** — it returned 400 when this was first measured — so either way
the org site's display font falls back to a generic serif. That should still
be fixed there, but the portal no longer shares the face.

Accessibility, treated as requirements rather than aspirations: visible focus
rings on every control, the filter rail reachable and operable by keyboard,
filters collapsing into a labelled sheet on narrow screens, every table
scrolling within its own container, and identity never carried by colour alone.

## Contributions

The v1 submission flow deliberately avoids the hard part. A contributor
submits **metadata plus a URL to fetch the file from**, which lands in a review
queue; a reviewer approves it and the file is fetched and published with the
existing publishing path.

The hard part being avoided: **grids run to 30 GiB.** A browser form cannot be
the transfer mechanism for those, so a real upload means presigned
direct-to-R2 multipart uploads with resumption. That is v2, and by then there
will be real submissions to design against rather than imagined ones.

The review queue needs its own table, and it is the one part of the portal that
writes. Submitters need no account, since every submission is reviewed by a
human before anything is published; the review page itself does need
protecting.

## Prerequisites

These block portal work or make it much less useful:

1. **`synthesizer-download` cannot fetch a named dataset.** Its flags are
   coarse groups (`--test-grids`, `--dust-grid`, `--all`) with no
   `--dataset NAME` and no positional argument. Every dataset page wants to
   print the command that fetches that dataset, and today there is no such
   command; the honest instruction would be `--all`, which is 63 GiB. The fix
   is small because `_resolve_release(dataset, release_id=None)` already turns
   a catalogue name into a download: it needs a flag wired to it.
2. **DNS for the apex**, plus GitHub Pages as origin and the `/syndex/*`
   Worker route.
3. **The Cloudflare Gateway policy inspects `data.synthesizer-project.org`**,
   which breaks HTTPS to it from any local tool while the VPN is up. The
   browser will hit the same domain. Sort this before frontend work starts or
   whoever builds it will chase phantom fetch failures.
4. **Model naming needs a tidy for facet labels.** `Draine & Li` and
   `Draine & Li dust extinction curves` are the same model spelled two ways and
   would appear as two facet rows. `Bruzual & Charlot (2003), 2016 update` is a
   correct name but unusable as a label in a narrow rail, so models want a
   short label alongside the full name.

## Deferred

- **v2**: presigned direct-to-R2 uploads with resumption, replacing the
  URL-fetch submission.
- **v2**: an interactive coverage view (age/metallicity, Cloudy, IMF). The
  static `syndex-plots` output already covers sharing with colleagues, which
  was its purpose.
- **v3**: generating the job scripts to process an incident grid through
  Cloudy, delivered as a downloadable bundle.
- `GET /v1/facets` is **not** being built. Server-rendered pages compute facet
  counts from D1 directly, and an endpoint with no caller outside the site
  would be speculative. `docs/plan.md` should be updated to say so.
