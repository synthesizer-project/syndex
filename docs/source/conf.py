"""Configuration file for the Sphinx documentation builder.

Follows Synthesizer's docs so the two read as one project, without the
notebook, gallery and API machinery: Syndex's user-facing surface is two
commands and a catalogue, not a library.
"""

from datetime import datetime, timezone

from syndex import __version__

project = "syndex"
copyright = f"{datetime.now(timezone.utc).year}, the Synthesizer team"
author = "the Synthesizer team"
release = __version__

extensions = [
    "sphinxarg.ext",  # Render the commands' options from their parsers
    "sphinx_copybutton",  # Add a copy button to code blocks
]

master_doc = "index"
html_show_sourcelink = False
html_copy_source = False

html_theme = "furo"
html_theme_options = {
    "sidebar_hide_name": True,
}
html_title = "Syndex"
html_logo = "../../src/portal/static/syndex_logo_2.png"
html_favicon = "../../src/portal/static/syndex_logo_2.png"
