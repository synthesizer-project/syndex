Contributing data
*****************

Made a grid, saved an instrument, or have data Synthesizer could use? You can add it to the catalogue through the `portal <https://synthesizer-project.org/syndex/submit>`_. It takes four steps:

1. **Check** your file with ``syndex-check``, and fix anything it finds.
2. **Describe** the dataset on the portal.
3. **Upload** the file, from your browser or the command line.
4. **Review**: a reviewer looks it over, and a maintainer publishes it.

Before you start
================

You need permission to submit. Sign in to the portal with GitHub and `request access <https://synthesizer-project.org/syndex/access>`_, saying in a sentence or two what the data is, roughly how big it is and how it was made. A maintainer will get back to you through GitHub.

You also need the Syndex tools. They run on Python 3.10 or later and depend only on ``h5py`` and ``numpy``:

.. code-block:: bash

    pip install cosmos-syndex

This installs two commands: ``syndex-check`` to check a file, and ``syndex-submit`` to upload one from the command line.

1. Check your file
==================

Every upload is checked automatically. ``syndex-check`` runs exactly the same checks on your own machine, so you can find a missing attribute in seconds rather than after uploading 30 GB:

.. code-block:: bash

    syndex-check my-grid.hdf5

It tells you what it thinks the file is, what it read from it, and anything wrong, then gives a verdict on the last line:

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

``ready to submit``
   Nothing stops the file being published. Any warnings above are worth fixing, but are not required.
``ready to submit; a reviewer will categorise it``
   The file is not a grid, dust grid or instrument, so there was nothing to check. That is normal for other kinds of data.
``not ready``
   Fix the lines marked ``ERROR``, then check again.

Each kind of data has its own page explaining every error and warning and how to fix it: :doc:`grids <../data/grids>`, :doc:`dust grids <../data/dust_grids>` and :doc:`instruments <../data/instruments>`.

.. tip::

   You can check several files at once; the command exits with ``0`` only if all of them pass. Add ``--json`` for a report a script can read.

2. Describe the dataset
=======================

On the `submit page <https://synthesizer-project.org/syndex/submit>`_, choose **New dataset** if it is not in the catalogue yet, or **New release** if it is a new version of one that is. A new release keeps its dataset's name and description, and the earlier releases stay available.

The form asks for:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Field
     - What to enter
   * - Data type
     - Which :doc:`kind of data <../data/data>` it is. Choose *other* if none fits, and a reviewer will decide.
   * - Catalogue name
     - The name people will download it by, following the :doc:`naming conventions <../data/data>`. Choose carefully: it cannot be changed later.
   * - Display name
     - A readable title for the portal.
   * - Description
     - What the data is, and what it should not be used for.
   * - Citations
     - The ADS bibcodes people should cite when they use it, such as ``2017PASA...34...58E``.
   * - Licence
     - Its licence, if it has one.
   * - Notes for the reviewer
     - Anything else they should know.

You do not need to enter axes, filters or version numbers. Those are read from the file.

3. Upload the file
==================

Saving the form takes you to the submission's page, where you can upload the file in either of two ways. Both end up in the same place.

.. tab-set::

   .. tab-item:: From your browser

      Choose the file on the submission's page.

      This suits files up to **10 GB** that are on the computer you are using. If the upload is interrupted, it has to start again from the beginning.

   .. tab-item:: From the command line

      Copy the upload token from the submission's page, and run:

      .. code-block:: bash

          syndex-submit 6630a2d3da236ed83f246c1040fdcd06 my-grid.hdf5

      This suits files up to about **189 GB**, and files on a remote machine you reach over SSH, such as an HPC system.

      The first time, it asks you to sign in by entering a code at `github.com/login/device <https://github.com/login/device>`_ on any device. It keeps that session in ``~/.config/syndex/`` and nothing else, and signing out from your account page ends it.

      The file goes up in 90 MiB pieces, and any piece that fails is retried. If the upload stops altogether, run the same command again and it will send only the pieces still missing. It starts over instead if the file has changed, or if someone has restarted the upload from the browser.

      Add ``--check`` to run ``syndex-check`` first and stop if the file would be refused. Every option is listed under :doc:`command_line`.

4. Review
=========

When the upload finishes, the file is checked again and the report appears on the submission's page, along with a note if the catalogue already holds an identical file. Reviewers are notified at the same time.

If the reviewer approves it, a maintainer publishes it and it appears in the catalogue. If not, they will say what needs changing; fix it and submit again from `your submissions <https://synthesizer-project.org/syndex/submissions>`_, where the form is filled in from your earlier attempt.

.. note::

   You can have up to 10 submissions waiting for review at once, and the queue as a whole holds up to 50. Both free up as submissions are reviewed. If your data does not fit these limits or the upload sizes above, `open an issue <https://github.com/synthesizer-project/synthesizer/issues>`_ and a maintainer will find another way.

.. toctree::
   :maxdepth: 1
   :hidden:

   command_line
