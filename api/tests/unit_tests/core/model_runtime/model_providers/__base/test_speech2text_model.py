from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity


class TestSpeech2TextModel:
    @pytest.fixture
    def mock_plugin_model_provider(self):
        return MagicMock(spec=PluginModelProviderEntity)

    @pytest.fixture
    def speech2text_model(self, mock_plugin_model_provider):
        return Speech2TextModel(
            tenant_id="tenant_123",
            model_type=ModelType.SPEECH2TEXT,
            plugin_id="plugin_123",
            provider_name="test_provider",
            plugin_model_provider=mock_plugin_model_provider,
        )

    def test_model_type(self, speech2text_model):
        assert speech2text_model.model_type == ModelType.SPEECH2TEXT

    def test_invoke_success(self, speech2text_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        file = BytesIO(b"audio data")
        user = "user_123"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_speech_to_text.return_value = "transcribed text"

            result = speech2text_model.invoke(model=model_name, credentials=credentials, file=file, user=user)

            assert result == "transcribed text"
            mock_client.invoke_speech_to_text.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="user_123",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                file=file,
            )

    def test_invoke_success_no_user(self, speech2text_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        file = BytesIO(b"audio data")

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_speech_to_text.return_value = "transcribed text"

            result = speech2text_model.invoke(model=model_name, credentials=credentials, file=file)

            assert result == "transcribed text"
            mock_client.invoke_speech_to_text.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="unknown",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                file=file,
            )

    def test_invoke_exception(self, speech2text_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        file = BytesIO(b"audio data")

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_speech_to_text.side_effect = Exception("Test error")

            with pytest.raises(InvokeError) as excinfo:
                speech2text_model.invoke(model=model_name, credentials=credentials, file=file)

            assert "[test_provider] Error: Test error" in str(excinfo.value.description)
