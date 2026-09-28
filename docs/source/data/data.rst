The catalogue
*************

Every entry in the catalogue is a **dataset**: one named thing, such as a grid or an instrument. A dataset has one or more **releases**, each a published version of its file.

Data types
==========

Three types make up most of the catalogue. Each has a fixed file layout, which ``syndex-check`` recognises and checks:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Type
     - What it holds
   * - :doc:`grid <grids>`
     - Spectra, lines or ionising luminosities from an SPS or AGN model, computed over a grid of parameters.
   * - :doc:`dust_grid <dust_grids>`
     - Dust attenuation curves or dust emission spectra, computed over a grid of parameters.
   * - :doc:`instrument <instruments>`
     - A saved Synthesizer instrument: its filters or wavelengths, and optionally its resolution, PSFs and noise.

The rest is supporting data for Synthesizer's tests and tools. It has no fixed layout, so a reviewer categorises it rather than the checker:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Type
     - What it holds
   * - ``simulation_data``
     - Reduced simulation output used by Synthesizer's tests and examples.
   * - ``generation_data``
     - Raw model inputs, kept so grids can be regenerated from their sources.
   * - ``synference_data``
     - Inputs for Synference, the simulation-based inference toolkit built on Synthesizer.
   * - ``reference_data``
     - Reference outputs for regression tests.
   * - ``cache``
     - Archived copies of external services, such as SVO filter curves, so tests do not depend on them.

Names
=====

A dataset's **catalogue name** is what people download it by, so it cannot change once published. It uses lowercase letters, digits and hyphens, with ``p`` standing in for a decimal point. Names run from most to least general, following existing entries of the same type; each type's page gives examples.

Its **display name** is the title shown on the portal, and can be written freely.

Releases
========

Publishing a new file under an existing name adds a release; it never replaces one. Earlier releases keep their bytes and stay downloadable with ``--release``, so a result can always be reproduced from the file it used.

Markers
=======

The portal marks datasets that need a second look:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Marker
     - Meaning
   * - **known bug**
     - A defect was found in the current release after publication. The dataset's page describes it.
   * - **recommended**
     - The maintainers' default choice for this kind of data.
   * - **reduced**
     - A small cut-down copy for tests and examples. Not for science.
   * - **CI**
     - Downloaded by Synthesizer's own test suite.

.. toctree::
   :maxdepth: 1
   :hidden:

   grids
   dust_grids
   instruments
