import pytest

from configs.middleware.storage.opendal_storage_config import OpenDALScheme
from extensions.storage.opendal_storage import OpenDALStorage
from tests.unit_tests.oss.__mock.base import (
    BaseStorageTest,
    get_example_folder,
)
from tests.unit_tests.oss.__mock.local import setup_local_fs_mock


class TestOpenDAL(BaseStorageTest):
    @pytest.fixture(autouse=True)
    def setup_method(self, *args, **kwargs):
        """Executed before each test method."""
        self.storage = OpenDALStorage(
            scheme=OpenDALScheme.FS,
            root=get_example_folder(),
        )
