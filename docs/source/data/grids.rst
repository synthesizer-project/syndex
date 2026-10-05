Grids
*****

A grid is the emission of a stellar population synthesis (SPS) or AGN model, worked out over a range of parameters: ages and metallicities for a stellar population, or black hole masses and accretion rates for an AGN, for example. Synthesizer interpolates over these to give galaxies their spectra.

Grids come in two kinds:

**Incident**
   The model's own emission, as its authors provide it.
**Photoionised**
   The same emission passed through a photoionisation code, usually Cloudy, which adds the nebular continuum and emission lines from the surrounding gas.

Grids are made with `syncretize <https://github.com/synthesizer-project/syncretize>`_, and Synthesizer's `grids documentation <https://synthesizer-project.org/synthesizer/emission_grids/grids.html>`_ explains how to use them.

What's in the file
==================

A grid is an HDF5 file. If you made it with syncretize, it already has everything below. At minimum it needs its axes, and at least one of ``spectra``, ``lines`` or ``log10_specific_ionising_luminosity``.

.. list-table::
   :header-rows: 1
   :widths: 35 65

   * - Location
     - Contents
   * - ``axes`` attribute
     - The names of the axes, in order.
   * - ``axes/<name>``
     - The values along each axis, with their ``Units``. An axis marked ``log_on_read`` is read in log space.
   * - ``spectra/``
     - One dataset per kind of spectrum (``incident``, ``nebular``, …), and the ``wavelength`` they share.
   * - ``lines/``
     - Line luminosities, with each line's ``id`` and ``wavelength``.
   * - ``log10_specific_ionising_luminosity``
     - Ionising photon luminosities.
   * - ``Model/``
     - Which model this is: ``sps_name`` and ``sps_version`` for an SPS model, or ``type = "agn"`` and ``family`` for an AGN model.
   * - ``CloudyParams/``
     - The photoionisation settings, including ``cloudy_version``. Photoionised grids only.
   * - Root attributes
     - ``synthesizer_version``, ``synthesizer_grids_version`` and ``date_created``, recording how and when the grid was made.

Naming
======

A grid's name lists what makes it distinct, from the model down to the processing:

.. code-block:: text

    bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01
    │     │     │   │          │         └ photoionisation code and version
    │     │     │   │          └ IMF mass range (0.1 to 300 solar masses)
    │     │     │   └ IMF (Chabrier 2003)
    │     │     └ variant (binary stars)
    │     └ version (2.2.1)
    └ model (BPASS)

An incident grid stops before the photoionisation code. A photoionised grid takes its incident grid's name and adds the code, and anything that differs from the standard photoionisation setup goes on the end, as in ``…-cloudy-c23p01-resolution0p05``.

Checks
======

``syndex-check`` reads a grid's kind from what is inside it, not from its name, with one exception.

.. warning::

   A filename containing ``dust`` is always treated as a :doc:`dust grid <dust_grids>`. Keep ``dust`` out of the name of any other grid.

Errors
------

These stop a grid being published.

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Problem
     - Fix
   * - The grid does not say what kind of grid it is.
     - Give the ``Model`` group ``sps_name`` for an SPS model, or ``type = "agn"`` for an AGN model.
   * - The grid does not say what emission it holds.
     - Include ``CloudyParams``, or reprocessed spectra (named ``nebular…``, ``transmitted…`` or ``linecont…``). A grid with only ``incident`` spectra is read as incident.
   * - The grid has no axes.
     - Add the ``axes`` attribute and the ``axes/`` group.

Warnings
--------

These are reported, but do not stop a grid being published. They are still worth fixing.

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Problem
     - Fix
   * - An axis name is singular.
     - Use the plural: ``ages``, ``metallicities``, ``ionisation_parameters``, ``hydrogen_densities``, and so on.
   * - An axis has unexpected units.
     - ``ages`` should be a time; ``metallicities``, ``ionisation_parameters``, ``accretion_rates_eddington`` and ``cosine_inclinations`` should be dimensionless.
   * - The filename and the file give different Cloudy versions.
     - A file named ``…cloudy-c25.00…`` should hold ``cloudy_version = c25.00``. Correct whichever is wrong.
   * - No model name, wavelength or ``synthesizer_version`` could be read.
     - Add what is missing. Without a model name, the grid will not appear under its model in the portal's filters.
