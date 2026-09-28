Contributing data
*****************

Anyone can read the catalogue. To add to it, you check your file, describe it on the `portal <https://synthesizer-project.org/syndex/submit>`_, and upload it from the browser or the command line. A reviewer then looks at it, and a maintainer publishes it.

Before you start
================

**Get access.** Sign in to the portal with GitHub and `request access <https://synthesizer-project.org/syndex/access>`_. In a sentence or two, say what the data is, roughly how large it is and how it was produced. A maintainer will reply through GitHub.

**Install the tools.** They need Python 3.10 or later, and nothing beyond ``h5py`` and ``numpy``:

.. code-block:: bash

    pip install cosmos-syndex

This provides two commands: ``syndex-check``, which checks a file, and ``syndex-submit``, which uploads one from the command line.

1. Check the file
=================

Every upload is checked automatically, by the same rules ``syndex-check`` applies. Running it yourself first means finding a missing attribute in a second, rather than after uploading 30 GB:

.. code-block:: bash

    syndex-check my-grid.hdf5

It reports what the file is, what it read from it, any problems, and a verdict on the last line:

.. code-block:: text

    my-grid.hdf5
      format        hdf5
      category      grid
      because       axes and spectra, with the Model group naming the SPS model 'BPASS'
      grid_type     sps
      axes          ages[51], metallicities[13]
      ...
      warning: axis 'age' is singular; grid axes use the plural form 'ages'
      ready to submit

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Verdict
     - Meaning
   * - ``ready to submit``
     - Nothing blocks publication. Any warnings above it are conventions the file breaks; fix them if you can.
   * - ``ready to submit; a reviewer will categorise it``
     - The file is not a grid, dust grid or instrument, so there is nothing structural to check. This is expected for other data.
   * - ``not ready``
     - The lines marked ``ERROR`` must be fixed before the file can be published.

Each data type's page lists what causes its errors and warnings, and how to fix them: :doc:`grids <../data/grids>`, :doc:`dust grids <../data/dust_grids>` and :doc:`instruments <../data/instruments>`.

Several files can be checked at once, and the exit status is ``0`` only if every one passes. ``--json`` prints the report for a script to read.

2. Describe it
==============

On the `submit page <https://synthesizer-project.org/syndex/submit>`_, choose **New dataset** for something not yet in the catalogue, or **New release** for a new version of an existing dataset. A new release keeps its dataset's name and description, and earlier releases stay downloadable.

The form asks for:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Field
     - What to enter
   * - Data type
     - One of the :doc:`catalogue's types <../data/data>`, or *other* if none fits and a reviewer should decide.
   * - Catalogue name
     - Lowercase letters, digits and hyphens, following the :doc:`naming convention <../data/data>`. People download by it, so it cannot change later.
   * - Display name
     - The title shown on the portal.
   * - Description
     - What the data is, and what it is not suitable for.
   * - Citations
     - The ADS bibcodes it should be cited with, such as ``2017PASA...34...58E``.
   * - Licence
     - Its licence, if it has one.
   * - Notes for the reviewer
     - Anything else they should know.

Axes, filters, and model and code versions are read from the file, so there is no need to enter them.

3. Upload the file
==================

Saving the form opens the submission's page, which offers two ways to upload the file. Both send it to the same place, so choose by its size and where it is:

.. list-table::
   :header-rows: 1
   :widths: 20 20 60

   * - From
     - Largest file
     - Best for
   * - The browser
     - 10 GB
     - A file on the machine you are browsing from. Choose it on the submission's page. If the upload is interrupted, it starts again from the beginning.
   * - ``syndex-submit``
     - about 189 GB
     - Anything larger, or a file on a remote machine you reach over SSH, such as an HPC system. An interrupted upload resumes.

To upload from the command line, copy the upload token from the submission's page:

.. code-block:: bash

    syndex-submit 6630a2d3da236ed83f246c1040fdcd06 my-grid.hdf5

The first time, it asks you to sign in by entering a code at `github.com/login/device <https://github.com/login/device>`_, from any device. It keeps the resulting session in ``~/.config/syndex/`` and stores nothing else; signing out from your account page ends it.

The file is sent in 90 MiB pieces, and a piece that fails is retried. If the upload stops altogether, run the same command again: it sends only the pieces still missing. It starts from the beginning instead if the file has changed, or if the upload was restarted from the browser in the meantime.

Add ``--check`` to run ``syndex-check`` first and stop if the file would be refused. All options are listed under :doc:`command_line`.

4. Review
=========

Once the upload finishes:

1. The file is checked again automatically. The report appears on the submission's page, and says if the catalogue already holds an identical file.
2. Reviewers are notified. One of them approves the submission, or explains why not.
3. An approved submission is published by a maintainer, and appears in the catalogue.
4. If it is not accepted, fix what the reviewer describes and submit again from `your submissions <https://synthesizer-project.org/syndex/submissions>`_. The form is filled in from the earlier attempt.

Each account may have up to 10 submissions waiting for review, and the whole queue holds up to 50. Both limits clear as submissions are reviewed. If your data does not fit the limits here, `open an issue <https://github.com/synthesizer-project/synthesizer/issues>`_ and a maintainer will arrange another way.

.. toctree::
   :maxdepth: 1
   :hidden:

   command_line
