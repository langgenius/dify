from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.config_entity import BaseTracingConfig
from models.model import App, TraceAppConfig
from services.ops_service import OpsService

TEST_APP_ID = "test_app_id_123"
TEST_TENANT_ID = "test_tenant_id_456"
TEST_PROVIDER_ARIZE = "arize"
TEST_PROVIDER_LANGFUSE = "langfuse"
TEST_PROVIDER_INVALID = "invalid_provider"
TEST_TRACING_CONFIG = {"api_key": "test_key", "endpoint": "http://test.com", "host": "http://test.com"}
TEST_TRACING_CONFIG_NO_HOST = {"api_key": "test_key", "endpoint": "http://test.com", "host": ""}
TEST_DECRYPT_CONFIG = {"api_key": "test_key", "endpoint": "http://test.com", "host": "http://test.com"}
TEST_OBFUSCATED_CONFIG = {"api_key": "te***ey", "endpoint": "http://test.com", "host": "http://test.com"}
TEST_PROJECT_URL = "https://test.project.url"


class TestOpsServiceFactory:
    """Factory class for creating test data and mock objects for ops service tests."""

    @staticmethod
    def create_trace_app_config_mock(
        app_id: str = TEST_APP_ID,
        tracing_provider: str = TEST_PROVIDER_ARIZE,
        tracing_config: dict[str, Any] = TEST_TRACING_CONFIG,
    ) -> MagicMock:
        """Create a mock TraceAppConfig object."""
        config = MagicMock(spec=TraceAppConfig)
        config.app_id = app_id
        config.tracing_provider = tracing_provider
        config.tracing_config = tracing_config

        def _to_dict():
            return {
                "app_id": config.app_id,
                "tracing_provider": config.tracing_provider,
                "tracing_config": config.tracing_config,
            }

        config.to_dict = _to_dict
        return config

    @staticmethod
    def create_app_mock(
        app_id: str = TEST_APP_ID,
        tenant_id: str = TEST_TENANT_ID,
    ) -> MagicMock:
        """Create a mock App object."""
        app = MagicMock(spec=App)
        app.id = app_id
        app.tenant_id = tenant_id
        return app

    @staticmethod
    def create_provider_config_mock():
        """Create a mock provider_config_map dict."""
        return {"config_class": MagicMock(spec=BaseTracingConfig), "other_keys": ["value1", "host"]}


