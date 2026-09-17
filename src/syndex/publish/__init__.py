"""Publishing a file to the catalogue.

Publication is four steps in a fixed order, and each is a module here: read
what the file is and what it is called (`sources`, `plan`), resolve what it
should cite (`citations`), put the bytes in R2 (`storage`), then record it in
D1 (`registry`). `cli` is the command that runs them, and `serialise` is how
all of them write JSON.

The order is not arbitrary. Bytes go up before any row is written, so a
failure half way leaves an object nobody references rather than a catalogue
entry pointing at nothing -- the first is invisible and cheap, the second is a
broken download.
"""
