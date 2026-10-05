Syndex
******

Syndex is where the `Synthesizer <https://synthesizer-project.org/synthesizer/>`_ project keeps its data. It catalogues the stellar population synthesis and AGN grids, dust grids and instruments that Synthesizer uses, and keeps every version ever published available to download, so a result can always be reproduced from the file it was made with.

.. grid:: 1 2 2 2
   :gutter: 3

   .. grid-item-card:: Browse the catalogue
      :link: https://synthesizer-project.org/syndex

      Search every dataset, and see what each one holds, its releases and how to cite it.

   .. grid-item-card:: What's in the catalogue
      :link: data/data
      :link-type: doc

      The kinds of data Syndex holds, how datasets are named, and what goes inside each file.

   .. grid-item-card:: Contribute data
      :link: contributing/contributing
      :link-type: doc

      Check a file, describe it, and upload it from your browser or the command line.

   .. grid-item-card:: Use the API
      :link: api
      :link-type: doc

      Query the catalogue as JSON, from a script or your own tools.

Downloading data
================

You download data with Synthesizer itself, so there is nothing extra to install. Find a dataset in the `catalogue <https://synthesizer-project.org/syndex>`_, then fetch it by name:

.. code-block:: bash

    synthesizer-download --dataset bpass-2p2p1-bin-chabrier03-0p1-300p0

That gets the current release. If you are publishing a result, pin the exact release you used, so others can reproduce it. Each dataset's page lists its releases, with the command for each:

.. code-block:: bash

    synthesizer-download --dataset bpass-2p2p1-bin-chabrier03-0p1-300p0 --release 42

Synthesizer's `downloading guide <https://synthesizer-project.org/synthesizer/getting_started/downloading_grids.html>`_ covers where files are saved and how to load them.

.. warning::

   A dataset marked **known bug** has a problem in its current release. Read the description on its page before you rely on it.

Citing data
===========

The data in Syndex comes from other people's work, so please cite it. Each dataset's page lists the papers to cite, in order (the model, the paper it was released in, then the code it was processed with), and gives them as BibTeX, exactly as ADS has them, ready to copy or download. Cite them alongside Synthesizer itself.

.. toctree::
   :maxdepth: 2
   :hidden:

   data/data
   contributing/contributing
   api
