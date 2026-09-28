Syndex
******

Syndex is the data catalogue for the `Synthesizer <https://synthesizer-project.org/synthesizer/>`_ project. It holds the stellar population synthesis and AGN grids, dust grids and instruments that Synthesizer uses, and serves every published version of them for download.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - To…
     - Go to
   * - Find a dataset
     - The `catalogue <https://synthesizer-project.org/syndex>`_, which shows what each dataset holds, its releases and its citations.
   * - Download one
     - Synthesizer's ``synthesizer-download``, below. Nothing from this package is needed.
   * - Understand what one contains
     - :doc:`data/data`
   * - Contribute one
     - :doc:`contributing/contributing`
   * - Query the catalogue from code
     - :doc:`api`

Getting data
============

Download a dataset by its catalogue name:

.. code-block:: bash

    synthesizer-download --dataset bpass-2p2p1-bin-chabrier03-0p1-300p0

This fetches the current release. To reproduce a result from exactly the file it used, pin the release instead. Each dataset's page lists its releases with their ids and download commands:

.. code-block:: bash

    synthesizer-download --dataset bpass-2p2p1-bin-chabrier03-0p1-300p0 --release 42

Synthesizer's `downloading guide <https://synthesizer-project.org/synthesizer/getting_started/downloading_grids.html>`_ explains where files are saved and how to load them.

Citing data
===========

Each release lists the papers to cite when you use it: the model, the paper that released it, and the code it was processed with. The dataset's page gives them as BibTeX, exactly as ADS produced them, to copy or download. Please cite these alongside Synthesizer itself.

Before relying on a release, check whether it is marked **known bug**. The dataset's page describes the problem.

.. toctree::
   :maxdepth: 2
   :hidden:

   data/data
   contributing/contributing
   api
