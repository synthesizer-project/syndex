The catalogue
*************

Everything in Syndex is a **dataset**: a grid, an instrument, or some other named piece of data. Each dataset has one or more **releases**, the versions of its file that have been published.

Kinds of data
=============

Most of the catalogue is one of three kinds, each with a set file layout that Syndex knows how to read and check:

.. grid:: 1 1 3 3
   :gutter: 3

   .. grid-item-card:: Grids
      :link: grids
      :link-type: doc

      Spectra, lines and ionising luminosities from SPS and AGN models, over a grid of parameters.

   .. grid-item-card:: Dust grids
      :link: dust_grids
      :link-type: doc

      Dust attenuation curves or dust emission spectra, over a grid of parameters.

   .. grid-item-card:: Instruments
      :link: instruments
      :link-type: doc

      Saved Synthesizer instruments: filters or wavelengths, with resolution, PSFs and noise where they have them.

The rest supports Synthesizer's tests and tools. It comes in whatever format its producer wrote, so a reviewer sorts it rather than an automatic check:

``simulation_data``
   Cut-down simulation output for Synthesizer's tests and examples.
``generation_data``
   The raw model inputs grids were built from, kept so they can be rebuilt.
``synference_data``
   Inputs for Synference, the simulation-based inference toolkit built on Synthesizer.
``reference_data``
   Reference outputs that regression tests compare against.
``cache``
   Archived copies of external services, such as SVO filter curves, so tests do not depend on them being up.

Names
=====

Every dataset has two names. The **catalogue name** is the one you download it by, such as ``bpass-2p2p1-bin-chabrier03-0p1-300p0``. It uses lowercase letters, digits and hyphens, with ``p`` in place of a decimal point, and runs from the most general part to the most specific. The **display name** is the readable title the portal shows.

.. important::

   A catalogue name never changes once it is published, because scripts and papers refer to it. Each kind's page shows how names are built for it.

Releases
========

A new version of a dataset is published as a new release under the same name. Nothing is overwritten: older releases keep their files and stay downloadable with ``--release``.

Markers
=======

Some datasets carry a marker in the portal:

**known bug**
   A problem has been found in the current release since it was published. The dataset's page explains it.
**recommended**
   The maintainers' default choice for this kind of data.
**reduced**
   A small, cut-down copy for tests and examples. Not for science.
**CI**
   Downloaded by Synthesizer's own test suite.

.. toctree::
   :maxdepth: 1
   :hidden:

   grids
   dust_grids
   instruments
