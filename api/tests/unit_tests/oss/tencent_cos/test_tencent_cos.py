from unittest.mock import MagicMock, patch

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


class TestTencentCosConfiguration:
    """Tests for TencentCosStorage initialization with different configurations."""

    def test_init_with_custom_domain(self):
        """Test initialization with custom domain configured."""
        # Mock dify_config to return custom domain configuration
        mock_dify_config = MagicMock()
        mock_dify_config.TENCENT_COS_CUSTOM_DOMAIN = "cos.example.com"
        mock_dify_config.TENCENT_COS_SECRET_ID = "test-secret-id"
        mock_dify_config.TENCENT_COS_SECRET_KEY = "test-secret-key"
        mock_dify_config.TENCENT_COS_SCHEME = "https"

        # Mock CosConfig and CosS3Client
        mock_config_instance = MagicMock()
        mock_client = MagicMock()

        with (
            patch("extensions.storage.tencent_cos_storage.dify_config", mock_dify_config),
            patch(
                "extensions.storage.tencent_cos_storage.CosConfig", return_value=mock_config_instance
            ) as mock_cos_config,
            patch("extensions.storage.tencent_cos_storage.CosS3Client", return_value=mock_client),
        ):
            TencentCosStorage()

            # Verify CosConfig was called with Domain parameter (not Region)
            mock_cos_config.assert_called_once()
            call_kwargs = mock_cos_config.call_args[1]
            assert "Domain" in call_kwargs
            assert call_kwargs["Domain"] == "cos.example.com"
            assert "Region" not in call_kwargs
            assert call_kwargs["SecretId"] == "test-secret-id"
            assert call_kwargs["SecretKey"] == "test-secret-key"
            assert call_kwargs["Scheme"] == "https"

    def test_init_with_region(self):
        """Test initialization with region configured (no custom domain)."""
        # Mock dify_config to return region configuration
        mock_dify_config = MagicMock()
        mock_dify_config.TENCENT_COS_CUSTOM_DOMAIN = None
        mock_dify_config.TENCENT_COS_REGION = "ap-guangzhou"
        mock_dify_config.TENCENT_COS_SECRET_ID = "test-secret-id"
        mock_dify_config.TENCENT_COS_SECRET_KEY = "test-secret-key"
        mock_dify_config.TENCENT_COS_SCHEME = "https"

        # Mock CosConfig and CosS3Client
        mock_config_instance = MagicMock()
        mock_client = MagicMock()

        with (
            patch("extensions.storage.tencent_cos_storage.dify_config", mock_dify_config),
            patch(
                "extensions.storage.tencent_cos_storage.CosConfig", return_value=mock_config_instance
            ) as mock_cos_config,
            patch("extensions.storage.tencent_cos_storage.CosS3Client", return_value=mock_client),
        ):
            TencentCosStorage()

            # Verify CosConfig was called with Region parameter (not Domain)
            mock_cos_config.assert_called_once()
            call_kwargs = mock_cos_config.call_args[1]
            assert "Region" in call_kwargs
            assert call_kwargs["Region"] == "ap-guangzhou"
            assert "Domain" not in call_kwargs
            assert call_kwargs["SecretId"] == "test-secret-id"
            assert call_kwargs["SecretKey"] == "test-secret-key"
            assert call_kwargs["Scheme"] == "https"
