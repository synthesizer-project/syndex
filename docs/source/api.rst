Catalogue API
*************

Everything the portal shows is available as JSON from ``https://data.synthesizer-project.org``. It is read-only, needs no key, and allows requests from any origin.

.. list-table::
   :header-rows: 1
   :widths: 45 55

   * - Endpoint
     - Returns
   * - ``GET /v1/datasets``
     - The catalogue, paged and filterable
   * - ``GET /v1/datasets/{name}``
     - One dataset and its current release in full
   * - ``GET /v1/datasets/{name}/releases``
     - Every release of one dataset, newest first
   * - ``GET /v1/releases/{id}``
     - One release by id
   * - ``GET /v1/releases/{id}/download``
     - The file
   * - ``GET /v1/releases/{id}/citations.bib``
     - Its citations as BibTeX
   * - ``GET /v1/releases/{id}/preview.png``
     - Its preview plot

Errors come back as ``{"error": "explanation"}`` with a ``4xx`` or ``5xx`` status.

Listing datasets
================

``GET /v1/datasets`` returns datasets ordered by name, each with a summary of its current release and a ``download_url``.

.. list-table::
   :header-rows: 1
   :widths: 25 55 20

   * - Parameter
     - Meaning
     - Default
   * - ``data_type``
     - One type: ``grid``, ``dust_grid``, ``instrument``, …
     - all
   * - ``is_test``, ``is_ci``
     - ``true`` or ``false``
     - all
   * - ``has_spectra``, ``has_lines``
     - ``true`` or ``false``; grids only
     - all
   * - ``limit``
     - Page size, 1 to 1000
     - ``100``
   * - ``after``
     - The ``cursor`` from the previous page
     - start

.. code-block:: bash

    curl 'https://data.synthesizer-project.org/v1/datasets?data_type=dust_grid'

The response is ``{"datasets": [...], "cursor": ...}``. ``cursor`` is ``null`` on the last page.

One dataset
===========

``GET /v1/datasets/{name}`` returns the dataset and everything stored about its current release under ``current_release``:

- ``file``: filename, format, size and ``sha256``.
- ``grid`` (grids and dust grids): model, photoionisation code, spectra, line ids, wavelength range, and every axis with its full ``values``. Enough to plot or filter a grid without downloading it.
- ``instrument`` (instruments): type, filters, capabilities.
- ``citations``: in bibliography order, each with its bibcode, DOI and BibTeX.
- ``known_bug`` and ``known_bug_description``.

``GET /v1/datasets/{name}/releases`` lists every release, including superseded ones, each with ``is_current`` and a ``download_url``. Use it to pin a release deliberately.

Downloading
===========

``GET /v1/releases/{id}/download`` streams the file. The ``X-Syndex-SHA256`` header gives the expected digest, and ``HEAD`` returns the headers without the body, to check size and digest before downloading. ``Range`` requests are supported, so an interrupted download can be resumed.

In practice, ``synthesizer-download`` does all of this for you.
