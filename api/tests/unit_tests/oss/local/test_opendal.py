from collections.abc import Generator

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
        self.storage = OpenDALStorage(
            scheme="fs",
            root_path=get_example_folder(),
        )
