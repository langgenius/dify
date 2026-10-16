import json
from unittest.mock import patch

import pytest

from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.model_manager import ModelInstance
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from core.plugin.entities.request import RequestInvokeSummary, RequestInvokeTTS
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.model_providers.base.tts_model import TTSModel
from models.account import Tenant
from models.provider import ProviderType


def _tts_model_instance() -> ModelInstance:
    provider = ProviderEntity(
        provider="provider-a",
        label=I18nObject(en_US="Test"),
        supported_model_types=[ModelType.TTS],
        configurate_methods=[],
    )
    return ModelInstance(
        provider_model_bundle=ProviderModelBundle(
            configuration=ProviderConfiguration(
                tenant_id="tenant-1",
                provider=provider,
                preferred_provider_type=ProviderType.CUSTOM,
                using_provider_type=ProviderType.CUSTOM,
                system_configuration=SystemConfiguration(enabled=False),
                custom_configuration=CustomConfiguration(provider=None),
                model_settings=[],
            ),
            model_type_instance=TTSModel(
                provider_schema=provider,
                model_runtime=create_plugin_model_runtime(tenant_id="tenant-1", user_id="user-1"),
            ),
        ),
        model="qwen3-tts-flash",
        credentials={},
    )


def _tts_schema(audio_type: str) -> AIModelEntity:
    return AIModelEntity(
        model="qwen3-tts-flash",
        label=I18nObject(en_US="Test"),
        model_type=ModelType.TTS,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.AUDIO_TYPE: audio_type},
    )


def test_system_model_helpers_forward_user_id():
    with (
        patch(
            "core.plugin.backwards_invocation.model.ModelInvocationUtils.get_max_llm_context_tokens",
            return_value=4096,
        ) as mock_max_tokens,
        patch(
            "core.plugin.backwards_invocation.model.ModelInvocationUtils.calculate_tokens",
            return_value=7,
        ) as mock_prompt_tokens,
    ):
        assert PluginModelBackwardsInvocation.get_system_model_max_tokens("tenant-1", user_id="user-1") == 4096
        assert (
            PluginModelBackwardsInvocation.get_prompt_tokens(
                "tenant-1",
                [UserPromptMessage(content="hello")],
                user_id="user-1",
            )
            == 7
        )

    mock_max_tokens.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    mock_prompt_tokens.assert_called_once_with(
        tenant_id="tenant-1",
        prompt_messages=[UserPromptMessage(content="hello")],
        user_id="user-1",
    )


def test_invoke_summary_uses_same_user_scope_for_token_helpers():
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    payload = RequestInvokeSummary(text="short", instruction="keep it concise")

    with (
        patch.object(
            PluginModelBackwardsInvocation,
            "get_system_model_max_tokens",
            return_value=100,
        ) as mock_max_tokens,
        patch.object(
            PluginModelBackwardsInvocation,
            "get_prompt_tokens",
            return_value=10,
        ) as mock_prompt_tokens,
    ):
        assert PluginModelBackwardsInvocation.invoke_summary("user-1", tenant, payload) == "short"

    mock_max_tokens.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    mock_prompt_tokens.assert_called_once_with(
        tenant_id="tenant-1",
        prompt_messages=[UserPromptMessage(content="short")],
        user_id="user-1",
    )


def test_invoke_tts_emits_the_verified_mime_type_for_backwards_invocation():
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    model_instance = _tts_model_instance()
    payload = RequestInvokeTTS(
        provider="provider-a",
        model="qwen3-tts-flash",
        content_text="hello",
        voice="Cherry",
    )

    with (
        patch.object(PluginModelBackwardsInvocation, "_get_bound_model_instance", return_value=model_instance),
        patch.object(
            model_instance.model_type_instance,
            "invoke",
            return_value=[b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"],
        ),
        patch.object(model_instance.model_type_instance, "get_model_schema", return_value=_tts_schema("wav")),
    ):
        result = list(PluginModelBackwardsInvocation.invoke_tts("user-1", tenant, payload))

    assert result == [
        {
            "result": "524946462400000057415645666d742010000000617564696f2d64617461",
            "mime_type": "audio/wav",
        }
    ]


def test_invoke_tts_defers_provider_errors_until_the_response_generator_is_consumed():
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    model_instance = _tts_model_instance()
    payload = RequestInvokeTTS(
        provider="provider-a",
        model="qwen3-tts-flash",
        content_text="hello",
        voice="Cherry",
    )

    with (
        patch.object(PluginModelBackwardsInvocation, "_get_bound_model_instance", return_value=model_instance),
        patch.object(
            model_instance.model_type_instance, "invoke", side_effect=RuntimeError("provider failed")
        ) as invoke,
    ):
        response = PluginModelBackwardsInvocation.invoke_tts("user-1", tenant, payload)

        invoke.assert_not_called()
        with pytest.raises(RuntimeError, match="provider failed"):
            next(response)


def test_backwards_event_stream_serializes_a_deferred_mime_error():
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    model_instance = _tts_model_instance()
    payload = RequestInvokeTTS(
        provider="provider-a",
        model="qwen3-tts-flash",
        content_text="hello",
        voice="Cherry",
    )

    with (
        patch.object(PluginModelBackwardsInvocation, "_get_bound_model_instance", return_value=model_instance),
        patch.object(
            model_instance.model_type_instance,
            "invoke",
            return_value=[TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data", "audio/mpeg")],
        ),
        patch.object(model_instance.model_type_instance, "get_model_schema", return_value=_tts_schema("mp3")),
    ):
        response = PluginModelBackwardsInvocation.invoke_tts("user-1", tenant, payload)
        chunks = list(PluginModelBackwardsInvocation.convert_to_event_stream(response))

    assert json.loads(chunks[0])["error"].startswith("TTS provider output MIME does not match")
