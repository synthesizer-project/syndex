# The portal

Live at `synthesizer-project.org/syndex`. Browsing is anonymous; contributing
and reviewing need an account.

This records the decisions and the measurements behind them. Numbers were
measured against the live catalogue, not estimated, because several decisions
turn on them; they were last taken against 244 datasets, 163 of them grids or
dust grids.

## Where it lives

```text
synthesizer-project.org/               GitHub Pages (org landing)
synthesizer-project.org/synthesizer/   GitHub Pages (docs)
synthesizer-project.org/syndex/*       Worker  <- the portal
data.synthesizer-project.org/v1/*      Worker  <- the API
```

A Cloudflare Worker route matches before the request reaches the origin, so
`/syndex` is a routing decision rather than a hosting one and GitHub Pages
never sees it. One Worker serves both paths, API routes first, sharing the D1
and R2 bindings — portal pages query D1 in process rather than calling their
own API over HTTP.

The `syndex` repository must keep GitHub Pages off: it would claim the same
path. The Worker route wins, but there is no reason to have the conflict.

## Stack

| Piece | Job | Runs |
|---|---|---|
| Hono | routing, middleware, JSX rendering | Worker |
| Hono JSX | describes the HTML; escapes by default | server only |
| Tailwind v4 | styling, from the tokens below | build step |
| htmx | swaps the results panel on filter changes | browser |
| D1 / R2 bindings | metadata and files, in process | Worker |

Server-rendered, nothing hydrates, no client framework. JSX rather than
template literals because the submission form echoes user input back, which
makes escaping a security property rather than a matter of taste.

**Search state lives in URL query parameters.**
`/syndex/search?type=grid&model=bpass` is shareable, citable,
back-button-correct and works with JavaScript off. Tab paths redirect onto it.
Filter changes are form submissions that htmx upgrades into background
requests swapping the panel and rewriting the URL. htmx (~14 KB, vendored and
pinned, not from a CDN) is used rather than hand-rolled `fetch` because the
correct version also cancels in-flight requests, shows loading state, handles
failure and integrates with history.

Tailwind's build step means **`npm run deploy`, never bare `wrangler deploy`**,
which would ship whatever styling was there last. The stylesheet is served by
Workers Static Assets from `dist/assets`; nothing in there sits at `/v1`, so
the API cannot be shadowed.

## Layout

Tabs across the top, filter rail on the left, results on the right. Tabs are
real URLs, because each data type needs its own columns and filters.

```text
Syndex           All 244 | Grids 160 | Dust 3 | Instruments 19
-------------------+-------------------------------------------------
 search [        ] |  23 grids   BPASS x  photoionised x   clear all
                   +-------------------------------------------------
 > DATA TYPE       | name             emission   ages      Z       size
 > FILE SIZE       | bpass-2.2.1-...  photoion  1e6-1e11  1e-5-.04 194M
 > KIND            | ...
```

`/syndex` itself is a thin landing page: what this is, headline counts, and a
search box. Someone arriving from a paper needs orientation; someone who knows
what they want should be one keystroke from the search.

| Tab | Filter | Columns |
|---|---|---|
| All | none | type, size, published |
| Grids | `grid` | model, photoionised, spectra, lines, ages, metallicities, wavelengths |
| Dust grids | `dust_grid` | emission, size, spectra, lines, model, axes, wavelengths |
| Instruments | `instrument` | filters, resolving power, PSF, noise, depth |

Search terms and generic filters survive a tab change; incompatible specialist
filters do not. Dust grids keep their own tab despite holding three datasets —
they are not grids, and nothing that consumes a grid can consume one.

## Search

The design follows one measurement: **fifteen of the seventeen grid axes
appear on 17 grids or fewer.** Only `ages` (143) and `metallicities` (155) are
near-universal, so a fixed panel listing every axis would be mostly irrelevant
rows. The axis filter therefore starts empty and you add axes to it.

- Adding an axis filters to grids that have it — useful alone: adding `spins`
  finds the six RELAGN grids and nothing else.
- Several axes means all of them.
- An added axis expands to accept a range, with a toggle for how it matches.

For a grid axis `[gmin, gmax]` and a query `[qmin, qmax]`:

| Toggle | Means | Condition |
|---|---|---|
| Any overlap | covers some of the range | `gmin <= qmax AND gmax >= qmin` |
| Full range included | covers all of it | `gmin <= qmin AND gmax >= qmax` |

Axis bounds are stored as physical values, never log10 — `scale` is a display
hint — so comparing across grids with different scales is safe. Units are
consistent per axis except `masses`, which has three spellings of one unit and
is normalised before comparing.

