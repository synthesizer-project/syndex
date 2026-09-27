Grids
*****

What it is
==========

A grid holds the emission of a stellar population synthesis (SPS) or AGN model, computed over a set of parameters: ages and metallicities for an SPS model, or black hole masses and accretion rates for an AGN model, for example.

An **incident** grid is the model as provided. A **photoionised** grid has been reprocessed through a photoionisation code, usually Cloudy, which adds nebular emission and lines.

Grids are made with `syncretize <https://github.com/synthesizer-project/syncretize>`_. Synthesizer's `grids documentation <https://synthesizer-project.org/synthesizer/emission_grids/grids.html>`_ explains how to use them.

What's in the file
==================

A grid is an HDF5 file laid out as follows. It needs the axes and at least one of ``spectra``, ``lines`` or ``log10_specific_ionising_luminosity``; everything else is read if present. Grids written by syncretize already have all of it.

.. list-table::
   :header-rows: 1
   :widths: 35 65

   * - Where
     - What
   * - ``axes`` (root attribute)
     - The axis names, in order.
   * - ``axes/<name>``
     - One dataset per axis. A ``Units`` attribute gives its units, and ``log_on_read`` marks an axis to be read in log space.
   * - ``spectra/``
     - One dataset per spectrum (``incident``, ``nebular``, …), plus their ``wavelength``.
   * - ``lines/``
     - Line luminosities, with the line ``id`` and ``wavelength``.
   * - ``log10_specific_ionising_luminosity``
     - Ionising photon luminosities.
   * - ``Model/``
     - The model. ``sps_name`` and ``sps_version`` for an SPS model; ``type = "agn"`` and ``family`` for an AGN model.
   * - ``CloudyParams/``
     - The photoionisation parameters, including ``cloudy_version``. Photoionised grids only.
   * - Root attributes
     - ``synthesizer_version``, ``synthesizer_grids_version`` and ``date_created``.

Naming
======

A grid is named by model, version, variant, then the IMF and its parameters. A photoionised grid takes the name of the grid it was made from, followed by the code and its version. Anything that differs from the default photoionisation setup comes last.

.. list-table::
   :header-rows: 1
   :widths: 55 45

   * - Name
     - Grid
   * - ``bpass-2p2p1-bin-chabrier03-0p1-300p0``
     - BPASS 2.2.1 binary models, Chabrier (2003) IMF from 0.1 to 300 solar masses. Incident.
   * - ``bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01``
     - The same models, photoionised with Cloudy c23.01.
   * - ``bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01-resolution0p05``
     - The same again, at a different resolution.

Submitting one
==============

``syndex-check`` works out what kind of grid a file is from its contents, with one exception: a filename containing ``dust`` marks it as a :doc:`dust grid <dust_grids>`, whatever its ``Model`` group says. Keep ``dust`` out of the name of any other grid.

Errors stop a grid being published; warnings are reported but do not.

.. list-table::
   :header-rows: 1
   :widths: 15 40 45

   * -
     - Problem
     - Fix
   * - Error
     - The grid does not say what kind of grid it is.
     - Give the ``Model`` group ``sps_name`` for an SPS model, or ``type = "agn"`` for an AGN model.
   * - Error
     - The grid does not say what emission it holds.
     - Include ``CloudyParams``, or spectra showing reprocessing (names beginning ``nebular``, ``transmitted`` or ``linecont``). A grid holding only ``incident`` spectra is read as incident.
   * - Error
     - The grid has no axes.
     - Add the ``axes`` attribute and the ``axes/`` group.
   * - Warning
     - An axis name is singular.
     - Use the plural: ``ages``, ``metallicities``, ``ionisation_parameters``, ``hydrogen_densities``, and so on.
   * - Warning
     - An axis has unexpected units.
     - ``ages`` should be a time; ``metallicities``, ``ionisation_parameters``, ``accretion_rates_eddington`` and ``cosine_inclinations`` should be dimensionless.
   * - Warning
     - The filename and the file disagree on the Cloudy version.
     - A filename containing ``cloudy-c25.00`` must hold ``cloudy_version = c25.00``. Correct whichever is wrong.
   * - Warning
     - No model name, wavelength or ``synthesizer_version`` could be read.
     - Add what is missing. Without a model name the grid will not appear under its model in the portal's filters.
