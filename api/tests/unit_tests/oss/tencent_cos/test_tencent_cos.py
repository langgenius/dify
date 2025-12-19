from unittest.mock import patch

import pytest
from qcloud_cos import CosConfig

from extensions.storage.tencent_cos_storage import TencentCosStorage
from tests.unit_tests.oss.__mock.base import (
    BaseStorageTest,
    get_example_bucket,
)
from tests.unit_tests.oss.__mock.tencent_cos import setup_tencent_cos_mock


class TestTencentCos(BaseStorageTest):
    @pytest.fixture(autouse=True)
    def setup_method(self, setup_tencent_cos_mock):
        """Executed before each test method."""
        with patch.object(CosConfig, "__init__", return_value=None):
            self.storage = TencentCosStorage()
        self.storage.bucket_name = get_example_bucket()
