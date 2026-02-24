from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.model_providers.__base.moderation_model import ModerationModel
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity


class TestModerationModel:
    @pytest.fixture
    def mock_plugin_model_provider(self):
        return MagicMock(spec=PluginModelProviderEntity)

    @pytest.fixture
    def moderation_model(self, mock_plugin_model_provider):
        return ModerationModel(
            tenant_id="tenant_123",
            model_type=ModelType.MODERATION,
            plugin_id="plugin_123",
            provider_name="test_provider",
            plugin_model_provider=mock_plugin_model_provider,
        )

    def test_model_type(self, moderation_model):
        assert moderation_model.model_type == ModelType.MODERATION

    def test_invoke_success(self, moderation_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        text = "test text"
        user = "user_123"

        with (
            patch("core.plugin.impl.model.PluginModelClient") as mock_client_class,
            patch("time.perf_counter", return_value=1.0),
        ):
            mock_client = mock_client_class.return_value
            mock_client.invoke_moderation.return_value = True

            result = moderation_model.invoke(model=model_name, credentials=credentials, text=text, user=user)

            assert result is True
            assert moderation_model.started_at == 1.0
            mock_client.invoke_moderation.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="user_123",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                text=text,
            )

    def test_invoke_success_no_user(self, moderation_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        text = "test text"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_moderation.return_value = False

            result = moderation_model.invoke(model=model_name, credentials=credentials, text=text)

            assert result is False
            mock_client.invoke_moderation.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="unknown",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                text=text,
            )

    def test_invoke_exception(self, moderation_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        text = "test text"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_moderation.side_effect = Exception("Test error")

            with pytest.raises(InvokeError) as excinfo:
                moderation_model.invoke(model=model_name, credentials=credentials, text=text)

            assert "[test_provider] Error: Test error" in str(excinfo.value.description)
