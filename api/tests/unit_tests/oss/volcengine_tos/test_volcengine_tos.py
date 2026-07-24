from unittest.mock import patch

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
        with patch("extensions.storage.volcengine_tos_storage.dify_config") as mock_config:
            mock_config.VOLCENGINE_TOS_ACCESS_KEY = "test_access_key"
            mock_config.VOLCENGINE_TOS_SECRET_KEY = "test_secret_key"
            mock_config.VOLCENGINE_TOS_ENDPOINT = "test_endpoint"
            mock_config.VOLCENGINE_TOS_REGION = "test_region"
            self.storage = VolcengineTosStorage()

        self.storage.bucket_name = get_example_bucket()
        self.storage.client = TosClientV2(
            ak="dify",
            sk="dify",
            endpoint="https://xxx.volces.com",
            region="cn-beijing",
        )
