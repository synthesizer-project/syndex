Catalogue API
*************

Everything the portal shows is also available as JSON from ``https://data.synthesizer-project.org``, for scripts and tools that want to search the catalogue or fetch files themselves. The API is read-only, needs no key, and can be called from any website.

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

If something goes wrong, the response has a ``4xx`` or ``5xx`` status and a body of ``{"error": "explanation"}``.

Listing datasets
================

``GET /v1/datasets`` returns datasets in name order, each with a summary of its current release and a ``download_url``. These parameters narrow it down:

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

Results come a page at a time, as ``{"datasets": [...], "cursor": ...}``. Pass ``cursor`` back as ``after`` to get the next page; it is ``null`` on the last one. In Python, using only the standard library:

.. code-block:: python

    import json
    from urllib.parse import urlencode
    from urllib.request import urlopen

    API = "https://data.synthesizer-project.org/v1/datasets"
    params = {"data_type": "grid", "has_lines": "true", "limit": 1000}
    datasets = []
    while True:
        with urlopen(f"{API}?{urlencode(params)}") as response:
            page = json.load(response)
        datasets += page["datasets"]
        if page["cursor"] is None:
            break
        params["after"] = page["cursor"]

    print([dataset["name"] for dataset in datasets])

One dataset
===========

``GET /v1/datasets/{name}`` returns the dataset, and everything stored about its current release under ``current_release``:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Field
     - Holds
   * - ``file``
     - The filename, format, size and ``sha256``.
   * - ``grid``
     - For grids and dust grids: the model, photoionisation code, spectra, line ids, wavelength range, and every axis with its full ``values``. Enough to plot or filter a grid without downloading it.
   * - ``instrument``
     - For instruments: the type, filters and capabilities.
   * - ``citations``
     - In bibliography order, each with its bibcode, DOI and BibTeX.
   * - ``known_bug``, ``known_bug_description``
     - Whether a defect has been found in the release, and what it is.

Releases
========

``GET /v1/datasets/{name}/releases`` lists every release of a dataset, newest first and including superseded ones, each with ``is_current`` and a ``download_url``. Use it to choose a release to pin.

``GET /v1/releases/{id}`` returns one release in the same form as ``current_release``, plus its ``dataset`` and ``is_current``.

Downloading
===========

``GET /v1/releases/{id}/download`` streams the file. ``synthesizer-download`` handles all of this for you, but if you write your own client, three things help:

``X-Syndex-SHA256`` header
   The file's expected digest, to verify the download.
``HEAD`` requests
   The headers without the file, to check its size and digest before downloading.
``Range`` requests
   Part of the file, to resume an interrupted download.
