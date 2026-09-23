Instruments
***********

What it is
==========

A saved Synthesizer instrument, or a collection of them, ready to produce observables without rebuilding filters, PSFs or noise. See Synthesizer's `instruments documentation <https://synthesizer-project.org/synthesizer/observatories/observatories.html>`_ for using one.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - ``instrument_type``
     - What it can do
   * - ``photometric``
     - Integrated photometry through a set of filters.
   * - ``photometric_imager``
     - Photometry and imaging: adds a resolution, and optionally PSFs and noise maps per filter.
   * - ``spectroscopic``
     - One-dimensional spectroscopy over a wavelength array.
   * - ``ifu``
     - Resolved spectroscopy: a wavelength array plus a resolution.
   * - ``collection``
     - Several of the above in one file.

What's in the file
==================

Whatever Synthesizer wrote when the instrument was saved, with ``InstrumentCollection.write_instruments`` or an instrument's ``to_hdf5``: an ``instrument_type`` attribute, then ``Filters``, ``Wavelength``, ``Resolution``, ``PSFs``, ``Depth``, ``SNRs``, ``NoiseMaps`` and so on, as the instrument has them. A collection has one such group per instrument, plus a ``Header``. Synthesizer's premade instrument files, which have no ``instrument_type``, are also recognised.

What the instrument can do is read from which of these are present, so there is nothing to fill in by hand.

Naming
======

The observatory and instrument, ending ``-instrument``, e.g. ``euclid-nisp-instrument``.

Submitting one
==============

``syndex-check`` refuses an instrument whose ``instrument_type`` is not one of the types above, and a collection holding no instruments. It warns when a ``photometric`` or ``photometric_imager`` instrument has no filter codes, since it then cannot be found by filter on the portal.
