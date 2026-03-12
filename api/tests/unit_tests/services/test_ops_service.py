from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.config_entity import TracingProviderEnum
from models.model import App, TraceAppConfig
from services.ops_service import OpsService


class TestOpsService:
    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_app_config_no_config(self, mock_ops_trace_manager, mock_db):
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act
        result = OpsService.get_tracing_app_config("app_id", "arize")

        # Assert
        assert result is None
        mock_db.session.query.assert_called_with(TraceAppConfig)

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_app_config_no_app(self, mock_ops_trace_manager, mock_db):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        mock_db.session.query.return_value.where.return_value.first.side_effect = [trace_config, None]

        # Act
        result = OpsService.get_tracing_app_config("app_id", "arize")

        # Assert
        assert result is None
        assert mock_db.session.query.call_count == 2

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_app_config_none_config(self, mock_ops_trace_manager, mock_db):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        trace_config.tracing_config = None
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [trace_config, app]

        # Act & Assert
        with pytest.raises(ValueError, match="Tracing config cannot be None."):
            OpsService.get_tracing_app_config("app_id", "arize")

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    @pytest.mark.parametrize(
        ("provider", "default_url"),
        [
            ("arize", "https://app.arize.com/"),
            ("phoenix", "https://app.phoenix.arize.com/projects/"),
            ("langsmith", "https://smith.langchain.com/"),
            ("opik", "https://www.comet.com/opik/"),
            ("weave", "https://wandb.ai/"),
            ("aliyun", "https://arms.console.aliyun.com/"),
            ("tencent", "https://console.cloud.tencent.com/apm"),
            ("mlflow", "http://localhost:5000/"),
            ("databricks", "https://www.databricks.com/"),
        ],
    )
    def test_get_tracing_app_config_providers_exception(self, mock_ops_trace_manager, mock_db, provider, default_url):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        trace_config.tracing_config = {"some": "config"}
        trace_config.to_dict.return_value = {"tracing_config": {"project_url": default_url}}
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [trace_config, app]

        mock_ops_trace_manager.decrypt_tracing_config.return_value = {}
        mock_ops_trace_manager.obfuscated_decrypt_token.return_value = {}
        mock_ops_trace_manager.get_trace_config_project_url.side_effect = Exception("error")
        mock_ops_trace_manager.get_trace_config_project_key.side_effect = Exception("error")

        # Act
        result = OpsService.get_tracing_app_config("app_id", provider)

        # Assert
        assert result["tracing_config"]["project_url"] == default_url

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    @pytest.mark.parametrize(
        "provider", ["arize", "phoenix", "langsmith", "opik", "weave", "aliyun", "tencent", "mlflow", "databricks"]
    )
    def test_get_tracing_app_config_providers_success(self, mock_ops_trace_manager, mock_db, provider):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        trace_config.tracing_config = {"some": "config"}
        trace_config.to_dict.return_value = {"tracing_config": {"project_url": "success_url"}}
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [trace_config, app]

        mock_ops_trace_manager.decrypt_tracing_config.return_value = {}
        mock_ops_trace_manager.obfuscated_decrypt_token.return_value = {}
        mock_ops_trace_manager.get_trace_config_project_url.return_value = "success_url"

        # Act
        result = OpsService.get_tracing_app_config("app_id", provider)

        # Assert
        assert result["tracing_config"]["project_url"] == "success_url"

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_app_config_langfuse_success(self, mock_ops_trace_manager, mock_db):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        trace_config.tracing_config = {"some": "config"}
        trace_config.to_dict.return_value = {"tracing_config": {"project_url": "https://api.langfuse.com/project/key"}}
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [trace_config, app]

        mock_ops_trace_manager.decrypt_tracing_config.return_value = {"host": "https://api.langfuse.com"}
        mock_ops_trace_manager.obfuscated_decrypt_token.return_value = {"host": "https://api.langfuse.com"}
        mock_ops_trace_manager.get_trace_config_project_key.return_value = "key"

        # Act
        result = OpsService.get_tracing_app_config("app_id", "langfuse")

        # Assert
        assert result["tracing_config"]["project_url"] == "https://api.langfuse.com/project/key"

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_get_tracing_app_config_langfuse_exception(self, mock_ops_trace_manager, mock_db):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        trace_config.tracing_config = {"some": "config"}
        trace_config.to_dict.return_value = {"tracing_config": {"project_url": "https://api.langfuse.com/"}}
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [trace_config, app]

        mock_ops_trace_manager.decrypt_tracing_config.return_value = {"host": "https://api.langfuse.com"}
        mock_ops_trace_manager.obfuscated_decrypt_token.return_value = {"host": "https://api.langfuse.com"}
        mock_ops_trace_manager.get_trace_config_project_key.side_effect = Exception("error")

        # Act
        result = OpsService.get_tracing_app_config("app_id", "langfuse")

        # Assert
        assert result["tracing_config"]["project_url"] == "https://api.langfuse.com/"

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_invalid_provider(self, mock_ops_trace_manager, mock_db):
        # Act
        result = OpsService.create_tracing_app_config("app_id", "invalid_provider", {})

        # Assert
        assert result == {"error": "Invalid tracing provider: invalid_provider"}

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_invalid_credentials(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.LANGFUSE
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = False

        # Act
        result = OpsService.create_tracing_app_config("app_id", provider, {"public_key": "p", "secret_key": "s"})

        # Assert
        assert result == {"error": "Invalid Credentials"}

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    @pytest.mark.parametrize(
        ("provider", "config"),
        [
            (TracingProviderEnum.ARIZE, {}),
            (TracingProviderEnum.LANGFUSE, {"public_key": "p", "secret_key": "s"}),
            (TracingProviderEnum.LANGSMITH, {"api_key": "k", "project": "p"}),
            (TracingProviderEnum.ALIYUN, {"license_key": "k", "endpoint": "https://aliyun.com"}),
        ],
    )
    def test_create_tracing_app_config_project_url_exception(self, mock_ops_trace_manager, mock_db, provider, config):
        # Arrange
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        mock_ops_trace_manager.get_trace_config_project_url.side_effect = Exception("error")
        mock_ops_trace_manager.get_trace_config_project_key.side_effect = Exception("error")
        mock_db.session.query.return_value.where.return_value.first.return_value = MagicMock(spec=TraceAppConfig)

        # Act
        result = OpsService.create_tracing_app_config("app_id", provider, config)

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_langfuse_success(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.LANGFUSE
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        mock_ops_trace_manager.get_trace_config_project_key.return_value = "key"
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [None, app]
        mock_ops_trace_manager.encrypt_tracing_config.return_value = {}

        # Act
        result = OpsService.create_tracing_app_config(
            "app_id", provider, {"public_key": "p", "secret_key": "s", "host": "https://api.langfuse.com"}
        )

        # Assert
        assert result == {"result": "success"}

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_already_exists(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        mock_db.session.query.return_value.where.return_value.first.return_value = MagicMock(spec=TraceAppConfig)

        # Act
        result = OpsService.create_tracing_app_config("app_id", provider, {})

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_no_app(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        mock_db.session.query.return_value.where.return_value.first.side_effect = [None, None]

        # Act
        result = OpsService.create_tracing_app_config("app_id", provider, {})

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_with_empty_other_keys(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [None, app]
        mock_ops_trace_manager.encrypt_tracing_config.return_value = {}

        # Act
        # 'project' is in other_keys for Arize
        # provide an empty string for the project in the tracing_config
        # create_tracing_app_config will replace it with the default from the model
        result = OpsService.create_tracing_app_config("app_id", provider, {"project": ""})

        # Assert
        assert result == {"result": "success"}

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_create_tracing_app_config_success(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True
        mock_ops_trace_manager.get_trace_config_project_url.return_value = "http://project_url"
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [None, app]
        mock_ops_trace_manager.encrypt_tracing_config.return_value = {"encrypted": "config"}

        # Act
        result = OpsService.create_tracing_app_config("app_id", provider, {})

        # Assert
        assert result == {"result": "success"}
        mock_db.session.add.assert_called()
        mock_db.session.commit.assert_called()

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_update_tracing_app_config_invalid_provider(self, mock_ops_trace_manager, mock_db):
        # Act & Assert
        with pytest.raises(ValueError, match="Invalid tracing provider: invalid_provider"):
            OpsService.update_tracing_app_config("app_id", "invalid_provider", {})

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_update_tracing_app_config_no_config(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act
        result = OpsService.update_tracing_app_config("app_id", provider, {})

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_update_tracing_app_config_no_app(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        current_config = MagicMock(spec=TraceAppConfig)
        mock_db.session.query.return_value.where.return_value.first.side_effect = [current_config, None]

        # Act
        result = OpsService.update_tracing_app_config("app_id", provider, {})

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_update_tracing_app_config_invalid_credentials(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        current_config = MagicMock(spec=TraceAppConfig)
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [current_config, app]
        mock_ops_trace_manager.decrypt_tracing_config.return_value = {}
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = False

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid Credentials"):
            OpsService.update_tracing_app_config("app_id", provider, {})

    @patch("services.ops_service.db")
    @patch("services.ops_service.OpsTraceManager")
    def test_update_tracing_app_config_success(self, mock_ops_trace_manager, mock_db):
        # Arrange
        provider = TracingProviderEnum.ARIZE
        current_config = MagicMock(spec=TraceAppConfig)
        current_config.to_dict.return_value = {"some": "data"}
        app = MagicMock(spec=App)
        app.tenant_id = "tenant_id"
        mock_db.session.query.return_value.where.return_value.first.side_effect = [current_config, app]
        mock_ops_trace_manager.decrypt_tracing_config.return_value = {}
        mock_ops_trace_manager.check_trace_config_is_effective.return_value = True

        # Act
        result = OpsService.update_tracing_app_config("app_id", provider, {})

        # Assert
        assert result == {"some": "data"}
        mock_db.session.commit.assert_called_once()

    @patch("services.ops_service.db")
    def test_delete_tracing_app_config_no_config(self, mock_db):
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act
        result = OpsService.delete_tracing_app_config("app_id", "arize")

        # Assert
        assert result is None

    @patch("services.ops_service.db")
    def test_delete_tracing_app_config_success(self, mock_db):
        # Arrange
        trace_config = MagicMock(spec=TraceAppConfig)
        mock_db.session.query.return_value.where.return_value.first.return_value = trace_config

        # Act
        result = OpsService.delete_tracing_app_config("app_id", "arize")

        # Assert
        assert result is True
        mock_db.session.delete.assert_called_with(trace_config)
        mock_db.session.commit.assert_called_once()
