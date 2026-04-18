from __future__ import annotations

import io
from types import SimpleNamespace

import pytest

from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.model import PluginModelClient


class TestPluginModelClient:
    def test_fetch_model_providers(self, mocker):
        client = PluginModelClient()
        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", return_value=["provider-a"])

        result = client.fetch_model_providers("tenant-1")

        assert result == ["provider-a"]
        assert request_mock.call_args.args[:2] == (
            "GET",
            "plugin/tenant-1/management/models",
        )
        assert request_mock.call_args.kwargs["params"] == {"page": 1, "page_size": 256}

    def test_get_model_schema(self, mocker):
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
            plugin_id="org/plugin:1",
            provider="provider-a",
            model_type="llm",
            model="gpt-test",
            credentials={"api_key": "key"},
        )

        assert result is schema
        assert stream_mock.call_args.args[:2] == ("POST", "plugin/tenant-1/dispatch/model/schema")

    def test_get_model_schema_empty_stream_returns_none(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        result = client.get_model_schema("tenant-1", "user-1", "org/plugin:1", "provider-a", "llm", "gpt-test", {})

        assert result is None

    def test_validate_provider_credentials(self, mocker):
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
            plugin_id="org/plugin:1",
            provider="provider-a",
            credentials=credentials,
        )

        assert result is True
        assert credentials["api_key"] == "new"
        assert stream_mock.call_args.args[:2] == (
            "POST",
            "plugin/tenant-1/dispatch/model/validate_provider_credentials",
        )

    def test_validate_provider_credentials_without_dict_update(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(result=False, credentials="not-a-dict")]),
        )
        credentials = {"api_key": "same"}

        result = client.validate_provider_credentials("tenant-1", "user-1", "org/plugin:1", "provider-a", credentials)

        assert result is False
        assert credentials == {"api_key": "same"}

    def test_validate_provider_credentials_empty_returns_false(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        assert client.validate_provider_credentials("tenant-1", "user-1", "org/plugin:1", "provider-a", {}) is False

    def test_validate_model_credentials(self, mocker):
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
            plugin_id="org/plugin:1",
            provider="provider-a",
            model_type="llm",
            model="gpt-test",
            credentials=credentials,
        )

        assert result is True
        assert credentials["token"] == "rotated"
        assert stream_mock.call_args.args[:2] == (
            "POST",
            "plugin/tenant-1/dispatch/model/validate_model_credentials",
        )

    def test_validate_model_credentials_empty_returns_false(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        assert (
            client.validate_model_credentials("tenant-1", "user-1", "org/plugin:1", "provider-a", "llm", "gpt-test", {})
            is False
        )

    def test_invoke_llm(self, mocker):
        client = PluginModelClient()
        stream_mock = mocker.patch.object(
            client, "_request_with_plugin_daemon_response_stream", return_value=iter(["chunk-1"])
        )

        result = list(
            client.invoke_llm(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin:1",
                provider="provider-a",
                model="gpt-test",
                credentials={"api_key": "key"},
                prompt_messages=[],
                model_parameters={"temperature": 0.1},
                tools=[],
                stop=["STOP"],
                stream=False,
            )
        )

        assert result == ["chunk-1"]
        call_kwargs = stream_mock.call_args.kwargs
        assert call_kwargs["path"] == "plugin/tenant-1/dispatch/llm/invoke"
        assert call_kwargs["data"]["data"]["stream"] is False
        assert call_kwargs["data"]["data"]["model_parameters"] == {"temperature": 0.1}

    def test_invoke_llm_wraps_plugin_daemon_inner_error(self, mocker):
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
                    plugin_id="org/plugin:1",
                    provider="provider-a",
                    model="gpt-test",
                    credentials={},
                    prompt_messages=[],
                )
            )

    def test_get_llm_num_tokens(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(num_tokens=42)]),
        )

        result = client.get_llm_num_tokens(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model_type="llm",
            model="gpt-test",
            credentials={},
            prompt_messages=[],
            tools=[],
        )

        assert result == 42

    def test_get_llm_num_tokens_empty_returns_zero(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        assert (
            client.get_llm_num_tokens("tenant-1", "user-1", "org/plugin:1", "provider-a", "llm", "gpt-test", {}, [])
            == 0
        )

    def test_invoke_text_embedding(self, mocker):
        client = PluginModelClient()
        embedding_result = SimpleNamespace(data=[[0.1, 0.2]])
        mocker.patch.object(
            client, "_request_with_plugin_daemon_response_stream", return_value=iter([embedding_result])
        )

        result = client.invoke_text_embedding(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="embedding-a",
            credentials={},
            texts=["hello"],
            input_type="search_document",
        )

        assert result is embedding_result

    def test_invoke_text_embedding_empty_raises(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Failed to invoke text embedding"):
            client.invoke_text_embedding(
                "tenant-1", "user-1", "org/plugin:1", "provider-a", "embedding-a", {}, ["hello"], "x"
            )

    def test_invoke_multimodal_embedding(self, mocker):
        client = PluginModelClient()
        embedding_result = SimpleNamespace(data=[[0.3, 0.4]])
        mocker.patch.object(
            client, "_request_with_plugin_daemon_response_stream", return_value=iter([embedding_result])
        )

        result = client.invoke_multimodal_embedding(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="embedding-a",
            credentials={},
            documents=[{"type": "image", "value": "abc"}],
            input_type="search_document",
        )

        assert result is embedding_result

    def test_invoke_multimodal_embedding_empty_raises(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Failed to invoke file embedding"):
            client.invoke_multimodal_embedding(
                "tenant-1", "user-1", "org/plugin:1", "provider-a", "embedding-a", {}, [{"type": "image"}], "x"
            )

    def test_get_text_embedding_num_tokens(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(num_tokens=[1, 2, 3])]),
        )

        assert client.get_text_embedding_num_tokens(
            "tenant-1", "user-1", "org/plugin:1", "provider-a", "embedding-a", {}, ["a"]
        ) == [
            1,
            2,
            3,
        ]

    def test_get_text_embedding_num_tokens_empty_returns_list(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        assert (
            client.get_text_embedding_num_tokens(
                "tenant-1", "user-1", "org/plugin:1", "provider-a", "embedding-a", {}, ["a"]
            )
            == []
        )

    def test_invoke_rerank(self, mocker):
        client = PluginModelClient()
        rerank_result = SimpleNamespace(scores=[0.9])
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([rerank_result]))

        result = client.invoke_rerank(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="rerank-a",
            credentials={},
            query="q",
            docs=["doc-1"],
            score_threshold=0.2,
            top_n=5,
        )

        assert result is rerank_result

    def test_invoke_rerank_empty_raises(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Failed to invoke rerank"):
            client.invoke_rerank("tenant-1", "user-1", "org/plugin:1", "provider-a", "rerank-a", {}, "q", ["doc-1"])

    def test_invoke_multimodal_rerank(self, mocker):
        client = PluginModelClient()
        rerank_result = SimpleNamespace(scores=[0.8])
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([rerank_result]))

        result = client.invoke_multimodal_rerank(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="rerank-a",
            credentials={},
            query={"type": "text", "value": "q"},
            docs=[{"type": "image", "value": "doc"}],
            score_threshold=0.1,
            top_n=3,
        )

        assert result is rerank_result

    def test_invoke_multimodal_rerank_empty_raises(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Failed to invoke multimodal rerank"):
            client.invoke_multimodal_rerank(
                "tenant-1",
                "user-1",
                "org/plugin:1",
                "provider-a",
                "rerank-a",
                {},
                {"type": "text"},
                [{"type": "image"}],
            )

    def test_invoke_tts(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(result="68656c6c6f"), SimpleNamespace(result="21")]),
        )

        result = list(
            client.invoke_tts(
                tenant_id="tenant-1",
                user_id="user-1",
                plugin_id="org/plugin:1",
                provider="provider-a",
                model="tts-a",
                credentials={},
                content_text="hello",
                voice="alloy",
            )
        )

        assert result == [b"hello", b"!"]

    def test_invoke_tts_wraps_plugin_daemon_inner_error(self, mocker):
        client = PluginModelClient()

        def _boom():
            raise PluginDaemonInnerError(code=-400, message="tts error")
            yield  # pragma: no cover

        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=_boom())

        with pytest.raises(ValueError, match="tts error-400"):
            list(client.invoke_tts("tenant-1", "user-1", "org/plugin:1", "provider-a", "tts-a", {}, "hello", "alloy"))

    def test_get_tts_model_voices(self, mocker):
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
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="tts-a",
            credentials={},
            language="en",
        )

        assert result == [{"name": "Alloy", "value": "alloy"}, {"name": "Echo", "value": "echo"}]

    def test_get_tts_model_voices_empty_returns_list(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        assert client.get_tts_model_voices("tenant-1", "user-1", "org/plugin:1", "provider-a", "tts-a", {}) == []

    def test_invoke_speech_to_text(self, mocker):
        client = PluginModelClient()
        stream_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(result="transcribed text")]),
        )

        result = client.invoke_speech_to_text(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="stt-a",
            credentials={},
            file=io.BytesIO(b"abc"),
        )

        assert result == "transcribed text"
        assert stream_mock.call_args.kwargs["data"]["data"]["file"] == "616263"

    def test_invoke_speech_to_text_empty_raises(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Failed to invoke speech to text"):
            client.invoke_speech_to_text(
                "tenant-1", "user-1", "org/plugin:1", "provider-a", "stt-a", {}, io.BytesIO(b"abc")
            )

    def test_invoke_moderation(self, mocker):
        client = PluginModelClient()
        stream_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(result=True)]),
        )

        result = client.invoke_moderation(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin:1",
            provider="provider-a",
            model="moderation-a",
            credentials={},
            text="safe text",
        )

        assert result is True
        assert stream_mock.call_args.kwargs["path"] == "plugin/tenant-1/dispatch/moderation/invoke"

    def test_invoke_moderation_empty_raises(self, mocker):
        client = PluginModelClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="Failed to invoke moderation"):
            client.invoke_moderation("tenant-1", "user-1", "org/plugin:1", "provider-a", "moderation-a", {}, "unsafe")
