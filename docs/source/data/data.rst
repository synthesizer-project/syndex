The catalogue
*************

Every entry in the catalogue is a **dataset**: one named thing, such as a grid or an instrument, with one or more **releases** of its file.

Data types
==========

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - Type
     - What it is
   * - :doc:`grid <grids>`
     - Spectra, lines or ionising luminosities from an SPS or AGN model, over a grid of parameters.
   * - :doc:`dust_grid <dust_grids>`
     - Dust attenuation curves or dust emission, over a grid of parameters.
   * - :doc:`instrument <instruments>`
     - A saved Synthesizer instrument: filters, and optionally resolution, PSFs and noise.

The catalogue also holds supporting data that Synthesizer's tests and tools download: ``simulation_data``, ``generation_data`` (raw model inputs used to build grids), ``synference_data``, ``reference_data`` and ``cache``. These have no fixed layout, so they are not checked automatically; a reviewer categorises them.

Names
=====

A dataset's **catalogue name** is what you download it by, so it is fixed once published. It uses lowercase letters, digits and hyphens only, and follows the pattern of existing entries, for example ``bpass-2p2p1-bin-chabrier03-0p1-300p0`` (model, version, variant, IMF and mass range, with ``p`` for a decimal point).

Its **display name** is the human-readable title shown on the portal, and can be anything.

Releases
========

Publishing a new file under an existing name adds a release; it never replaces one. Old releases keep their bytes and stay downloadable with ``--release``, so a result can always be reproduced from the file it used.

Releases can be marked:

- **Known bug**: a defect found after publication. The dataset page describes it.
- **Deprecated**: superseded, and kept only so existing work stays reproducible.

Datasets can be marked:

- **Test**: deliberately reduced, for running examples and tests. Not for science.
- **CI**: downloaded by Synthesizer's continuous integration.

.. toctree::
   :maxdepth: 1

   grids
   dust_grids
   instruments
