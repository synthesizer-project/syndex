Instruments
***********

What it is
==========

An instrument file is a saved Synthesizer instrument, or a collection of them, ready to produce observables without rebuilding its filters, PSFs or noise. Synthesizer's `instruments documentation <https://synthesizer-project.org/synthesizer/observatories/observatories.html>`_ explains how to use one.

There are five types:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - ``instrument_type``
     - What it can do
   * - ``photometric``
     - Integrated photometry through a set of filters.
   * - ``photometric_imager``
     - Photometry and imaging. Adds a resolution, and optionally PSFs and noise maps for each filter.
   * - ``spectroscopic``
     - One-dimensional spectroscopy over a wavelength array.
   * - ``ifu``
     - Resolved spectroscopy: a wavelength array and a resolution.
   * - ``collection``
     - Several of the above in one file.

What's in the file
==================

Whatever Synthesizer wrote when the instrument was saved, with ``InstrumentCollection.write_instruments`` or an instrument's ``to_hdf5``. That is an ``instrument_type`` attribute, then the groups the instrument has: ``Filters`` or ``Wavelength``, and optionally ``Resolution``, ``PSFs``, ``Depth``, ``SNRs`` and ``NoiseMaps``. A collection holds one such group per instrument, plus a ``Header``.

Synthesizer's premade instrument files, which have no ``instrument_type``, are recognised too.

What an instrument can do is worked out from which groups are present, so there is nothing to fill in by hand.

Naming
======

The observatory and instrument, ending ``-instrument``:

.. list-table::
   :header-rows: 1
   :widths: 55 45

   * - Name
     - Instrument
   * - ``euclid-nisp-instrument``
     - Euclid's NISP photometric imager.

Submitting one
==============

Errors stop an instrument being published; warnings are reported but do not.

.. list-table::
   :header-rows: 1
   :widths: 15 45 40

   * -
     - Problem
     - Fix
   * - Error
     - ``instrument_type`` is not one of the types above.
     - Save the instrument again with a current Synthesizer.
   * - Error
     - A collection holds no instruments.
     - Check the file was written with ``write_instruments``.
   * - Warning
     - A ``photometric`` or ``photometric_imager`` instrument has no filter codes.
     - Save the filters with their codes. Without them the instrument cannot be found by filter on the portal.
