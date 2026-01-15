from unittest.mock import patch

import pytest
from oss2 import Auth

from extensions.storage.aliyun_oss_storage import AliyunOssStorage
from tests.unit_tests.oss.__mock.aliyun_oss import setup_aliyun_oss_mock
from tests.unit_tests.oss.__mock.base import (
    BaseStorageTest,
    get_example_bucket,
    get_example_folder,
)


class TestAliyunOss(BaseStorageTest):
    @pytest.fixture(autouse=True)
    def setup_method(self, setup_aliyun_oss_mock):
        """Executed before each test method."""
        with patch.object(Auth, "__init__", return_value=None):
            self.storage = AliyunOssStorage()
        self.storage.bucket_name = get_example_bucket()
        self.storage.folder = get_example_folder()
