Dust grids
**********

What it is
==========

A dust grid holds either **dust attenuation curves** or **dust emission** spectra, computed over a set of parameters. Synthesizer uses them in its dust attenuation and dust emission models.

What's in the file
==================

A dust grid uses the same axes as a :doc:`grid <grids>`: an ``axes`` root attribute naming them, and one ``axes/<name>`` dataset per axis with a ``Units`` attribute. What it holds over those axes depends on its kind:

.. list-table::
   :header-rows: 1
   :widths: 30 35 35

   * - Kind
     - Group
     - Recognised by
   * - Attenuation
     - ``extinction_curves/``, with ``wavelength``
     - The group alone.
   * - Emission
     - ``spectra/``, with ``wavelength``
     - ``dust`` in the filename.

Naming
======

Include ``dust`` and say which kind it is.

.. list-table::
   :header-rows: 1
   :widths: 55 45

   * - Name
     - Grid
   * - ``draine-li-dust-extcurve-mrn``
     - Draine and Li attenuation curves, MRN grain size distribution.
   * - ``draine-li-dust-emission-mw-3p1``
     - Draine and Li (2007) Milky Way dust emission, :math:`R_V = 3.1`.

Submitting one
==============

A ``spectra`` group looks the same in a dust emission grid as in an SPS grid, so for emission grids the filename decides. Otherwise dust grids are checked as :doc:`grids <grids>` are, including their axis warnings.

.. list-table::
   :header-rows: 1
   :widths: 15 40 45

   * -
     - Problem
     - Fix
   * - Error
     - A dust emission grid is refused for not saying what kind of grid it is.
     - Put ``dust`` in the filename. Without it the file is treated as an ordinary grid.
