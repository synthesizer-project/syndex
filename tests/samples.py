"""HDF5 files to test against, and a database with the schema in it.

Written by hand rather than fetched, so the tests say in one place what a
grid, a dust grid and an instrument are expected to look like -- and so a
change to those expectations shows up as a change to this file.
"""

import sqlite3
from pathlib import Path

import h5py
import numpy as np


def migrated_database() -> sqlite3.Connection:
    """Open an in-memory database with every migration applied in order."""
    migrations = sorted((Path(__file__).parents[1] / "migrations").glob("*.sql"))
    database = sqlite3.connect(":memory:")
    for migration in migrations:
        database.executescript(migration.read_text())
    return database


def make_grid(path: Path) -> None:
    """The smallest thing the tools will call a grid: two axes and spectra."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["age", "metallicity"]
        hdf.attrs["date_created"] = "2026-01-01"
        axes = hdf.create_group("axes")
        age = axes.create_dataset("age", data=[1.0, 10.0])
        age.attrs["Units"] = "yr"
        age.attrs["log_on_read"] = True
        metallicity = axes.create_dataset("metallicity", data=[0.01, 0.02])
        metallicity.attrs["Units"] = "dimensionless"
        spectra = hdf.create_group("spectra")
        wavelength = spectra.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        spectra.create_dataset("incident", data=np.ones((2, 2, 2)))
        model = hdf.create_group("Model")
        model.attrs["name"] = "test-model"


def make_dust_extinction_grid(path: Path) -> None:
    """A dust grid, which carries extinction curves where a grid has spectra."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["dtg"]
        axes = hdf.create_group("axes")
        dtg = axes.create_dataset("dtg", data=[1e-3, 1e-2])
        dtg.attrs["Units"] = "dimensionless"
        extinction = hdf.create_group("extinction_curves")
        wavelength = extinction.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        extinction.create_dataset("silicate", data=np.ones(2))


def make_photometric_imager(path: Path) -> None:
    """An instrument with filters and nothing else, as the oldest caches are."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestImager"
        filters = hdf.create_group("Filters")
        header = filters.create_group("Header")
        header.attrs["filter_codes"] = ["Test/A", "Test/B"]
        header.attrs["Wavelength_units"] = "angstrom"
        header.create_dataset("Wavelengths", data=[1000.0, 2000.0, 3000.0])
        resolution = hdf.create_dataset("Resolution", data=0.1)
        resolution.attrs["units"] = "arcsec"


def make_instrument_collection(path: Path) -> None:
    """Two instruments in one file, which is how a survey's cache is written."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestCollection"
        for name in ("A", "B"):
            member = hdf.create_group(name)
            member.attrs["label"] = name
            wavelength = member.create_dataset("Wavelength", data=[1000.0, 2000.0])
            wavelength.attrs["units"] = "angstrom"


def make_photometric_imager_full(path: Path) -> None:
    """An imager carrying everything one can: depths, PSFs and noise maps."""
    """Build the real generic to_hdf5 layout with Depth/SNRs/PSFs/noise.

    Filter codes deliberately contain "/" (the real Synthesizer convention,
    e.g. "Test/A") so tests exercise h5py's implicit path-splitting nesting.
    """
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestImagerFull"
        hdf.attrs["instrument_type"] = "photometric_imager"
        filters = hdf.create_group("Filters")
        header = filters.create_group("Header")
        header.attrs["filter_codes"] = ["Test/A", "Test/B"]
        header.attrs["Wavelength_units"] = "angstrom"
        header.create_dataset("Wavelengths", data=[1000.0, 2000.0, 3000.0])
        resolution = hdf.create_dataset("Resolution", data=0.1)
        resolution.attrs["units"] = "arcsec"

        depth_group = hdf.create_group("Depth")
        for code, value in (("Test/A", 28.0), ("Test/B", 29.0)):
            ds = depth_group.create_dataset(code, data=value)
            ds.attrs["units"] = "AB_mag"

        snrs = hdf.create_dataset("SNRs", data=10.0)
        snrs.attrs["units"] = "dimensionless"

        psfs_group = hdf.create_group("PSFs")
        for code in ("Test/A", "Test/B"):
            ds = psfs_group.create_dataset(code, data=np.ones((4, 4)))
            ds.attrs["units"] = "dimensionless"

        resample = hdf.create_dataset("PSFResampleFactor", data=2)
        resample.attrs["units"] = "dimensionless"

        noise_group = hdf.create_group("NoiseMaps")
        for code in ("Test/A", "Test/B"):
            ds = noise_group.create_dataset(code, data=np.ones((4, 4)))
            ds.attrs["units"] = "nJy"


