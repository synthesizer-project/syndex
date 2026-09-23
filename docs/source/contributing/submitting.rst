Sending a file
**************

Once a submission is described, its page offers two ways to send the file. Both use the same upload, so choose whichever is nearer the file.

From the browser
================

Pick the file on the submission's page. This handles files up to 10 GB.

From the command line
=====================

For anything larger, or a file on a machine you reach over SSH, use ``syndex-submit`` with the upload token shown on the submission's page:

.. code-block:: bash

    syndex-submit 6630a2d3da236ed83f246c1040fdcd06 my-grid.hdf5

The first time, it prints a code to enter at `github.com/login/device <https://github.com/login/device>`_ from any device. It then keeps a session on that machine (no password or key), which signing out from your account page ends.

The file is sent in 90 MiB pieces, up to about 189 GB in total. A piece that fails is retried, so a dropped connection costs one piece rather than the whole transfer.

Add ``--check`` to run ``syndex-check`` first and stop if the file would be refused.

Full options are on :doc:`command_line`.
