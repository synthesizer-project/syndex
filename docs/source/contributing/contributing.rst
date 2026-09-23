Contributing data
*****************

Anyone can read the catalogue. To add to it, you describe a submission on the `portal <https://synthesizer-project.org/syndex/submit>`_, send the file, and a reviewer checks it before a maintainer publishes it.

Before you start
================

**Get access.** Sign in to the portal with GitHub and `request access <https://synthesizer-project.org/syndex/access>`_. Say in a sentence or two what the data is, roughly how large it is, and how it was produced. A maintainer will reply through GitHub.

**Install the tools** (Python 3.10 or later; only ``h5py`` and ``numpy`` are required):

.. code-block:: bash

    pip install cosmos-syndex

This provides ``syndex-check``, which checks a file, and ``syndex-submit``, which uploads one from the command line.

1. Check the file
=================

Every upload goes through the same automatic check. Run it yourself first, so you find a missing attribute in a second rather than after sending 30 GB:

.. code-block:: bash

    syndex-check my-grid.hdf5

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

- An **ERROR** means the file cannot be published as it stands. Fix it and run the check again.
- A **warning** is a convention the file breaks. It does not block the submission, but fix it if you can.
- ``ready to submit; a reviewer will categorise it`` means the file is not a grid, dust grid or instrument. That is expected for other data: there is nothing structural to check, so a reviewer decides what it is.

What causes each error and warning is listed under **Submitting one** on each type's page: :doc:`grids <../data/grids>`, :doc:`dust grids <../data/dust_grids>`, :doc:`instruments <../data/instruments>`. ``--json`` prints the report for a script to read, and several files can be checked at once; the exit status is ``0`` only if all of them pass.

2. Describe it
==============

On the `submit page <https://synthesizer-project.org/syndex/submit>`_ choose:

- **New dataset** for something not yet in the catalogue, or
- **New release** for a new version of an existing dataset. It keeps that dataset's name and description, and the old release stays downloadable.

The form asks for:

- **Data type**: one of the :doc:`catalogue types <../data/data>`, or *other* if none fits and a reviewer should decide.
- **Catalogue name**: lowercase letters, digits and hyphens. People download by it, so it cannot change later. See :doc:`../data/data` for the convention.
- **Display name** and **description**: what it is, and what it is not suitable for.
- **Citations**: the ADS bibcodes the data should be cited with, e.g. ``2017PASA...34...58E``.
- **Licence**, if the data has one.
- **Notes for the reviewer**: anything else they should know.

Axes, filters, model and code versions are read from the file, so you do not type them in.

3. Upload the file
==================

Saving the form opens the submission's page, which offers two ways to send the file. Both use the same upload, so choose by size and by where the file is.

.. list-table::
   :header-rows: 1
   :widths: 20 20 60

   * - Method
     - Largest file
     - Use it when
   * - Browser
     - 10 GB
     - The file is on the machine you are browsing from. Pick it on the submission's page. An interrupted browser upload starts again from the beginning.
   * - ``syndex-submit``
     - about 189 GB
     - The file is larger, or on a remote machine you reach over SSH, such as an HPC system.

For the command line, copy the upload token from the submission's page:

.. code-block:: bash

    syndex-submit 6630a2d3da236ed83f246c1040fdcd06 my-grid.hdf5

The first time, it prints a code to enter at `github.com/login/device <https://github.com/login/device>`_ from any device. It then keeps a session token for the portal in ``~/.config/syndex/``, and nothing else; signing out from your account page ends it.

The file is sent in 90 MiB pieces, and a piece that fails is retried, so a brief network drop does not stop the transfer. Add ``--check`` to run ``syndex-check`` first and stop if the file would be refused. All options are on :doc:`command_line`.

4. Review
=========

Once the file arrives:

1. The automatic check runs on the uploaded file, and the result appears on the submission's page. It also reports if identical bytes are already in the catalogue.
2. Reviewers are notified automatically. One looks at the submission and approves it or says why not.
3. If it is **approved**, a maintainer publishes it and it appears in the catalogue.
4. If it is **not accepted**, the reviewer's note says what to fix. Resubmit from `your submissions <https://synthesizer-project.org/syndex/submissions>`_, which fills in the form from the old one.

Limits
======

.. list-table::
   :widths: 60 40

   * - Largest file from a browser
     - 10 GB
   * - Largest file from ``syndex-submit``
     - about 189 GB
   * - Submissions one account may have waiting for review
     - 10
   * - Submissions waiting for review across everyone
     - 50

The waiting limits clear as submissions are reviewed. For anything that does not fit, `open an issue <https://github.com/synthesizer-project/synthesizer/issues>`_ and a maintainer will arrange another way.

.. toctree::
   :maxdepth: 1
   :hidden:

   command_line
