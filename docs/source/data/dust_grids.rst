Dust grids
**********

What it is
==========

A dust grid holds either **dust attenuation curves** or **dust emission** spectra over a set of parameters. Synthesizer uses them in its dust attenuation and emission models.

What's in the file
==================

The same layout as a :doc:`grid <grids>`: an ``axes`` root attribute naming the axes, one ``axes/<name>`` dataset per axis with a ``Units`` attribute, then either:

- ``extinction_curves/``: attenuation curves and their ``wavelength``, or
- ``spectra/``: dust emission spectra and their ``wavelength``.

Naming
======

Include ``dust`` and say which of the two it is, e.g. ``draine-li-dust-extcurve-mrn`` or ``draine-li-dust-emission-mw-3p1``.

Submitting one
==============

An ``extinction_curves`` group is always read as an attenuation grid.

A ``spectra`` group looks the same in a dust emission grid as in an SPS grid, so here the **filename** decides: it must contain ``dust``. Without it, the file is checked as an ordinary grid and refused for not saying what kind of grid it is.

Axes are checked as for :doc:`grids <grids>`: plural names, and dimensionless or time units where those are unambiguous.
