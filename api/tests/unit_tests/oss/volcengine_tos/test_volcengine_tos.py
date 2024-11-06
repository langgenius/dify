import pytest
from tos import TosClientV2

from extensions.storage.volcengine_tos_storage import VolcengineTosStorage
from tests.unit_tests.oss.__mock.base import (
    BaseStorageTest,
    get_example_bucket,
)
from tests.unit_tests.oss.__mock.volcengine_tos import setup_volcengine_tos_mock


class TestVolcengineTos(BaseStorageTest):
    @pytest.fixture(autouse=True)
    def setup_method(self, setup_volcengine_tos_mock):
        """Executed before each test method."""
        self.storage = VolcengineTosStorage()
        self.storage.bucket_name = get_example_bucket()
        self.storage.client = TosClientV2(
            ak="dify",
            sk="dify",
            endpoint="https://xxx.volces.com",
            region="cn-beijing",
        )