def make_spectroscopic_full(path: Path) -> None:
    """A spectrograph, whose resolution is a resolving power rather than a
    wavelength."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestSpectrograph"
        hdf.attrs["instrument_type"] = "spectroscopic"
        hdf.attrs["resolving_power"] = 1000.0
        wavelength = hdf.create_dataset("Wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["units"] = "angstrom"
        depth = hdf.create_dataset("Depth", data=25.0)
        depth.attrs["units"] = "AB_mag"
        snrs = hdf.create_dataset("SNRs", data=5.0)
        snrs.attrs["units"] = "dimensionless"


def make_ifu_full(path: Path) -> None:
    """An IFU: a spectrograph that also has a spatial resolution."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestIFU"
        hdf.attrs["instrument_type"] = "ifu"
        hdf.attrs["resolving_power"] = 500.0
        wavelength = hdf.create_dataset("Wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["units"] = "angstrom"
        resolution = hdf.create_dataset("Resolution", data=0.05)
        resolution.attrs["units"] = "arcsec"
        psfs = hdf.create_dataset("PSFs", data=np.ones((4, 4, 2)))
        psfs.attrs["units"] = "dimensionless"


def make_real_collection(path: Path) -> None:
    """A collection laid out the way the real caches are, with a Header group."""
    """Build the real InstrumentCollection.write_instruments layout."""
    with h5py.File(path, "w") as hdf:
        head = hdf.create_group("Header")
        head.attrs["synthesizer_version"] = "0.0.0"
        head.attrs["ninstruments"] = 2

        imager = hdf.create_group("TestImagerFull")
        imager.attrs["label"] = "TestImagerFull"
        imager.attrs["instrument_type"] = "photometric_imager"
        filters = imager.create_group("Filters")
        header = filters.create_group("Header")
        header.attrs["filter_codes"] = ["Test/A"]
        header.attrs["Wavelength_units"] = "angstrom"
        header.create_dataset("Wavelengths", data=[1000.0, 2000.0])
        resolution = imager.create_dataset("Resolution", data=0.1)
        resolution.attrs["units"] = "arcsec"

        spec = hdf.create_group("TestSpectrograph")
        spec.attrs["label"] = "TestSpectrograph"
        spec.attrs["instrument_type"] = "spectroscopic"
        wavelength = spec.create_dataset("Wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["units"] = "angstrom"


def make_sps_grid(path: Path, photoionised: bool = False) -> None:
    """An SPS grid, optionally photoionised, which is what most of the
    catalogue is."""
    """Write a grid shaped the way Syncretize writes stellar population grids."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["ages", "metallicities"]
        axes = hdf.create_group("axes")
        ages = axes.create_dataset("ages", data=[1e6, 1e7])
        ages.attrs["Units"] = "yr"
        axes.create_dataset("metallicities", data=[0.01, 0.02])
        spectra = hdf.create_group("spectra")
        wavelength = spectra.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        spectra.create_dataset("incident", data=np.ones((2, 2, 2)))
        model = hdf.create_group("Model")
        model.attrs["sps_name"] = "maraston13"
        model.attrs["sps_version"] = "2013"
        model.attrs["imf_type"] = "kroupa"
        if photoionised:
            spectra.create_dataset("nebular", data=np.ones((2, 2, 2)))
            cloudy = hdf.create_group("CloudyParams")
            cloudy.attrs["cloudy_version"] = "c23.01"


def make_agn_grid(path: Path) -> None:
    """An AGN grid, which is told apart from an SPS one by its model group."""
    """Write a grid shaped the way Syncretize writes AGN grids."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["mass"]
        axes = hdf.create_group("axes")
        axes.create_dataset("mass", data=[1e8, 1e9])
        spectra = hdf.create_group("spectra")
        wavelength = spectra.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        spectra.create_dataset("incident", data=np.ones((2, 2)))
        model = hdf.create_group("Model")
        model.attrs["type"] = "agn"
        model.attrs["family"] = "qsosed"
        cloudy = hdf.create_group("CloudyParams")
        cloudy.attrs["cloudy_version"] = "c23.01"
