from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity


class TestTTSModel:
    @pytest.fixture
    def mock_plugin_model_provider(self):
        return MagicMock(spec=PluginModelProviderEntity)

    @pytest.fixture
    def tts_model(self, mock_plugin_model_provider):
        return TTSModel(
            tenant_id="tenant_123",
            model_type=ModelType.TTS,
            plugin_id="plugin_123",
            provider_name="test_provider",
            plugin_model_provider=mock_plugin_model_provider,
        )

    def test_model_type(self, tts_model):
        assert tts_model.model_type == ModelType.TTS

    def test_invoke_success(self, tts_model):
        model_name = "test_model"
        tenant_id = "ignored_tenant_id"
        credentials = {"api_key": "abc"}
        content_text = "Hello world"
        voice = "alloy"
        user = "user_123"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_tts.return_value = [b"audio_chunk"]

            result = tts_model.invoke(
                model=model_name,
                tenant_id=tenant_id,
                credentials=credentials,
                content_text=content_text,
                voice=voice,
                user=user,
            )

            assert list(result) == [b"audio_chunk"]
            mock_client.invoke_tts.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="user_123",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                content_text=content_text,
                voice=voice,
            )

    def test_invoke_success_no_user(self, tts_model):
        model_name = "test_model"
        tenant_id = "ignored_tenant_id"
        credentials = {"api_key": "abc"}
        content_text = "Hello world"
        voice = "alloy"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_tts.return_value = [b"audio_chunk"]

            result = tts_model.invoke(
                model=model_name, tenant_id=tenant_id, credentials=credentials, content_text=content_text, voice=voice
            )

            assert list(result) == [b"audio_chunk"]
            mock_client.invoke_tts.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="unknown",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                content_text=content_text,
                voice=voice,
            )

    def test_invoke_exception(self, tts_model):
        model_name = "test_model"
        tenant_id = "ignored_tenant_id"
        credentials = {"api_key": "abc"}
        content_text = "Hello world"
        voice = "alloy"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_tts.side_effect = Exception("Test error")

            with pytest.raises(InvokeError) as excinfo:
                tts_model.invoke(
                    model=model_name,
                    tenant_id=tenant_id,
                    credentials=credentials,
                    content_text=content_text,
                    voice=voice,
                )

            assert "[test_provider] Error: Test error" in str(excinfo.value.description)

    def test_get_tts_model_voices(self, tts_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        language = "en-US"

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.get_tts_model_voices.return_value = [{"name": "Voice1"}]

            result = tts_model.get_tts_model_voices(model=model_name, credentials=credentials, language=language)

            assert result == [{"name": "Voice1"}]
            mock_client.get_tts_model_voices.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="unknown",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                language=language,
            )
