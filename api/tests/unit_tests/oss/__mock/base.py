from collections.abc import Generator

import pytest

from extensions.storage.base_storage import BaseStorage


def get_example_folder() -> str:
    return "/dify"


def get_example_bucket() -> str:
    return "dify"


def get_example_filename() -> str:
    return "test.txt"


def get_example_data() -> bytes:
    return b"test"


def get_example_filepath() -> str:
    return "/test"


class BaseStorageTest:
    @pytest.fixture(autouse=True)
    def setup_method(self):
        """Should be implemented in child classes to setup specific storage."""
        self.storage = BaseStorage()

    def test_save(self):
        """Test saving data."""
        self.storage.save(get_example_filename(), get_example_data())

    def test_load_once(self):
        """Test loading data once."""
        assert self.storage.load_once(get_example_filename()) == get_example_data()

    def test_load_stream(self):
        """Test loading data as a stream."""
        generator = self.storage.load_stream(get_example_filename())
        assert isinstance(generator, Generator)
        assert next(generator) == get_example_data()

    def test_download(self):
        """Test downloading data."""
        self.storage.download(get_example_filename(), get_example_filepath())

    def test_exists(self):
        """Test checking if a file exists."""
        assert self.storage.exists(get_example_filename())

    def test_delete(self):
        """Test deleting a file."""
        self.storage.delete(get_example_filename())