class TestOpsServiceGetTracingConfig:
    """
    Unit tests for OpsService.get_tracing_app_config method.

    This test suite covers:
    - Config not found
    - App not found
    - Null tracing config
    - Project URL fallback for all providers
    - Project URL success for all providers
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestOpsServiceFactory()

    @patch("services.ops_service.db")
    def test_get_tracing_config_not_found(self, mock_db):
        """Test get_tracing_app_config returns None when no config is found."""
        # Arrange
        mock_db.session.scalar.return_value = None

        # Act
        result = OpsService.get_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE)

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    def test_get_tracing_config_app_not_found(self, mock_db, factory):
        """Test get_tracing_app_config returns None when app is not found."""
        # Arrange
        mock_db.session.scalar.return_value = factory.create_trace_app_config_mock()
        mock_db.session.get.return_value = None

        # Act
        result = OpsService.get_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE)

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    def test_get_tracing_config_null_tracing_config(self, mock_db, factory):
        """Test get_tracing_app_config raises ValueError when tracing_config is None."""
        # Arrange
        trace_app_config = factory.create_trace_app_config_mock()
        trace_app_config.tracing_config = None
        mock_db.session.scalar.return_value = trace_app_config
        mock_db.session.get.return_value = factory.create_app_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Tracing config cannot be None."):
            OpsService.get_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE)

    @pytest.mark.parametrize(
        ("provider", "fallback_url"),
        [
            ("arize", "https://app.arize.com/"),
            ("phoenix", "https://app.phoenix.arize.com/projects/"),
            ("langfuse", "http://test.com/"),
            ("langsmith", "https://smith.langchain.com/"),
            ("opik", "https://www.comet.com/opik/"),
            ("weave", "https://wandb.ai/"),
            ("aliyun", "https://arms.console.aliyun.com/"),
            ("tencent", "https://console.cloud.tencent.com/apm"),
            ("mlflow", "http://localhost:5000/"),
            ("databricks", "https://www.databricks.com/"),
        ],
    )
    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_config_provider_project_url_fallback(
        self, mock_trace_manager, mock_db, factory, provider, fallback_url
    ):
        """Test get_tracing_app_config uses fallback URL when project URL retrieval fails."""
        # Arrange
        trace_app_config = factory.create_trace_app_config_mock()
        trace_app_config.tracing_provider = provider
        mock_db.session.scalar.return_value = trace_app_config
        mock_db.session.get.return_value = factory.create_app_mock()
        mock_trace_manager.decrypt_tracing_config.return_value = TEST_DECRYPT_CONFIG
        mock_trace_manager.obfuscated_decrypt_token.return_value = TEST_OBFUSCATED_CONFIG
        if provider == TEST_PROVIDER_LANGFUSE:
            mock_trace_manager.get_trace_config_project_key.side_effect = Exception("Error")
        else:
            mock_trace_manager.get_trace_config_project_url.side_effect = Exception("Error")

        # Act
        result = OpsService.get_tracing_app_config(TEST_APP_ID, provider)

        # Assert
        assert result["tracing_config"]["project_url"] == fallback_url

    @pytest.mark.parametrize(
        "provider",
        ["arize", "phoenix", "langfuse", "langsmith", "opik", "weave", "aliyun", "tencent", "mlflow", "databricks"],
    )
    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_config_provider_project_url_success(self, mock_trace_manager, mock_db, factory, provider):
        """Test get_tracing_app_config successfully retrieves project URL for supported providers."""
        # Arrange
        trace_app_config = factory.create_trace_app_config_mock()
        trace_app_config.tracing_provider = provider
        mock_db.session.scalar.return_value = trace_app_config
        mock_db.session.get.return_value = factory.create_app_mock()
        mock_trace_manager.decrypt_tracing_config.return_value = TEST_DECRYPT_CONFIG
        mock_trace_manager.obfuscated_decrypt_token.return_value = TEST_OBFUSCATED_CONFIG
        if provider == TEST_PROVIDER_LANGFUSE:
            mock_trace_manager.get_trace_config_project_key.return_value = "test_key"
        else:
            mock_trace_manager.get_trace_config_project_url.return_value = TEST_PROJECT_URL

        # Act
        result = OpsService.get_tracing_app_config(TEST_APP_ID, provider)

        # Assert
        if provider == TEST_PROVIDER_LANGFUSE:
            expected_url = f"{TEST_DECRYPT_CONFIG['host']}/project/test_key"
        else:
            expected_url = TEST_PROJECT_URL
        assert result["tracing_config"]["project_url"] == expected_url


class TestOpsServiceCreateTracingConfig:
    """
    Unit tests for OpsService.create_tracing_app_config method.

    This test suite covers:
    - Invalid tracing provider
    - Invalid credentials (config check failed)
    - Project URL exception for all supported providers
    - Tracing config already exists
    - App not found
    - Create success with valid data
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestOpsServiceFactory()

    @patch("services.ops_service.provider_config_map")
    def test_create_invalid_provider(self, mock_provider_config):
        """Test create_tracing_app_config returns error with invalid provider."""
        # Arrange
        mock_provider_config.__getitem__.side_effect = KeyError

        # Act
        result = OpsService.create_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_INVALID, TEST_TRACING_CONFIG)

        # Assert
        assert result == {"error": f"Invalid tracing provider: {TEST_PROVIDER_INVALID}"}

    @patch("services.ops_service.OpsTraceManager")
    @patch("services.ops_service.provider_config_map")
    def test_create_invalid_credentials(self, mock_provider_config, mock_trace_manager, factory):
        """Test create_tracing_app_config returns error when credentials are invalid."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_trace_manager.check_trace_config_is_effective.return_value = False

        # Act
        result = OpsService.create_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG)

        # Assert
        assert result == {"error": "Invalid Credentials"}

    @pytest.mark.parametrize(
        "provider", ["arize", "phoenix", "langfuse", "langsmith", "opik", "mlflow", "databricks", "tencent", "weave"]
    )
    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_provider_project_url_exception(
        self, mock_trace_manager, mock_provider_config, mock_db, factory, provider
    ):
        """Test create_tracing_app_config handles project URL exception for all providers."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_trace_manager.check_trace_config_is_effective.return_value = True
        if provider == TEST_PROVIDER_LANGFUSE:
            mock_trace_manager.get_trace_config_project_key.side_effect = Exception("Error")
        else:
            mock_trace_manager.get_trace_config_project_url.side_effect = Exception("Error")
        mock_db.session.scalar.return_value = None
        mock_db.session.get.return_value = factory.create_app_mock()
        mock_trace_manager.encrypt_tracing_config.return_value = TEST_TRACING_CONFIG

        # Act
        result = OpsService.create_tracing_app_config(TEST_APP_ID, provider, TEST_TRACING_CONFIG)

        # Assert
        assert result == {"result": "success"}
        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()

    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_config_already_exists(self, mock_trace_manager, mock_provider_config, mock_db, factory):
        """Test create_tracing_app_config returns None when config already exists."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_trace_manager.check_trace_config_is_effective.return_value = True
        mock_trace_manager.get_trace_config_project_url.return_value = TEST_PROJECT_URL
        mock_db.session.scalar.return_value = factory.create_trace_app_config_mock()

        # Act
        result = OpsService.create_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG_NO_HOST)

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_app_not_found(self, mock_trace_manager, mock_provider_config, mock_db, factory):
        """Test create_tracing_app_config returns None when app is not found."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_trace_manager.check_trace_config_is_effective.return_value = True
        mock_trace_manager.get_trace_config_project_url.return_value = TEST_PROJECT_URL
        mock_db.session.scalar.return_value = None
        mock_db.session.get.return_value = None

        # Act
        result = OpsService.create_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG)

        # Assert
        assert result is None

    @pytest.mark.parametrize(
        "provider", ["arize", "phoenix", "langfuse", "langsmith", "opik", "mlflow", "databricks", "tencent", "weave"]
    )
    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_provider_project_url_success(
        self, mock_trace_manager, mock_provider_config, mock_db, factory, provider
    ):
        """Test create_tracing_app_config sets project URL successfully for all providers."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_trace_manager.check_trace_config_is_effective.return_value = True
        if provider == TEST_PROVIDER_LANGFUSE:
            mock_trace_manager.get_trace_config_project_key.return_value = "test_key"
        else:
            mock_trace_manager.get_trace_config_project_url.return_value = TEST_PROJECT_URL
        mock_db.session.scalar.return_value = None
        mock_db.session.get.return_value = factory.create_app_mock()
        mock_trace_manager.encrypt_tracing_config.return_value = TEST_TRACING_CONFIG

        # Act
        result = OpsService.create_tracing_app_config(TEST_APP_ID, provider, TEST_TRACING_CONFIG)

        # Assert
        assert result == {"result": "success"}
        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()


class TestOpsServiceUpdateTracingConfig:
    """
    Unit tests for OpsService.update_tracing_app_config method.

    This test suite covers:
    - Invalid provider
    - Config not found
    - App not found
    - Invalid credentials
    - Update success
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestOpsServiceFactory()

    @patch("services.ops_service.provider_config_map")
    def test_update_invalid_provider(self, mock_provider_config):
        """Test update_tracing_app_config raises ValueError with invalid provider."""
        # Arrange
        mock_provider_config.__getitem__.side_effect = KeyError

        # Act & Assert
        with pytest.raises(ValueError, match=f"Invalid tracing provider: {TEST_PROVIDER_INVALID}"):
            OpsService.update_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_INVALID, TEST_TRACING_CONFIG)

    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    def test_update_config_not_found(self, mock_provider_config, mock_db, factory):
        """Test update_tracing_app_config returns None when config is not found."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_db.session.scalar.return_value = None

        # Act
        result = OpsService.update_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG)

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    def test_update_app_not_found(self, mock_provider_config, mock_db, factory):
        """Test update_tracing_app_config returns None when app is not found."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_db.session.scalar.return_value = factory.create_trace_app_config_mock()
        mock_db.session.get.return_value = None

        # Act
        result = OpsService.update_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG)

        # Assert
        assert result is None

    @patch("services.ops_service.OpsTraceManager")
    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    def test_update_invalid_credentials(self, mock_provider_config, mock_db, mock_trace_manager, factory):
        """Test update_tracing_app_config raises ValueError with invalid credentials."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        mock_db.session.scalar.return_value = factory.create_trace_app_config_mock()
        mock_db.session.get.return_value = factory.create_app_mock()
        mock_trace_manager.encrypt_tracing_config.return_value = TEST_TRACING_CONFIG
        mock_trace_manager.decrypt_tracing_config.return_value = TEST_DECRYPT_CONFIG
        mock_trace_manager.check_trace_config_is_effective.return_value = False

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid Credentials"):
            OpsService.update_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG)

    @patch("services.ops_service.OpsTraceManager")
    @patch("services.ops_service.db")
    @patch("services.ops_service.provider_config_map")
    def test_update_success(self, mock_provider_config, mock_db, mock_trace_manager, factory):
        """Test update_tracing_app_config updates config successfully."""
        # Arrange
        mock_provider_config.__getitem__.return_value = factory.create_provider_config_mock()
        trace_app_config = factory.create_trace_app_config_mock()
        mock_db.session.scalar.return_value = trace_app_config
        mock_db.session.get.return_value = factory.create_app_mock()
        mock_trace_manager.encrypt_tracing_config.return_value = TEST_TRACING_CONFIG
        mock_trace_manager.decrypt_tracing_config.return_value = TEST_DECRYPT_CONFIG
        mock_trace_manager.check_trace_config_is_effective.return_value = True

        # Act
        result = OpsService.update_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE, TEST_TRACING_CONFIG)

        # Assert
        assert result is not None
        assert trace_app_config.tracing_config == TEST_TRACING_CONFIG
        mock_db.session.commit.assert_called_once()


class TestOpsServiceDeleteTracingConfig:
    """
    Unit tests for OpsService.delete_tracing_app_config method.

    This test suite covers:
    - Config not found
    - Delete success
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestOpsServiceFactory()

    @patch("services.ops_service.db")
    def test_delete_config_not_found(self, mock_db):
        """Test delete_tracing_app_config returns None when config is not found."""
        # Arrange
        mock_db.session.scalar.return_value = None

        # Act
        result = OpsService.delete_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE)

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    def test_delete_success(self, mock_db, factory):
        """Test delete_tracing_app_config deletes config successfully."""
        # Arrange
        trace_app_config = factory.create_trace_app_config_mock()
        mock_db.session.scalar.return_value = trace_app_config

        # Act
        result = OpsService.delete_tracing_app_config(TEST_APP_ID, TEST_PROVIDER_ARIZE)

        # Assert
        assert result is True
        mock_db.session.delete.assert_called_once_with(trace_app_config)
        mock_db.session.commit.assert_called_once()
