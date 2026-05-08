from pathlib import Path

import pytest

from extensions.storage.opendal_storage import OpenDALStorage


class TestOpenDALFsDefaultRoot:
    """Test that OpenDALStorage with scheme='fs' works correctly when no root is provided."""

    def test_fs_without_root_uses_default(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
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

    def test_fs_with_explicit_root(self, tmp_path: Path):
        """When root is explicitly provided, it should be used."""
        custom_root = str(tmp_path / "custom_storage")
        storage = OpenDALStorage(scheme="fs", root=custom_root)

        assert Path(custom_root).is_dir()
        storage.save("test_explicit_root.txt", b"world")
        assert storage.exists("test_explicit_root.txt")
        assert storage.load_once("test_explicit_root.txt") == b"world"

        # Cleanup
        storage.delete("test_explicit_root.txt")

    def test_fs_with_env_var_root(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
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
