Checking a file
***************

``syndex-check`` runs the same checks the portal runs on every upload. Running it first means finding a missing attribute in a second, rather than after sending 30 GB.

.. code-block:: bash

    syndex-check my-grid.hdf5

It prints what the file is, what was read from it, and a verdict:

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

Reading the result
==================

- An **ERROR** means the file cannot be published as it stands. Fix it and run the check again.
- A **warning** is a convention the file breaks. It does not block the submission, but is worth fixing if you can.
- ``ready to submit; a reviewer will categorise it`` means the file is not a grid, dust grid or instrument. That is expected for other data: there is nothing structural to check, so a person decides what it is.

What produces each error and warning is listed under **Submitting one** on each type's page: :doc:`grids <../data/grids>`, :doc:`dust grids <../data/dust_grids>`, :doc:`instruments <../data/instruments>`.

Options
=======

- ``--json`` prints the report as JSON.
- ``--classify-only`` says what each file is, without a verdict.
- Several files can be checked at once. The exit status is ``0`` only if every one could be published.

Full options are on :doc:`command_line`.
