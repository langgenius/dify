import os
from collections.abc import Generator
from pathlib import Path

import pytest

from configs.middleware.storage.opendal_storage_config import OpenDALScheme
from extensions.storage.opendal_storage import OpenDALStorage
from tests.unit_tests.oss.__mock.base import (
    get_example_data,
    get_example_filename,
    get_example_filepath,
    get_example_folder,
)


class TestOpenDAL:
    @pytest.fixture(autouse=True)
    def setup_method(self, *args, **kwargs):
        """Executed before each test method."""
        self.storage = OpenDALStorage(
            scheme=OpenDALScheme.FS,
            root=get_example_folder(),
        )

    def teardown_method(self, method):
        """Clean up after each test method."""
        try:
            if self.storage.exists(get_example_filename()):
                self.storage.delete(get_example_filename())

            filepath = Path(get_example_filepath())
            if filepath.exists():
                filepath.unlink()
        except:
            pass

    def test_save_and_exists(self):
        """Test saving data and checking existence."""
        filename = get_example_filename()
        data = get_example_data()

        assert not self.storage.exists(filename)
        self.storage.save(filename, data)
        assert self.storage.exists(filename)

    def test_load_once(self):
        """Test loading data once."""
        filename = get_example_filename()
        data = get_example_data()

        self.storage.save(filename, data)
        loaded_data = self.storage.load_once(filename)
        assert loaded_data == data

    def test_load_stream(self):
        """Test loading data as a stream."""
        filename = get_example_filename()
        data = get_example_data()

        self.storage.save(filename, data)
        generator = self.storage.load_stream(filename)
        assert isinstance(generator, Generator)
        assert next(generator) == data

    def test_download(self):
        """Test downloading data to a file."""
        filename = get_example_filename()
        filepath = get_example_filepath()
        data = get_example_data()

        self.storage.save(filename, data)
        self.storage.download(filename, filepath)

        downloaded_path = Path(filepath)
        assert downloaded_path.exists()
        downloaded_data = downloaded_path.read_bytes()
        assert downloaded_data == data

    def test_delete(self):
        """Test deleting a file."""
        filename = get_example_filename()
        data = get_example_data()

        self.storage.save(filename, data)
        assert self.storage.exists(filename)

        self.storage.delete(filename)
        assert not self.storage.exists(filename)
