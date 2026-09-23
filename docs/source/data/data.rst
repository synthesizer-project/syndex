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

A dataset's **catalogue name** is what you download it by, so it is fixed once published. It uses lowercase letters, digits and hyphens only, with ``p`` for a decimal point. Names are built from what distinguishes the data, most general first, following existing entries of the same type; each type's page gives examples.

Its **display name** is the human-readable title shown on the portal, and can be anything.

Releases
========

Publishing a new file under an existing name adds a release; it never replaces one. Old releases keep their bytes and stay downloadable with ``--release``, so a result can always be reproduced from the file it used.

Markers
=======

The portal marks datasets with:

- **known bug**: a defect found in the current release after publication. The dataset page says what it is; check it before relying on the data.
- **recommended**: the maintainers' default choice for this kind of data.
- **reduced**: a small cut-down copy for tests and examples. Not for science.
- **CI**: downloaded by Synthesizer's own test suite.

.. toctree::
   :maxdepth: 1

   grids
   dust_grids
   instruments
