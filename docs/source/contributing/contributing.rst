Contributing data
*****************

Anyone can read the catalogue. Adding to it goes through the `portal <https://synthesizer-project.org/syndex/submit>`_, in five steps:

1. **Get access.** Sign in with GitHub and `request access <https://synthesizer-project.org/syndex/access>`_, saying what you would like to contribute. A maintainer will say yes through GitHub.
2. **Check the file** with ``syndex-check``, so problems are fixed before anything is sent. See :doc:`checking`.
3. **Describe it** on the submission form (below).
4. **Send the file**, from the browser or with ``syndex-submit``. See :doc:`submitting`.
5. **Review.** The same check runs again on the uploaded file, then a reviewer looks at it. Once approved, a maintainer publishes it and it appears in the catalogue.

What each type of file must contain is on its page under :doc:`../data/data`.

Describing a submission
=======================

Choose **New dataset** for something not yet in the catalogue, or **New release** for a new version of an existing one. A new release keeps the dataset's name; that is what makes it a release rather than a second dataset.

The form asks for:

- **Data type**: one of the :doc:`catalogue types <../data/data>`, or *other* if none fits and a reviewer should decide.
- **Catalogue name**: lowercase letters, digits and hyphens. People download by it, so it cannot change later. See :doc:`../data/data`.
- **Display name** and **description**: what it is, and what it is not suitable for.
- **Citations**: the ADS bibcodes the data should be cited with, e.g. ``2017PASA...34...58E``.
- **Licence**, if the data has one.
- **Notes for the reviewer**: anything else they should know.

Grid, dust grid and instrument metadata (axes, filters, versions) is read from the file, not typed in.

.. toctree::
   :maxdepth: 1

   checking
   submitting
   command_line
