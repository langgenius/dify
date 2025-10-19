from collections.abc import Generator
from pathlib import Path

import pytest

from extensions.storage.opendal_storage import OpenDALStorage
from tests.unit_tests.oss.__mock.base import (
    get_example_data,
    get_example_filename,
    get_opendal_bucket,
)


class TestOpenDAL:
    @pytest.fixture(autouse=True)
    def setup_method(self, *args, **kwargs):
        """Executed before each test method."""
        self.storage = OpenDALStorage(
            scheme="fs",
            root=get_opendal_bucket(),
        )

    @pytest.fixture(scope="class", autouse=True)
    def teardown_class(self, request):
        """Clean up after all tests in the class."""

        def cleanup():
            folder = Path(get_opendal_bucket())
            if folder.exists() and folder.is_dir():
                for item in folder.iterdir():
                    if item.is_file():
                        item.unlink()
                    elif item.is_dir():
                        item.rmdir()
                folder.rmdir()

        return cleanup()

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
        chunks = 5
        chunk_size = 4096
        data = get_example_data(length=chunk_size * chunks)

        self.storage.save(filename, data)
        generator = self.storage.load_stream(filename)
        assert isinstance(generator, Generator)
        for i in range(chunks):
            fetched = next(generator)
            assert len(fetched) == chunk_size
            assert fetched == data[i * chunk_size : (i + 1) * chunk_size]
        with pytest.raises(StopIteration):
            next(generator)

    def test_download(self):
        """Test downloading data to a file."""
        filename = get_example_filename()
        filepath = str(Path(get_opendal_bucket()) / filename)
        data = get_example_data()

        self.storage.save(filename, data)
        self.storage.download(filename, filepath)

    def test_delete(self):
        """Test deleting a file."""
        filename = get_example_filename()
        data = get_example_data()

        self.storage.save(filename, data)
        assert self.storage.exists(filename)

        self.storage.delete(filename)
        assert not self.storage.exists(filename)
