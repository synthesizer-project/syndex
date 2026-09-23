# Syndex

[![Tests](https://github.com/synthesizer-project/syndex/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/synthesizer-project/syndex/actions/workflows/tests.yml)
[![PyPI version](https://img.shields.io/pypi/v/cosmos-syndex.svg)](https://pypi.org/project/cosmos-syndex/)
[![Python versions](https://img.shields.io/pypi/pyversions/cosmos-syndex.svg)](https://pypi.org/project/cosmos-syndex/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)
[![Catalogue](https://img.shields.io/badge/catalogue-synthesizer--project.org-4a9acc)](https://synthesizer-project.org/syndex)

<img alt="syndex_logo" src="https://synthesizer-project.org/syndex/static/syndex_logo_2.png" align="right" width="140px"/>

Syndex is the data index for the [Synthesizer project](https://github.com/synthesizer-project): a searchable catalogue of stellar population synthesis and AGN grids, dust models, instruments and simulation data, and a stable service for downloading them.

Browse it at [synthesizer-project.org/syndex](https://synthesizer-project.org/syndex), and read the [documentation](https://synthesizer-project.org/syndex/docs/) for what it holds and how to contribute.

This package is the tooling that goes with it. You do not need it to download data — [Synthesizer](https://github.com/synthesizer-project/synthesizer) does that with `synthesizer-download` — you need it to **contribute** data: to check a file against what the catalogue requires before submitting it, and to send large files from a machine that has no browser.

## Installation

```bash
pip install cosmos-syndex
```

It needs Python 3.10 or later, and nothing but `h5py` and `numpy`.

To install an unreleased change, point pip at the repository instead:

```bash
pip install 'git+https://github.com/synthesizer-project/syndex.git'
```

## Getting data

You do not need this package for that. Browse the [catalogue](https://synthesizer-project.org/syndex), then download with Synthesizer:

```bash
synthesizer-download --dataset bpass-2p2p1-bin-chabrier03-0p1-300p0
```

Everything the portal shows is also available as JSON from `https://data.synthesizer-project.org`, described in the [documentation](https://synthesizer-project.org/syndex/docs/api.html).

## Contributing data

Submissions go through the [portal](https://synthesizer-project.org/syndex/submit), which needs a GitHub account and a maintainer to grant you access. Describe the dataset, then send the file.

### Check it first

Every submission is put through the same checker automatically. Running it yourself first means finding a missing attribute in a second rather than after sending 30 GB:

```bash
syndex-check my-grid.hdf5
```

It reports what the file is, what was read out of it, and anything that would stop it being published — a grid that does not say what kind of grid it is, an axis named in the singular, a Cloudy version disagreeing with the filename. `--json` gives the same thing for a machine to read.

### Send a large file

The browser handles anything up to 10 GB. Above that, or on a machine you reach over SSH, use the token from the submission's page:

```bash
syndex-submit 6630a2d3da236ed83f246c1040fdcd06 my-grid.hdf5
```

It signs in through GitHub's device flow the first time, sends the file in pieces, and resumes where it stopped if it is interrupted.

## Development

See [`docs/development.md`](https://github.com/synthesizer-project/syndex/blob/main/docs/development.md) for running the service locally, the test suites, and how the pieces fit together.

## Licence

[GNU General Public License v3.0](https://github.com/synthesizer-project/syndex/blob/main/LICENSE).
