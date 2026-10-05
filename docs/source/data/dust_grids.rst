Dust grids
**********

A dust grid describes what dust does to light, worked out over a range of parameters. Synthesizer uses them in its dust models. They come in two kinds:

**Attenuation**
   How much light the dust absorbs and scatters, as a function of wavelength.
**Emission**
   The infrared spectrum the dust gives off as it re-emits that energy.

What's in the file
==================

A dust grid has the same axes as a :doc:`grid <grids>`: an ``axes`` attribute naming them, and an ``axes/<name>`` dataset for each, with its ``Units``. Over those axes it holds one of:

``extinction_curves/``
   Attenuation curves, and the ``wavelength`` they cover.
``spectra/``
   Dust emission spectra, and their ``wavelength``.

Naming
======

Name a dust grid after its model, include ``dust``, and say which kind it is:

``draine-li-dust-extcurve-mrn``
   Draine and Li attenuation curves, for an MRN grain size distribution.
``draine-li-dust-emission-mw-3p1``
   Draine and Li (2007) dust emission for the Milky Way, with :math:`R_V = 3.1`.

Checks
======

A dust grid is checked like any other :doc:`grid <grids>`, axis warnings included. The one difference is how it is recognised.

An ``extinction_curves`` group is unmistakable, so attenuation grids are recognised by their contents. A ``spectra`` group, though, looks the same in a dust emission grid as in an SPS grid, so for emission grids the filename decides.

.. important::

   A dust emission grid's filename must contain ``dust``. Without it, the file is treated as an ordinary grid and refused for not saying what kind of grid it is.