The rail leads with **stellar or AGN** (`grid_type`, 143 and 17) above the
models, because it is the first cut anyone makes. Facet counts are computed
against the *other* active filters, which is what stops the model rows reading
as a restatement of that choice, and what keeps the axis picker from offering
an axis that would return nothing.

Every facet group is a native disclosure control. Data type and file size are
always available; the specialist facets appear once a type is chosen. File size
uses fixed buckets from under 10 MB to over 10 GB.

**No Cloudy filters** beyond the emission-type checkbox. Cloudy quantities that
vary are already grid axes and already filterable; of 31 Cloudy keys only 7
vary at all across the catalogue, and none with more than three values. Those
seven are worth showing as columns — `hydrogen_density`, `resolution`,
`depletion_model`, `depletion_scale`, `geometry`, `grains`,
`ionisation_parameter_model`. All 31 appear on the dataset page, where a
constant value is informative rather than dead weight.

Columns are the core set plus one for every axis currently filtered. "Show a
column for what you filtered on" is one rule and less code than a column
picker. Wide tables scroll inside their own container; the page never scrolls
sideways.

## Design

Tailwind v4, configured in CSS. Tokens come from
`synthesizer-project.github.io`; cohesion with the org site is the tokens, the
card idiom and the centre glow. Dark only.

```css
@theme {
  --color-bg: #07101f;
  --color-surface: #0c1829;
  --color-muted: #6d8ea9;
  --color-accent: #2b6090;
  --color-accent-light: #4a9acc;
}
```

Three tokens needed correcting against WCAG, because a data portal is read far
longer than a landing page:

| Token | Value | Contrast | Use |
|---|---|---|---|
| `--color-text` | `#dce8f2` | 15.29 | body text |
| `--color-muted` | `#6d8ea9` | 5.52 | secondary metadata, most of a table |
| `--color-accent` | `#2b6090` | 2.88 | **fill only**, never text or border |
| `--color-accent-light` | `#4a9acc` | 6.15 | links, interactive text, focus rings |
| `--color-dim` | `#304a62` | 2.07 | **non-text only**: borders, dividers |

The org site's `--color-muted` fails AA as body text. Its first correction
cleared AA at rest but not on a hovered row, where the accent tint lifts the
ground to `#102135`; `#6d8ea9` measures 5.52 on the page, 5.17 on a card and
4.72 hovered. The 3.0 floor for interactive boundaries also moved the `.btn`
border to `rgba(74, 150, 210, 0.7)` — a button whose fill measures 1.63 and
whose border measured 2.62 was identifiable only by its text.

**JetBrains Mono throughout**, 400 for body and tables, 500 for headings. A
catalogue is identifiers, digits and numeric ranges, all of which a monospace
sets better. One family; hierarchy comes from size and weight. A display serif
over monospace tables read as two unrelated documents and was dropped.

Accessibility is a requirement, not an aspiration: visible focus rings, the
rail operable by keyboard, filters collapsing into a labelled sheet when
narrow, tables scrolling in their own container, and identity never carried by
colour alone.

## Accounts

Identity is GitHub, through the OAuth web flow in a browser and the device flow
from a terminal. No password reaches this service, so there is none to store,
hash, reset or leak.

| Role | May |
|---|---|
| `pending` | browse, and ask for submit access |
| `contributor` | submit datasets |
| `reviewer` | read the queue, decide submissions, promote a pending account |
| `admin` | also grant the reviewer and admin roles |

Ordered: each does everything the one before can. The split between the last
two is deliberate — letting somebody submit is a small decision a reviewer
should not have to escalate; letting somebody publish is not.

Every new account is `pending`, because one that could submit on creation would
leave the queue as open as it was before there were accounts. It is sent to
`/syndex/access` to say what it wants to contribute, which is what a reviewer
reads before granting anything.

A session is a D1 row holding the SHA-256 of a random token; the token itself
lives only in the cookie or in the CLI's config file, so a copy of the table
signs in as nobody. It lasts 30 days. The role is read from `users` on every
request rather than carried in the cookie, which is what makes a promotion
apply on the next page and a demotion apply at all. Signed-in pages are
`private, no-store`; the anonymous rendering stays cacheable.

### Configuration

Sign-in is unavailable rather than broken until all of this exists:

- A GitHub OAuth App with redirect URI
  `https://synthesizer-project.org/syndex/auth/callback`, device flow enabled.
- `GITHUB_CLIENT_ID` in `vars` — not a secret.
- `GITHUB_CLIENT_SECRET` via `wrangler secret put`.
- `SYNDEX_ADMIN_LOGINS`, comma-separated logins that hold `admin` whatever the
  table says. This is how the first administrator exists, and the way back in
  if the last one's role is removed by accident.

