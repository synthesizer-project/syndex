Syndex
******

Syndex is the data index for the `Synthesizer <https://synthesizer-project.org/synthesizer/>`_ project: a catalogue of stellar population synthesis and AGN grids, dust grids and instruments, and a stable service for downloading them.

There are three things to do with it:

- **Browse** the catalogue at `synthesizer-project.org/syndex <https://synthesizer-project.org/syndex>`_. Every dataset has a page listing what it holds, its releases, its citations and the command that downloads it.
- **Download** with Synthesizer, which needs nothing from this package (see below).
- **Contribute** a dataset. That is what the ``cosmos-syndex`` package is for: checking a file before you submit it, and sending large files from a machine with no browser. See :doc:`contributing/contributing`.

Getting data
============

Downloading is done by Synthesizer's ``synthesizer-download`` using the dataset's catalogue name:

.. code-block:: bash

    synthesizer-download --dataset bpass-2p2p1-bin-chabrier03-0p1-300p0

Add ``--release <id>`` to fetch a specific release rather than the current one, so a published result can be reproduced from exactly the file it used. Synthesizer's `downloading guide <https://synthesizer-project.org/synthesizer/getting_started/downloading_grids.html>`_ covers where files are saved and how to load them.

The catalogue can also be read as JSON; see :doc:`api`.

Citing data
===========

Each release lists the papers it should be cited with, in order: the model, the release, then the processing code. A dataset's page offers them as BibTeX to copy or download, exactly as ADS produced them. Please cite them alongside Synthesizer itself.

A release marked with a **known bug** is still downloadable, so work that used it stays reproducible, but the dataset page says what is wrong with it. Check before relying on one.

Installation
============

Only needed to contribute:

.. code-block:: bash

    pip install cosmos-syndex

It needs Python 3.10 or later, ``h5py`` and ``numpy``.

.. toctree::
   :maxdepth: 2
   :hidden:

   data/data
   contributing/contributing
   api
