from unittest.mock import MagicMock, patch

import pytest
from baidubce.auth.bce_credentials import BceCredentials
from baidubce.bce_client_configuration import BceClientConfiguration

from extensions.storage.baidu_obs_storage import BaiduObsStorage
from tests.unit_tests.oss.__mock.base import (
    BaseStorageTest,
    get_example_bucket,
)

pytest_plugins = ("tests.unit_tests.oss.__mock.baidu_obs",)


class TestBaiduObs(BaseStorageTest):
    @pytest.fixture(autouse=True)
    def setup_method(self, setup_baidu_obs_mock):
        """Executed before each test method."""
        with (
            patch.object(BceCredentials, "__init__", return_value=None),
            patch.object(BceClientConfiguration, "__init__", return_value=None),
        ):
            self.storage = BaiduObsStorage()
        self.storage.bucket_name = get_example_bucket()


class TestBaiduObsConfiguration:
    def test_init_with_config(self):
        mock_dify_config = MagicMock()
        mock_dify_config.BAIDU_OBS_BUCKET_NAME = "test-bucket"
        mock_dify_config.BAIDU_OBS_ACCESS_KEY = "test-access-key"
        mock_dify_config.BAIDU_OBS_SECRET_KEY = "test-secret-key"
        mock_dify_config.BAIDU_OBS_ENDPOINT = "https://bj.bcebos.com"

        mock_credentials = MagicMock(name="credentials")
        mock_config = MagicMock(name="config")
        mock_client = MagicMock(name="client")

        with (
            patch("extensions.storage.baidu_obs_storage.dify_config", mock_dify_config),
            patch("extensions.storage.baidu_obs_storage.BceCredentials", return_value=mock_credentials) as credentials,
            patch(
                "extensions.storage.baidu_obs_storage.BceClientConfiguration", return_value=mock_config
            ) as configuration,
            patch("extensions.storage.baidu_obs_storage.BosClient", return_value=mock_client) as client_cls,
        ):
            storage = BaiduObsStorage()

        assert storage.bucket_name == "test-bucket"
        assert storage.client == mock_client
        credentials.assert_called_once_with(
            access_key_id="test-access-key",
            secret_access_key="test-secret-key",
        )
        configuration.assert_called_once_with(
            credentials=mock_credentials,
            endpoint="https://bj.bcebos.com",
        )
        client_cls.assert_called_once_with(config=mock_config)
