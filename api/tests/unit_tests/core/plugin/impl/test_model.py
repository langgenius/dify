from __future__ import annotations

import io
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from pytest_mock import MockerFixture
from typing_extensions import TypedDict

from core.model_invocation_routing import FrozenModelInvocation
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import (
    PluginDaemonInnerError,
    PluginModelProviderDeclaration,
    PluginStringResultResponse,
)
from core.plugin.impl import base as client_module
from core.plugin.impl.exc import PluginInvokeError, PluginLLMPollingUnsupportedError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime_factory import create_model_type_instance, create_plugin_model_runtime
from core.plugin.plugin_service import PluginService
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import (
    LLMPollingResult,
    LLMPollingStatus,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from services.model_billing_tts_adapter import TTSVoiceContract

PLUGIN_IDENTIFIER = "org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


class TestModelClientCases:
    class TestPluginModelClient:
        def test_fetch_model_providers(self, mocker: MockerFixture):
            client = PluginModelClient()
            request_mock = mocker.patch.object(
                client, "_request_with_plugin_daemon_response", return_value=["provider-a"]
            )

            result = client.fetch_model_providers("tenant-1")

            assert result == ["provider-a"]
            assert request_mock.call_args.args[:2] == (
                "GET",
                "plugin/tenant-1/management/models",
            )
            assert request_mock.call_args.kwargs["params"] == {"page": 1, "page_size": 256}

        def test_fetch_model_provider_bindings(self, mocker: MockerFixture):
            client = PluginModelClient()
            request_mock = mocker.patch.object(
                client, "_request_with_plugin_daemon_response", return_value=["binding-a"]
            )

            result = client.fetch_model_provider_bindings("tenant-1")

            assert result == ["binding-a"]
            assert request_mock.call_args.args[:2] == (
                "GET",
                "plugin/tenant-1/management/models/bindings",
            )
            assert "params" not in request_mock.call_args.kwargs

        def test_get_model_schema(self, mocker: MockerFixture):
            client = PluginModelClient()
            schema = SimpleNamespace(name="schema")
            stream_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(model_schema=schema)]),
            )

            result = client.get_model_schema(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model_type="llm",
                model="gpt-test",
                credentials={"api_key": "key"},
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is schema
            assert stream_mock.call_args.args[:2] == ("POST", "plugin/tenant-1/dispatch/model/schema")

        def test_get_model_schema_empty_stream_returns_none(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            result = client.get_model_schema(
                "tenant-1",
                "user-1",
                "org/plugin",
                "provider-a",
                "llm",
                "gpt-test",
                {},
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is None

        def test_validate_provider_credentials(self, mocker: MockerFixture):
            client = PluginModelClient()
            stream_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(result=True, credentials={"api_key": "new"})]),
            )
            credentials = {"api_key": "old"}

            result = client.validate_provider_credentials(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                credentials=credentials,
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is True
            assert credentials["api_key"] == "new"
            assert stream_mock.call_args.args[:2] == (
                "POST",
                "plugin/tenant-1/dispatch/model/validate_provider_credentials",
            )

        def test_validate_provider_credentials_without_dict_update(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(result=False, credentials="not-a-dict")]),
            )
            credentials = {"api_key": "same"}

            result = client.validate_provider_credentials(
                "tenant-1",
                "user-1",
                "org/plugin",
                "provider-a",
                credentials,
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is False
            assert credentials == {"api_key": "same"}

        def test_validate_provider_credentials_empty_returns_false(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            assert (
                client.validate_provider_credentials(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    {},
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
                is False
            )

        def test_validate_model_credentials(self, mocker: MockerFixture):
            client = PluginModelClient()
            stream_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(result=True, credentials={"token": "rotated"})]),
            )
            credentials = {"token": "old"}

            result = client.validate_model_credentials(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model_type="llm",
                model="gpt-test",
                credentials=credentials,
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is True
            assert credentials["token"] == "rotated"
            assert stream_mock.call_args.args[:2] == (
                "POST",
                "plugin/tenant-1/dispatch/model/validate_model_credentials",
            )

        def test_validate_model_credentials_empty_returns_false(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            assert (
                client.validate_model_credentials(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "llm",
                    "gpt-test",
                    {},
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
                is False
            )

        def test_invoke_llm(self, mocker: MockerFixture):
            client = PluginModelClient()
            stream_mock = mocker.patch.object(
                client, "_request_with_plugin_daemon_response_stream", return_value=iter(["chunk-1"])
            )

            result = list(
                client.invoke_llm(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    plugin_id="org/plugin",
                    provider="provider-a",
                    model="gpt-test",
                    credentials={"api_key": "key"},
                    prompt_messages=[],
                    model_parameters={"temperature": 0.1},
                    tools=[],
                    stop=["STOP"],
                    stream=False,
                    app_id="app-1",
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
            )

            assert result == ["chunk-1"]
            call_kwargs = stream_mock.call_args.kwargs
            assert call_kwargs["path"] == "plugin/tenant-1/dispatch/llm/invoke"
            assert call_kwargs["data"]["app_id"] == "app-1"
            assert call_kwargs["data"]["data"]["stream"] is False
            assert call_kwargs["data"]["data"]["model_parameters"] == {"temperature": 0.1}

        def test_invoke_llm_omits_app_id_when_missing(self, mocker: MockerFixture):
            client = PluginModelClient()
            stream_mock = mocker.patch.object(
                client, "_request_with_plugin_daemon_response_stream", return_value=iter([])
            )

            list(
                client.invoke_llm(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    plugin_id="org/plugin",
                    provider="provider-a",
                    model="gpt-test",
                    credentials={},
                    prompt_messages=[],
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
            )

            assert "app_id" not in stream_mock.call_args.kwargs["data"]

        def test_invoke_llm_wraps_plugin_daemon_inner_error(self, mocker: MockerFixture):
            client = PluginModelClient()

            def _boom():
                raise PluginDaemonInnerError(code=-500, message="invoke failed")
                yield  # pragma: no cover

            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=_boom())

            with pytest.raises(ValueError, match="invoke failed-500"):
                list(
                    client.invoke_llm(
                        tenant_id="tenant-1",
                        user_id="user-1",
                        plugin_id="org/plugin",
                        provider="provider-a",
                        model="gpt-test",
                        credentials={},
                        prompt_messages=[],
                        plugin_unique_identifier=PLUGIN_IDENTIFIER,
                    )
                )

        def test_start_llm_polling(self, mocker: MockerFixture):
            client = PluginModelClient()
            polling_result = LLMPollingResult(
                status=LLMPollingStatus.RUNNING,
                plugin_state={"task_id": "poll-1"},
                next_check_after_seconds=3,
            )
            request_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response",
                return_value=polling_result,
            )

            result = client.start_llm_polling(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="gpt-test",
                credentials={"api_key": "key"},
                prompt_messages=[],
                model_parameters={"temperature": 0.1},
                tools=[],
                stop=["STOP"],
                json_schema={"type": "object"},
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result == polling_result
            call_kwargs = request_mock.call_args.kwargs
            assert call_kwargs["path"] == "plugin/tenant-1/dispatch/model/polling/start"
            assert call_kwargs["data"]["data"] == {
                "provider": "provider-a",
                "model_type": "llm",
                "model": "gpt-test",
                "credentials": {"api_key": "key"},
                "prompt_messages": [],
                "model_parameters": {"temperature": 0.1},
                "tools": [],
                "stop": ["STOP"],
                "stream": False,
                "json_schema": {"type": "object"},
            }

        def test_check_llm_polling(self, mocker: MockerFixture):
            client = PluginModelClient()
            polling_result = LLMPollingResult(
                status=LLMPollingStatus.SUCCEEDED,
                result=LLMResult(
                    model="gpt-test",
                    prompt_messages=[],
                    message=AssistantPromptMessage(content="done"),
                    usage=LLMUsage.empty_usage(),
                ),
            )
            request_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response",
                return_value=polling_result,
            )

            result = client.check_llm_polling(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="gpt-test",
                credentials={"api_key": "key"},
                plugin_state={"task_id": "poll-1"},
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result == polling_result
            call_kwargs = request_mock.call_args.kwargs
            assert call_kwargs["path"] == "plugin/tenant-1/dispatch/model/polling/check"
            assert call_kwargs["data"]["data"] == {
                "provider": "provider-a",
                "model_type": "llm",
                "model": "gpt-test",
                "credentials": {"api_key": "key"},
                "plugin_state": {"task_id": "poll-1"},
            }

        def test_start_llm_polling_maps_unsupported_polling_invoke_error(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response",
                side_effect=PluginInvokeError(
                    json.dumps(
                        {
                            "error_type": PluginLLMPollingUnsupportedError.__name__,
                            "message": "Model `gpt-test` does not support polling.",
                        }
                    )
                ),
            )

            with pytest.raises(PluginLLMPollingUnsupportedError):
                client.start_llm_polling(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    plugin_id="org/plugin",
                    provider="provider-a",
                    model="gpt-test",
                    credentials={"api_key": "key"},
                    prompt_messages=[],
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )

        def test_get_llm_num_tokens(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(num_tokens=42)]),
            )

            result = client.get_llm_num_tokens(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model_type="llm",
                model="gpt-test",
                credentials={},
                prompt_messages=[],
                tools=[],
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result == 42

        def test_get_llm_num_tokens_empty_returns_zero(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            assert (
                client.get_llm_num_tokens(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "llm",
                    "gpt-test",
                    {},
                    [],
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
                == 0
            )

        def test_invoke_text_embedding(self, mocker: MockerFixture):
            client = PluginModelClient()
            embedding_result = SimpleNamespace(data=[[0.1, 0.2]])
            mocker.patch.object(
                client, "_request_with_plugin_daemon_response_stream", return_value=iter([embedding_result])
            )

            result = client.invoke_text_embedding(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="embedding-a",
                credentials={},
                texts=["hello"],
                input_type="search_document",
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is embedding_result

        def test_invoke_text_embedding_empty_raises(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            with pytest.raises(ValueError, match="Failed to invoke text embedding"):
                client.invoke_text_embedding(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "embedding-a",
                    {},
                    ["hello"],
                    "x",
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )

        def test_invoke_multimodal_embedding(self, mocker: MockerFixture):
            client = PluginModelClient()
            embedding_result = SimpleNamespace(data=[[0.3, 0.4]])
            mocker.patch.object(
                client, "_request_with_plugin_daemon_response_stream", return_value=iter([embedding_result])
            )

            result = client.invoke_multimodal_embedding(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="embedding-a",
                credentials={},
                documents=[{"type": "image", "value": "abc"}],
                input_type="search_document",
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is embedding_result

        def test_invoke_multimodal_embedding_empty_raises(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            with pytest.raises(ValueError, match="Failed to invoke file embedding"):
                client.invoke_multimodal_embedding(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "embedding-a",
                    {},
                    [{"type": "image"}],
                    "x",
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )

        def test_get_text_embedding_num_tokens(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(num_tokens=[1, 2, 3])]),
            )

            assert client.get_text_embedding_num_tokens(
                "tenant-1",
                "user-1",
                "org/plugin",
                "provider-a",
                "embedding-a",
                {},
                ["a"],
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            ) == [
                1,
                2,
                3,
            ]

        def test_get_text_embedding_num_tokens_empty_returns_list(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            assert (
                client.get_text_embedding_num_tokens(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "embedding-a",
                    {},
                    ["a"],
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
                == []
            )

        def test_invoke_rerank(self, mocker: MockerFixture):
            client = PluginModelClient()
            rerank_result = SimpleNamespace(scores=[0.9])
            mocker.patch.object(
                client, "_request_with_plugin_daemon_response_stream", return_value=iter([rerank_result])
            )

            result = client.invoke_rerank(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="rerank-a",
                credentials={},
                query="q",
                docs=["doc-1"],
                score_threshold=0.2,
                top_n=5,
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is rerank_result

        def test_invoke_rerank_empty_raises(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            with pytest.raises(ValueError, match="Failed to invoke rerank"):
                client.invoke_rerank(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "rerank-a",
                    {},
                    "q",
                    ["doc-1"],
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )

        def test_invoke_multimodal_rerank(self, mocker: MockerFixture):
            client = PluginModelClient()
            rerank_result = SimpleNamespace(scores=[0.8])
            mocker.patch.object(
                client, "_request_with_plugin_daemon_response_stream", return_value=iter([rerank_result])
            )

            result = client.invoke_multimodal_rerank(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="rerank-a",
                credentials={},
                query={"type": "text", "value": "q"},
                docs=[{"type": "image", "value": "doc"}],
                score_threshold=0.1,
                top_n=3,
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is rerank_result

        def test_invoke_multimodal_rerank_empty_raises(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            with pytest.raises(ValueError, match="Failed to invoke multimodal rerank"):
                client.invoke_multimodal_rerank(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "rerank-a",
                    {},
                    {"type": "text"},
                    [{"type": "image"}],
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )

        def test_invoke_tts(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter(
                    [
                        SimpleNamespace(result="68656c6c6f", mime_type="audio/wav"),
                        SimpleNamespace(result="21", mime_type="audio/wav"),
                    ]
                ),
            )

            result = list(
                client.invoke_tts(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    plugin_id="org/plugin",
                    provider="provider-a",
                    model="tts-a",
                    credentials={},
                    content_text="hello",
                    voice="alloy",
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
            )

            assert result == [b"hello", b"!"]
            assert [chunk.mime_type for chunk in result] == ["audio/wav", "audio/wav"]

        def test_invoke_tts_wraps_plugin_daemon_inner_error(self, mocker: MockerFixture):
            client = PluginModelClient()

            def _boom():
                raise PluginDaemonInnerError(code=-400, message="tts error")
                yield  # pragma: no cover

            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=_boom())

            with pytest.raises(ValueError, match="tts error-400"):
                list(
                    client.invoke_tts(
                        "tenant-1",
                        "user-1",
                        "org/plugin",
                        "provider-a",
                        "tts-a",
                        {},
                        "hello",
                        "alloy",
                        plugin_unique_identifier=PLUGIN_IDENTIFIER,
                    )
                )

        def test_get_tts_model_voices(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter(
                    [
                        SimpleNamespace(
                            voices=[
                                SimpleNamespace(name="Alloy", value="alloy"),
                                SimpleNamespace(name="Echo", value="echo"),
                            ]
                        )
                    ]
                ),
            )

            result = client.get_tts_model_voices(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="tts-a",
                credentials={},
                language="en",
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result == [{"name": "Alloy", "value": "alloy"}, {"name": "Echo", "value": "echo"}]

        def test_get_tts_model_voices_empty_returns_list(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            assert (
                client.get_tts_model_voices(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "tts-a",
                    {},
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )
                == []
            )

        def test_invoke_speech_to_text(self, mocker: MockerFixture):
            client = PluginModelClient()
            stream_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([PluginStringResultResponse(result="transcribed text")]),
            )

            result = client.invoke_speech_to_text(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="stt-a",
                credentials={},
                file=io.BytesIO(b"abc"),
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result == "transcribed text"
            assert stream_mock.call_args.kwargs["data"]["data"]["file"] == "616263"

        def test_invoke_speech_to_text_empty_raises(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            with pytest.raises(ValueError, match="Failed to invoke speech to text"):
                client.invoke_speech_to_text(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "stt-a",
                    {},
                    io.BytesIO(b"abc"),
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )

        def test_invoke_moderation(self, mocker: MockerFixture):
            client = PluginModelClient()
            stream_mock = mocker.patch.object(
                client,
                "_request_with_plugin_daemon_response_stream",
                return_value=iter([SimpleNamespace(result=True)]),
            )

            result = client.invoke_moderation(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin",
                provider="provider-a",
                model="moderation-a",
                credentials={},
                text="safe text",
                plugin_unique_identifier=PLUGIN_IDENTIFIER,
            )

            assert result is True
            assert stream_mock.call_args.kwargs["path"] == "plugin/tenant-1/dispatch/moderation/invoke"

        def test_invoke_moderation_empty_raises(self, mocker: MockerFixture):
            client = PluginModelClient()
            mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

            with pytest.raises(ValueError, match="Failed to invoke moderation"):
                client.invoke_moderation(
                    "tenant-1",
                    "user-1",
                    "org/plugin",
                    "provider-a",
                    "moderation-a",
                    {},
                    "unsafe",
                    plugin_unique_identifier=PLUGIN_IDENTIFIER,
                )


"""Model dispatches reuse prepared package identities without discovery I/O."""


IDENTIFIER = f"langgenius/openai:1.0.0@{'a' * 32}"


def _provider() -> PluginModelProviderDeclaration:
    return PluginModelProviderDeclaration(
        provider="langgenius/openai/openai",
        provider_name="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        plugin_unique_identifier=IDENTIFIER,
        installation_source=PluginInstallationSource.Marketplace,
    )


class TestModelDispatchBindingCases:
    from tests.unit_tests.services.plugin.conftest import mock_installer

    mock_installer = staticmethod(mock_installer)

    from tests.unit_tests.services.plugin.conftest import mock_features

    mock_features = staticmethod(mock_features)

    @staticmethod
    @pytest.mark.parametrize("binding", ["assembly", "discovery", "legacy"])
    def test_model_dispatch_does_not_discover_providers(monkeypatch: pytest.MonkeyPatch, binding: str) -> None:
        provider = _provider()
        runtime = create_plugin_model_runtime(tenant_id="tenant-a")
        if binding == "discovery":

            def fetch(
                *, tenant_id: str, client: PluginModelClient | None = None
            ) -> list[PluginModelProviderDeclaration]:
                assert tenant_id == "tenant-a"
                assert client is runtime.client
                return [provider]

            monkeypatch.setattr(PluginService, "fetch_plugin_model_providers", fetch)
            assert runtime.fetch_model_providers() == [provider]
        else:
            schema = ProviderEntity.model_validate(provider.model_dump()) if binding == "legacy" else provider
            create_model_type_instance(runtime=runtime, provider_schema=schema, model_type=ModelType.LLM)

        def unexpected_discovery(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("Invocation must reuse the prepared provider identity")

        monkeypatch.setattr(PluginService, "fetch_plugin_model_providers", unexpected_discovery)
        requests: list[httpx.Request] = []
        chunk = LLMResultChunk(
            model="model", delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="ok"))
        )

        def handle(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert request.url.path == "/plugin/tenant-a/dispatch/llm/invoke"
            requests.append(request)
            return httpx.Response(
                200, text="data: " + json.dumps({"code": 0, "message": "", "data": chunk.model_dump()})
            )

        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(client_module, "_httpx_client", client)
            result = runtime.invoke_llm(
                provider=provider.provider,
                model="model",
                credentials={"api_key": "secret"},
                model_parameters={},
                prompt_messages=[],
                tools=None,
                stop=None,
                stream=True,
            )
            assert list(result) == [chunk]

        assert len(requests) == 1
        assert requests[0].headers["X-Plugin-ID"] == "langgenius/openai"
        expected_identifier = None if binding == "legacy" else IDENTIFIER
        assert requests[0].headers.get("X-Plugin-Unique-Identifier") == expected_identifier

    @staticmethod
    def test_model_schema_cache_is_scoped_to_prepared_package() -> None:
        runtime = create_plugin_model_runtime(tenant_id="tenant-a")
        provider = _provider()
        runtime.bind_provider_schema(provider)
        first = runtime._get_schema_cache_key(
            provider=provider.provider, model_type=ModelType.LLM, model="model", credentials={}
        )
        runtime.bind_provider_schema(
            provider.model_copy(update={"plugin_unique_identifier": f"langgenius/openai:2.0.0@{'b' * 32}"})
        )
        second = runtime._get_schema_cache_key(
            provider=provider.provider, model_type=ModelType.LLM, model="model", credentials={}
        )
        assert first != second


class _TTSContractArguments(TypedDict, closed=True):
    adapter_id: str
    adapter_revision: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    expected_source_schema_digest: str


class TestSourceTTSVoiceTransport:
    """Real Core dispatch/HTTP encoding; only the key store and HTTP are fake."""

    @staticmethod
    def _contract() -> TTSVoiceContract:
        from services.entities.model_billing_mapping import model_schema_digest
        from services.model_billing_tts_adapter import (
            REVIEWED_SOURCE_MODEL,
            REVIEWED_SOURCE_PLUGIN_UID,
            REVIEWED_SOURCE_PROVIDER,
            build_tts_voice_contract,
            tts_source_voice_rules_digest,
        )

        path = Path(__file__).parents[3] / "services/fixtures/model_billing_tts_adapter_sdk_source.json"
        schema = AIModelEntity.model_validate_json(path.read_text())
        args: _TTSContractArguments = {
            "adapter_id": "tts_source_voice_v1",
            "adapter_revision": "1",
            "source_provider": REVIEWED_SOURCE_PROVIDER,
            "source_model": REVIEWED_SOURCE_MODEL,
            "source_plugin_unique_identifier": REVIEWED_SOURCE_PLUGIN_UID,
            "source_schema": schema,
            "expected_source_schema_digest": model_schema_digest(schema),
        }
        contract = build_tts_voice_contract(**args, expected_rules_digest=tts_source_voice_rules_digest(**args))
        assert contract is not None
        return contract

    @classmethod
    def _plan(cls) -> FrozenModelInvocation:
        return FrozenModelInvocation(
            tenant_id="tenant-a",
            route_id="route-a",
            logical_provider="langgenius/openai/openai",
            logical_model="gpt-4o-mini-tts-2025-12-15",
            model_type=ModelType.TTS,
            route_epoch=2,
            mapping_revision="new-tts-voice-v1",
            credential_id="managed-id",
            expected_credential_fingerprint="fingerprint",
            plugin_unique_identifier="langgenius/tokener:0.4.3-dev4@" + "a" * 64,
            target_model="gpt-4o-mini-tts-2025-12-15",
            operations=("tts/invoke",),
            tts_voice_contract=cls._contract(),
        )

    @pytest.mark.parametrize(
        "voice",
        [
            "",
            "invalid",
            "alloy",
            "ash",
            "ballad",
            "coral",
            "echo",
            "fable",
            "onyx",
            "nova",
            "sage",
            "shimmer",
            "verse",
            "marin",
            "cedar",
        ],
    )
    def test_prepared_redirect_keeps_logical_identity_and_source_voice(
        self, monkeypatch: pytest.MonkeyPatch, voice: str
    ) -> None:
        from core import model_invocation_routing as routing

        plan = self._plan()
        contract = plan.tts_voice_contract
        assert contract is not None
        credentials = routing.RoutedModelCredentials(plan)
        monkeypatch.setattr(routing, "managed_credentials", lambda _plan: {"api_key": "offline-managed-key"})
        captured = []

        def handle(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/plugin/tenant-a/dispatch/redirect/v1/tts/invoke"
            body = json.loads(request.content)
            captured.append(body)
            assert body["data"]["voice"] == (voice if voice in contract.voices else "alloy")
            assert body["data"]["credentials"] == {}
            assert body["data"]["provider"] == "openai"
            assert body["data"]["model"] == plan.logical_model
            assert body["redirect"]["target"]["model"] == plan.target_model
            assert body["redirect"]["target"]["expected_unique_identifier"] == plan.plugin_unique_identifier
            assert "tts_voice_contract" not in body
            assert "parameter_adapter" not in body
            return httpx.Response(
                200, text='data: {"code":0,"message":"","data":{"result":"00ff","mime_type":"audio/mpeg"}}'
            )

        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(client_module, "_httpx_client", client)
            chunks = list(
                PluginModelClient().invoke_tts(
                    "tenant-a",
                    None,
                    "langgenius/openai",
                    "openai",
                    plan.logical_model,
                    credentials,
                    "Unchanged source text.",
                    voice,
                    plugin_unique_identifier=contract.source_plugin_unique_identifier,
                )
            )
        assert len(captured) == 1
        assert chunks[0] == b"\x00\xff"
        assert credentials.plan is plan
        assert dict(credentials) == {}

    @pytest.mark.parametrize("kind", ["old-identity", "custom-byok", "native-tokener"])
    def test_non_opted_in_paths_keep_empty_voice(self, monkeypatch: pytest.MonkeyPatch, kind: str) -> None:
        from core import model_invocation_routing as routing

        plan = replace(self._plan(), tts_voice_contract=None)
        monkeypatch.setattr(routing, "managed_credentials", lambda _plan: {"api_key": "offline-managed-key"})
        credentials = routing.RoutedModelCredentials(plan) if kind == "old-identity" else {"api_key": "offline-custom"}
        provider = "tokener" if kind == "native-tokener" else "openai"
        captured = []

        def handle(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            captured.append(body)
            assert body["data"]["voice"] == ""
            assert ("redirect" in body) == (kind == "old-identity")
            return httpx.Response(200, text='data: {"code":0,"message":"","data":{"result":"00ff"}}')

        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(client_module, "_httpx_client", client)
            list(
                PluginModelClient().invoke_tts(
                    "tenant-a",
                    None,
                    f"langgenius/{provider}",
                    provider,
                    plan.logical_model,
                    credentials,
                    "Unchanged text.",
                    "",
                )
            )
        assert len(captured) == 1

    @pytest.mark.parametrize("voice", ["", "nova"])
    def test_constructed_tts_wrapper_binds_source_uid_through_runtime(
        self, monkeypatch: pytest.MonkeyPatch, voice: str
    ) -> None:
        from core import model_invocation_routing as routing
        from graphon.model_runtime.model_providers.base.tts_model import TTSModel

        plan = self._plan()
        contract = plan.tts_voice_contract
        assert contract is not None
        provider = PluginModelProviderDeclaration(
            provider=plan.logical_provider,
            provider_name="openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.TTS],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            plugin_unique_identifier=contract.source_plugin_unique_identifier,
            installation_source=PluginInstallationSource.Marketplace,
        )
        runtime = create_plugin_model_runtime(tenant_id="tenant-a")
        model = create_model_type_instance(runtime=runtime, provider_schema=provider, model_type=ModelType.TTS)
        assert isinstance(model, TTSModel)
        monkeypatch.setattr(routing, "managed_credentials", lambda _plan: {"api_key": "offline-managed-key"})
        requests: list[httpx.Request] = []

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            assert request.url.path == "/plugin/tenant-a/dispatch/redirect/v1/tts/invoke"
            assert request.headers["X-Plugin-Unique-Identifier"] == contract.source_plugin_unique_identifier
            body = json.loads(request.content)
            assert body["data"]["voice"] == (voice or "alloy")
            assert body["data"]["provider"] == "openai"
            assert body["data"]["model"] == plan.logical_model
            assert body["redirect"]["target"]["expected_unique_identifier"] == plan.plugin_unique_identifier
            return httpx.Response(200, text='data: {"code":0,"message":"","data":{"result":"00ff"}}')

        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(client_module, "_httpx_client", client)
            # No source UID is supplied to invoke: normal factory/runtime binding
            # must carry it through the real wrapper and client, or the hook fails.
            chunks = list(model.invoke(plan.logical_model, routing.RoutedModelCredentials(plan), "Hello.", voice))
        assert len(requests) == 1
        assert chunks[0].data == b"\x00\xff"

    @pytest.mark.parametrize(("wrong_source", "source_uid"), [(True, None), (False, None), (False, "wrong-source-uid")])
    def test_wrong_source_binding_cannot_use_voice_contract(
        self, monkeypatch: pytest.MonkeyPatch, wrong_source: bool, source_uid: str | None
    ) -> None:
        from core import model_invocation_routing as routing

        plan = self._plan()
        contract = plan.tts_voice_contract
        assert contract is not None
        if wrong_source:
            plan = replace(plan, logical_model="tts-1")
            source_uid = contract.source_plugin_unique_identifier
        credentials = routing.RoutedModelCredentials(plan)

        def unexpected(_request: httpx.Request) -> httpx.Response:
            raise AssertionError("Invalid source contract must fail before any network request")

        with httpx.Client(transport=httpx.MockTransport(unexpected)) as client:
            monkeypatch.setattr(client_module, "_httpx_client", client)
            with pytest.raises(routing.ModelRouteUnavailable):
                list(
                    PluginModelClient().invoke_tts(
                        "tenant-a",
                        None,
                        "langgenius/openai",
                        "openai",
                        plan.logical_model,
                        credentials,
                        "Text.",
                        "",
                        plugin_unique_identifier=source_uid,
                    )
                )
