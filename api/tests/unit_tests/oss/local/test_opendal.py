from collections.abc import Generator
from pathlib import Path

import pytest

from extensions.storage.opendal_storage import OpenDALStorage
from tests.unit_tests.oss.__mock.base import (
    BaseStorageTest,
    get_example_folder,
)
from tests.unit_tests.oss.__mock.local import setup_local_fs_mock


class TestLocalFS(BaseStorageTest):
    @pytest.fixture(autouse=True)
    def setup_method(self, setup_local_fs_mock):
        """Executed before each test method."""
        Path(get_example_folder()).mkdir(parents=True, exist_ok=True)
        self.storage = OpenDALStorage(
            scheme="fs",
            root_path=get_example_folder(),
        )