Notification issues need `GITHUB_ISSUE_REPO` (`owner/name`) in `vars` and
`GITHUB_ISSUE_TOKEN` as a secret. They are advisory: a failure is logged and
the request it was about still succeeds. Nothing written into an issue includes
an email address.

## Submissions

A contributor describes the dataset, then sends the file in pieces. Each piece
is an ordinary request the Worker streams straight into a multipart upload on a
separate submissions bucket. The credential is the contributor's session, so
nothing is minted that outlives the request and signing out ends the ability to
write.

The hard part this works around: **grids run to 30 GB.** Pieces of 90 MiB mean
a dropped connection costs one piece, not the transfer, and the browser and
`syndex-submit` use the same endpoint — one upload path, not one per audience.

What bounds it:

- **Accounts.** Only a contributor may submit, and only a reviewer or admin
  grants that. No anonymous form, so no Turnstile.
- **Ownership.** The token addresses a submission; the session authorises it.
- **Caps.** Ten pending submissions per account, fifty across everybody. The
  first stops somebody submitting a directory one file at a time; the second is
  the only limit that holds if an account is ever granted to the wrong person.
- **Part count.** 2000 parts of 90 MiB, about 189 GB, from the CLI; the browser
  is held to 106 parts, about 10 GB, because a browser tab is a worse place to
  spend an hour. The platform refuses an oversized request body before any
  Worker code runs, so a client cannot exceed the part size however it lies.
- **An R2 lifecycle rule** deleting the submissions bucket after fourteen days.
  A bucket setting rather than code, and the one control that bounds
  accumulation absolutely. **Outstanding.**

Moving bytes through the Worker is viable only because the runtime streams a
request body into R2 without it passing through any JavaScript — waiting on
I/O is not CPU time. Worth measuring rather than assuming: push a file through
and read the CPU time off `wrangler tail`.

Approving records a decision; it publishes nothing. Publication stays with
`syndex-upload`, which opens the HDF5, verifies the digest, and registers R2
and D1 together.

## Validation

Every uploaded file is checked before a reviewer opens it. The checker is
Python and needs h5py, so it cannot run in the Worker: completing an upload
fires a `repository_dispatch`, and a GitHub Actions runner installs the
package, fetches the object and posts the verdict back.

A runner rather than a Cloudflare container because a container needs a paid
Workers plan and this does not, and because runner disk is 14 GB — larger than
any container tier offered, which matters for 30 GB grids.

The rules live in one place: a contributor runs `syndex-check` before
submitting, the runner runs the same command, and a reviewer runs it again on
the file they downloaded, so "it passed for me" and "it passed for the
reviewer" cannot mean different things.

The runner gets a signed link to one object, good for six hours, and nowhere
else to send the answer. It has no account and no credentials: the link says
"this object, until this time". The report comes back to an endpoint
authenticated by a shared secret compared in constant time. What arrives is
confirmed rather than trusted — the runner installs a version of the checker
the Worker did not — and an unrecognised state is read as `failed`, which asks
a person to look rather than letting something through.

The runner reads every byte anyway, so it hashes the file while it is there.
That digest is what `files.sha256` needs at publication, and it answers "do we
already have exactly these bytes", against the catalogue and against the rest
of the queue — the one question that can end a review before it starts. The
form does not ask a contributor for a digest: it would mean hashing 30 GB by
hand to catch a truncated transfer, which the sizes catch on their own.

Validation needs `GITHUB_ISSUE_REPO` in `vars`, `GITHUB_DISPATCH_TOKEN` as a
secret (fine-grained, **Contents: read and write** on that repository, which is
what `repository_dispatch` requires), and `SYNDEX_REPORT_SECRET` as both a
Worker secret and a GitHub Actions secret of the same name. Without them
validation is skipped silently and nothing is blocked: the submission sits with
no verdict, the review page says so, and a reviewer can run the checker
themselves.

## Outstanding

- The R2 lifecycle rule on the submissions bucket.
- A "Do Not Inspect" Gateway rule for the apex and for
  `data.synthesizer-project.org`. The policy currently TLS-intercepts it, which
  breaks HTTPS from any local tool while the VPN is up.
- Model names want tidying for facet labels. `Draine & Li` and `Draine & Li
  dust extinction curves` are one model spelled two ways and appear as two
  rows; `Bruzual & Charlot (2003), 2016 update` is correct but unusable in a
  narrow rail, so models want a short label alongside the full name.

## Later

- An interactive coverage view (age/metallicity, Cloudy, IMF). The static
  `syndex-plots` output already covers sharing with colleagues.
- Generating the job scripts to process an incident grid through Cloudy,
  delivered as a downloadable bundle.
