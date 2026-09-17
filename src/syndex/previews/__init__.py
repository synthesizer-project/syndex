"""Indicative preview plots for individual catalogue files.

Every published file that can be plotted gets one small PNG, stored in R2
alongside the data and recorded on the file row in D1. The portal shows it as a
thumbnail on the dataset page. A file that cannot honestly be summarised in one
plot gets no image rather than a misleading one, and the reason is reported.

The files are read straight out of R2 over HTTP range requests, so a 26 GiB
grid never lands on disc. Generation, upload and the D1 update are separate
steps behind one manifest, which makes a long run resumable: an interrupted
pass costs only the file in flight.

    syndex-previews --output-dir plots --only bc03-2016-basel-chabrier   # judge
    syndex-previews --apply                                             # publish

The y-range rule is Synthesizer's, from ``emissions/sed.py plot_spectra``: five
decades below the peak. Without it a grid spanning forty orders of magnitude
plots as a flat line along the bottom of the axes.

`r2` reads the file, `kinds` decides what to draw and draws it, `figure` is
what it looks like, `store` finds the candidates and records the results, and
`cli` is the command that runs them in that order.
"""
