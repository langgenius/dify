from collections.abc import Generator
from pathlib import Path

import pytest

from extensions.storage.opendal_storage import OpenDALStorage
from tests.helpers.unit.oss.__mock.base import (
    get_example_data,
    get_example_filename,
    get_opendal_bucket,
)

"""Unit coverage for OpenDAL filesystem root selection."""


class TestOpenDALFsDefaultRoot:
    """Test that OpenDALStorage with scheme='fs' works correctly when no root is provided."""

    def test_fs_without_root_uses_default(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """When no root is specified, the default 'storage' should be used and passed to the Operator."""
        # Change to tmp_path so the default "storage" dir is created there
        monkeypatch.chdir(tmp_path)
        # Ensure no OPENDAL_FS_ROOT env var is set
        monkeypatch.delenv("OPENDAL_FS_ROOT", raising=False)

        storage = OpenDALStorage(scheme="fs")

        # The default directory should have been created
        assert (tmp_path / "storage").is_dir()
        # The storage should be functional
        storage.save("test_default_root.txt", b"hello")
        assert storage.exists("test_default_root.txt")
        assert storage.load_once("test_default_root.txt") == b"hello"

        # Cleanup
        storage.delete("test_default_root.txt")

    def test_fs_with_explicit_root(self, tmp_path: Path) -> None:
        """When root is explicitly provided, it should be used."""
        custom_root = str(tmp_path / "custom_storage")
        storage = OpenDALStorage(scheme="fs", root=custom_root)

        assert Path(custom_root).is_dir()
        storage.save("test_explicit_root.txt", b"world")
        assert storage.exists("test_explicit_root.txt")
        assert storage.load_once("test_explicit_root.txt") == b"world"

        # Cleanup
        storage.delete("test_explicit_root.txt")

    def test_fs_with_env_var_root(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """When OPENDAL_FS_ROOT env var is set, it should be picked up via _get_opendal_kwargs."""
        env_root = str(tmp_path / "env_storage")
        monkeypatch.setenv("OPENDAL_FS_ROOT", env_root)
        # Ensure .env file doesn't interfere
        monkeypatch.chdir(tmp_path)

        storage = OpenDALStorage(scheme="fs")

        assert Path(env_root).is_dir()
        storage.save("test_env_root.txt", b"env_data")
        assert storage.exists("test_env_root.txt")
        assert storage.load_once("test_env_root.txt") == b"env_data"

        # Cleanup
        storage.delete("test_env_root.txt")


class TestOpenDAL:
    @pytest.fixture(autouse=True)
    def setup_method(self) -> None:
        """Executed before each test method."""
        self.storage = OpenDALStorage(
            scheme="fs",
            root=get_opendal_bucket(),
        )

    @pytest.fixture(scope="class", autouse=True)
    def teardown_class(self) -> Generator[None]:
        """Clean up after all tests in the class."""

        yield

        folder = Path(get_opendal_bucket())
        if folder.exists() and folder.is_dir():
            import shutil

            shutil.rmtree(folder, ignore_errors=True)

    def test_save_and_exists(self) -> None:
        """Test saving data and checking existence."""
        filename = get_example_filename()
        data = get_example_data()

        assert not self.storage.exists(filename)
        self.storage.save(filename, data)
        assert self.storage.exists(filename)

    def test_load_once(self) -> None:
        """Test loading data once."""
        filename = get_example_filename()
        data = get_example_data()

        self.storage.save(filename, data)
        loaded_data = self.storage.load_once(filename)
        assert loaded_data == data

    def test_load_stream(self) -> None:
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

    def test_download(self) -> None:
        """Test downloading data to a file."""
        filename = get_example_filename()
        filepath = str(Path(get_opendal_bucket()) / filename)
        data = get_example_data()

        self.storage.save(filename, data)
        self.storage.download(filename, filepath)

    def test_delete(self) -> None:
        """Test deleting a file."""
        filename = get_example_filename()
        data = get_example_data()

        self.storage.save(filename, data)
        assert self.storage.exists(filename)

        self.storage.delete(filename)
        assert not self.storage.exists(filename)
