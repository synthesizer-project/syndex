# Migration Notes

A record of what the Box migration found, kept because these are the details
that are impossible to reconstruct later. Every file listed here was examined
directly; nothing is inferred from a filename.

## Broken source files

These five files could not be migrated. The catalogue does not contain them,
and their entries were left pointing at Box rather than at a dataset. If they
matter scientifically they need regenerating and re-uploading; if they do not,
their entries can be deleted from `_data_ids.yml`.

| File | Section | Problem |
|---|---|---|
| `maraston05-rhb_bpl-0.1,100-2.35.hdf5` | ProductionGrids | Shared link returns an HTML error page with a **200** status, 21 KB. Anything trusting the status code writes that page to disk as a grid. |
| `maraston05-rhb_bpl-0.1,100-2.35_cloudy-c23.01-sps.hdf5` | ProductionGrids | Shared link returns **404**. |
| `maraston24-Tenc40_kroupa-0.1,100_cloudy-c23.01-sps.hdf5` | ProductionGrids | Shared link returns **404**. This is the only photoionised Maraston 2024 grid, so the family is incident-only in the catalogue. |
| `qsosed-isotropic.hdf5` | ProductionGrids | Shared link returns an HTML error page with a **200** status. |
| `fsps-3.2-mistmiles_bpl-0.08,0.5,1,120-1.3,2.3,1.6_cloudy-c23.01-sps.hdf5` | ProductionGrids | **Truncated at source.** Box holds and serves 266,338,304 bytes, and does so consistently across repeated attempts, but the file's own HDF5 superblock expects 390,514,104. Its siblings are all 390,514,104. |

That last one is the dangerous shape: the download completes, `curl` reports
success, the HDF5 signature is present, and only opening the file reveals the
problem. `synthesizer-download` now verifies the byte count against
`Content-Length` and opens each HDF5 file before publishing, so this fails
loudly rather than producing a grid that breaks later.

## Files that look broken but are not

- `qsosed-isotropic-limited_cloudy-c23.01-blr-limited.hdf5` (0.6 MB),
  `bpass-2.3-bin_bpl-0.1,1.0,300.0-1.3,2.35_cloudy-c23.01-sps.hdf5` (124 KB)
  and `fsps-3.2-mistmiles_chabrier03-2,120_cloudy-c23.01-sps.hdf5` (86 KB) sit
  beside siblings hundreds of times their size, but are valid HDF5 holding
  only specific ionising luminosities over their axes: no spectra, no lines.
  They are published, and `has_spectra` / `has_lines` make them findable as
  such: `GET /v1/datasets?has_spectra=false&has_lines=false`.
- Yggdrasil's `fcov_0.5` and `fcov_1` grids carry nebular emission without any
  `CloudyParams`, because Yggdrasil applies its own nebular treatment. They are
  `photoionised` with a null `photoionisation_code`, which is the honest
  description. Their own generator warns they are not self-consistent with
  Synthesizer's Cloudy processing; that warning is repeated in their
  descriptions.

## Upstream issues found in synthesizer-grids

- **DL07 dust emission grids bypass `GridFile`**
  (`incident/sps/../dust/create_dl07_grid.py`), so they carry no
  `Units`/`Description`/`log_on_read` on any dataset, no version or date
  stamps, and a `spec_names` attribute naming datasets that do not exist
  (`fsil_pdr`/`fsil_diffuse` versus the actual `pdr_fsil`/`diffuse_fsil`).
  Raised as [syncretize#144](https://github.com/synthesizer-project/syncretize/issues/144).
  The published copy was normalised by hand: wavelength units are Å,
  confirmed against the generator's own `lam * 1e4` conversion.
- **`SpectroscopicInstrument.to_hdf5` dropped NumPy scalar resolving powers.**
  `isinstance(x, (int, float))` excludes `np.float32` and `np.int64`, so a
  resolving power computed from an array was silently discarded and read back
  as `None`. Fixed in Synthesizer, covering `IntegratedFieldUnit` too through
  inheritance.

## Axis metadata defects, found and corrected

Querying every axis in the catalogue at once, which nothing had done before,
turned up defects that are invisible when files are inspected one at a time.
All three files were corrected and republished as new releases; the superseded
releases carry `known_bug` and a description, since they remain resolvable.

| Dataset | Defect | Correction |
|---|---|---|
| `maraston13-kroupa-0p1-100` | `axes/ages` had `Units = 'yr**2'`, which is dimensionally impossible. The axis's own `Description` read "(yr)", so the file contradicted itself. Values (10³–1.5×10¹⁰) were always years. | `Units = 'yr'`. Release 10 superseded by 242. |
| `maraston13-salpeter-0p1-100` | As above. | Release 11 superseded by 243. |
| `qsosed-cloudy-agn-test` | Five of six axes named in the singular (`mass`, `accretion_rate_eddington`, `cosine_inclination`, `ionisation_parameter`, `hydrogen_density`) where all thirteen sibling AGN grids use the plural. Code addressing axes by name would not find them. | Renamed to the plural forms `pluralize` produces, with the root `axes` and `incident_axes` attributes and the axis `Description`s updated to agree. Release 7 superseded by 244. |

Only metadata changed in all three: every dataset in every file was verified
byte-identical before and after, once the renames are accounted for.

The plural form is correct because Synthesizer draws the distinction
explicitly: `synthesizer.utils.util_funcs.pluralize` and `depluralize` exist to
map between plural **grid axis** names and singular **per-object component**
attributes. The singular names in `blackhole.py` are component attributes and
are unrelated to this.

`syndicate-upload` now warns at publish time on singular axis names and on
units that do not match the expected dimension for a known axis, so neither
defect can be reintroduced silently. Re-running those rules over every current
release reports zero problems across all nineteen distinct name/unit pairs.

### Deliberately left alone

- **`alpha` on `draine-li-dust-emission-mw-3p1`** is *not* a misspelling of
  `alpha_enhancement`. In the DL07 model it is the power-law index of the
  starlight intensity distribution (dU ∝ U^−α), and its range of 1–3 matches.
  Merging the two facets on name similarity would conflate unrelated physical
  quantities, which is why the publish-time check uses an explicit list rather
  than fuzzy matching.
- **`masses` carries three unit spellings** for the same quantity
  (`1.98841586e+30*kg`, the same number written out in full, and plain `kg`).
  All are physically correct, so nothing was rewritten, but any mass range
  filter has to normalise before comparing.

## Naming observations

- Several relagn files were **renamed on Box** during the project's life:
  `relagn_incident_fixed_rad_efficiency_0p1_*` became
  `relagn_fixed_rad_efficiency_0.1_*`. The old shared links still resolve, so
  the migration succeeded, but `_data_ids.yml` keys and Box names disagree for
  those entries.
- `qsosed-test_cloudy-c23.01-agn-test.hdf5` exists in both `TestData` and
  `ProductionGrids` with **different content and different digests**. They are
  two datasets, and matching Box files to datasets by filename alone is
  therefore ambiguous for this one pair.
- Maraston 2024 filenames spell the same variant two ways (`Tenc00` and
  `Tenc_0.00`). Dataset names were derived from the variant recorded inside
  each file rather than its filename, so the catalogue is consistent where the
  filenames are not.

## Files that exist only in the catalogue

The two FSPS 4.0 variable-IMF grids were never on Box; they were published
from a local copy. Their `_data_ids.yml` entries carry a `dataset` key with no
`direct_link`, and R2 is the only copy in existence, which is worth knowing
before anyone treats R2 as a cache rather than a store.
