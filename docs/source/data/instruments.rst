Instruments
***********

An instrument file is a Synthesizer instrument saved to disk, filters, PSFs, noise and all, so anyone can produce the same observables without rebuilding it. Synthesizer's `instruments documentation <https://synthesizer-project.org/synthesizer/observatories/observatories.html>`_ explains how to use one.

Every instrument is one of five types:

``photometric``
   Integrated photometry through a set of filters.
``photometric_imager``
   Photometry and imaging. Adds a resolution, and optionally a PSF and noise map for each filter.
``spectroscopic``
   One-dimensional spectroscopy over a wavelength array.
``ifu``
   Spatially resolved spectroscopy: a wavelength array and a resolution.
``collection``
   Several of the above in one file.

What's in the file
==================

Whatever Synthesizer writes when it saves an instrument, with ``InstrumentCollection.write_instruments`` or an instrument's ``to_hdf5``. You do not need to add anything by hand.

That is an ``instrument_type`` attribute, followed by the groups the instrument has: ``Filters`` or ``Wavelength``, and optionally ``Resolution``, ``PSFs``, ``Depth``, ``SNRs`` and ``NoiseMaps``. A collection holds one such group per instrument, plus a ``Header``. Synthesizer's premade instrument files have no ``instrument_type`` attribute, and are recognised too.

What an instrument can do (photometry, imaging, spectroscopy) is worked out from which of these groups are present.

Naming
======

Name an instrument after its observatory and instrument, ending in ``-instrument``, as in ``euclid-nisp-instrument`` for Euclid's NISP photometric imager.

Checks
======

Errors
------

These stop an instrument being published.

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Problem
     - Fix
   * - ``instrument_type`` is not one Synthesizer recognises.
     - Save the instrument again with a current version of Synthesizer.
   * - A collection holds no instruments.
     - Check the file was written with ``write_instruments``.

Warnings
--------

These are reported, but do not stop an instrument being published.

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Problem
     - Fix
   * - A ``photometric`` or ``photometric_imager`` instrument has no filter codes.
     - Save the filters with their codes. Without them, the instrument cannot be found by filter in the portal.
