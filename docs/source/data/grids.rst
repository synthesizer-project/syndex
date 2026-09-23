Grids
*****

What it is
==========

A grid holds the emission of a stellar population synthesis (SPS) or AGN model computed over a set of parameters, such as ages and metallicities for SPS models, or black hole masses and accretion rates for AGN.

Grids are either **incident** (the model as provided) or **photoionised** (reprocessed through a photoionisation code, usually Cloudy, adding nebular emission and lines). Synthesizer's `grids documentation <https://synthesizer-project.org/synthesizer/emission_grids/grids.html>`_ covers using them; `syncretize <https://github.com/synthesizer-project/syncretize>`_ creates them.

What's in the file
==================

An HDF5 file with:

.. list-table::
   :header-rows: 1
   :widths: 35 65

   * - Where
     - What
   * - ``axes`` (root attribute)
     - The axis names, in order.
   * - ``axes/<name>``
     - One dataset per axis, with a ``Units`` attribute, and ``log_on_read`` if it should be read in log space.
   * - ``spectra/``
     - One dataset per spectrum (``incident``, ``nebular``, …) and a ``wavelength`` dataset.
   * - ``lines/``
     - Line luminosities: ``id``, ``wavelength`` and the luminosities.
   * - ``log10_specific_ionising_luminosity``
     - Ionising photon luminosities.
   * - ``Model/``
     - The model: ``sps_name`` and ``sps_version`` for SPS, ``type = "agn"`` and ``family`` for AGN.
   * - ``CloudyParams/``
     - Photoionisation parameters, including ``cloudy_version``. Photoionised grids only.
   * - Root attributes
     - ``synthesizer_version``, ``synthesizer_grids_version``, ``date_created``.

A grid needs the axes and at least one of ``spectra``, ``lines`` or ``log10_specific_ionising_luminosity``. Grids written by syncretize have all of this already.

Naming
======

Model, version, variant, IMF and its parameters, with ``p`` for a decimal point:

- ``bpass-2p2p1-bin-chabrier03-0p1-300p0``: incident BPASS 2.2.1 binary models, Chabrier (2003) IMF from 0.1 to 300 solar masses.
- ``bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01``: the same models photoionised with Cloudy c23.01. A photoionised grid is named after its incident grid plus the code and version.
- ``bpass-2p2p1-bin-chabrier03-0p1-300p0-cloudy-c23p01-resolution0p05``: anything that differs from the default photoionisation setup goes last.

Submitting one
==============

``syndex-check`` reads the type from the file, not the filename. It refuses a grid that:

- **does not say what kind of grid it is**: the ``Model`` group needs ``sps_name`` (SPS) or ``type = "agn"`` (AGN).
- **does not say what emission it holds**: it needs ``CloudyParams``, reprocessed spectra (names starting ``nebular``, ``transmitted`` or ``linecont``), or only ``incident``.
- **has no axes**.

It warns, without refusing, when:

- an axis name is singular. Grid axes are plural: ``ages``, ``metallicities``, ``ionisation_parameters``, ``hydrogen_densities``, …
- an axis has the wrong units: ``ages`` in a time unit, and ``metallicities``, ``ionisation_parameters``, ``accretion_rates_eddington`` and ``cosine_inclinations`` dimensionless.
- the filename names a Cloudy version (e.g. ``cloudy-c25.00``) that ``cloudy_version`` in the file disagrees with.
- there is no model name, no wavelength, or no ``synthesizer_version``.

Do not put ``dust`` in the filename of a grid that is not a dust grid: a filename containing it is read as a :doc:`dust grid <dust_grids>`, whatever the ``Model`` group says.
