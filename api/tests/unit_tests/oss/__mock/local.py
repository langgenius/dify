import os
import shutil
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

import pytest
from _pytest.monkeypatch import MonkeyPatch

from tests.unit_tests.oss.__mock.base import (
    get_example_data,
    get_example_filename,
    get_example_filepath,
    get_example_folder,
)


class MockLocalFSClass:
    def write_bytes(self, data):
        assert data == get_example_data()

    def read_bytes(self):
        return get_example_data()

    @staticmethod
    def copyfile(src, dst):
        assert src == os.path.join(get_example_folder(), get_example_filename())
        assert dst == get_example_filepath()

    @staticmethod
    def exists(path):
        assert path == os.path.join(get_example_folder(), get_example_filename())
        return True

    @staticmethod
    def remove(path):
        assert path == os.path.join(get_example_folder(), get_example_filename())


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_local_fs_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(Path, "write_bytes", MockLocalFSClass.write_bytes)
        monkeypatch.setattr(Path, "read_bytes", MockLocalFSClass.read_bytes)
        monkeypatch.setattr(shutil, "copyfile", MockLocalFSClass.copyfile)
        monkeypatch.setattr(os.path, "exists", MockLocalFSClass.exists)
        monkeypatch.setattr(os, "remove", MockLocalFSClass.remove)

        os.makedirs = MagicMock()

        with patch("builtins.open", mock_open(read_data=get_example_data())):
            yield

    if MOCK:
        monkeypatch.undo()
