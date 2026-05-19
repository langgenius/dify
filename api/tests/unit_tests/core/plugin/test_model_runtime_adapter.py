"""Unit tests for the plugin-backed model runtime adapter."""

import datetime
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch, sentinel

import pytest

from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.plugin.impl import model_runtime as model_runtime_module
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import TENANT_SCOPE_SCHEMA_CACHE_USER_ID, PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity


def _build_model_schema() -> AIModelEntity:
    return AIModelEntity(
        model="gpt-4o-mini",
        label=I18nObject(en_US="GPT-4o mini"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )


class TestPluginModelRuntime:
    """Validate the adapter keeps plugin-specific routing out of the runtime port."""

    def test_fetch_model_providers_returns_runtime_entities(self) -> None:
        client = Mock(spec=PluginModelClient)
        client.fetch_model_providers.return_value = [
            PluginModelProviderEntity(
                id=uuid.uuid4().hex,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                provider="openai",
                tenant_id="tenant",
                plugin_unique_identifier="langgenius/openai/openai",
                plugin_id="langgenius/openai",
                declaration=ProviderEntity(
                    provider="openai",
                    label=I18nObject(en_US="OpenAI"),
                    supported_model_types=[],
                    configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
                ),
            )
        ]
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        providers = runtime.fetch_model_providers()

        assert len(providers) == 1
        assert providers[0].provider == "langgenius/openai/openai"
        assert providers[0].provider_name == "openai"
        assert providers[0].label.en_us == "OpenAI"
        client.fetch_model_providers.assert_called_once_with("tenant")

    def test_fetch_model_providers_only_exposes_short_name_for_canonical_provider(self) -> None:
        client = Mock(spec=PluginModelClient)
        client.fetch_model_providers.return_value = [
            PluginModelProviderEntity(
                id=uuid.uuid4().hex,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                provider="openai",
                tenant_id="tenant",
                plugin_unique_identifier="acme/openai/openai",
                plugin_id="acme/openai",
                declaration=ProviderEntity(
                    provider="openai",
                    label=I18nObject(en_US="Acme OpenAI"),
                    supported_model_types=[],
                    configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
                ),
            ),
            PluginModelProviderEntity(
                id=uuid.uuid4().hex,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                provider="openai",
                tenant_id="tenant",
                plugin_unique_identifier="langgenius/openai/openai",
                plugin_id="langgenius/openai",
                declaration=ProviderEntity(
                    provider="openai",
                    label=I18nObject(en_US="OpenAI"),
                    supported_model_types=[],
                    configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
                ),
            ),
        ]
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        providers = runtime.fetch_model_providers()

        provider_aliases = {provider.provider: provider.provider_name for provider in providers}
        assert provider_aliases["acme/openai/openai"] == ""
        assert provider_aliases["langgenius/openai/openai"] == "openai"

    def test_fetch_model_providers_keeps_google_alias_on_canonical_gemini_provider(self) -> None:
        client = Mock(spec=PluginModelClient)
        client.fetch_model_providers.return_value = [
            PluginModelProviderEntity(
                id=uuid.uuid4().hex,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                provider="google",
                tenant_id="tenant",
                plugin_unique_identifier="langgenius/gemini/google",
                plugin_id="langgenius/gemini",
                declaration=ProviderEntity(
                    provider="google",
                    label=I18nObject(en_US="Google"),
                    supported_model_types=[],
                    configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
                ),
            )
        ]
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        providers = runtime.fetch_model_providers()

        assert providers[0].provider == "langgenius/gemini/google"
        assert providers[0].provider_name == "google"

    def test_validate_provider_credentials_resolves_plugin_fields(self) -> None:
        client = Mock(spec=PluginModelClient)
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        runtime.validate_provider_credentials(
            provider="langgenius/openai/openai",
            credentials={"api_key": "secret"},
        )

        client.validate_provider_credentials.assert_called_once_with(
            tenant_id="tenant",
            user_id="user",
            plugin_id="langgenius/openai",
            provider="openai",
            credentials={"api_key": "secret"},
        )

    def test_invoke_llm_resolves_plugin_fields(self) -> None:
        client = Mock(spec=PluginModelClient)
        usage = LLMUsage.empty_usage()
        client.invoke_llm.return_value = iter(
            [
                LLMResultChunk(
                    model="gpt-4o-mini",
                    prompt_messages=[],
                    system_fingerprint="fp-plugin",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="plugin "),
                    ),
                ),
                LLMResultChunk(
                    model="gpt-4o-mini",
                    prompt_messages=[],
                    system_fingerprint="fp-plugin",
                    delta=LLMResultChunkDelta(
                        index=1,
                        message=AssistantPromptMessage(content="response"),
                        usage=usage,
                        finish_reason="stop",
                    ),
                ),
            ]
        )
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        result = runtime.invoke_llm(
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            model_parameters={"temperature": 0.3},
            prompt_messages=[],
            tools=None,
            stop=None,
            stream=False,
        )

        assert result.model == "gpt-4o-mini"
        assert result.prompt_messages == []
        assert result.message.content == "plugin response"
        assert result.usage == usage
        assert result.system_fingerprint == "fp-plugin"
        client.invoke_llm.assert_called_once_with(
            tenant_id="tenant",
            user_id="user",
            plugin_id="langgenius/openai",
            provider="openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            model_parameters={"temperature": 0.3},
            prompt_messages=[],
            tools=None,
            stop=None,
            stream=False,
        )

    def test_invoke_llm_returns_plugin_stream_directly(self) -> None:
        client = Mock(spec=PluginModelClient)
        stream_result = iter([])
        client.invoke_llm.return_value = stream_result
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        result = runtime.invoke_llm(
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            model_parameters={"temperature": 0.3},
            prompt_messages=[],
            tools=None,
            stop=("END",),
            stream=True,
        )

        assert result is stream_result
        client.invoke_llm.assert_called_once_with(
            tenant_id="tenant",
            user_id="user",
            plugin_id="langgenius/openai",
            provider="openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            model_parameters={"temperature": 0.3},
            prompt_messages=[],
            tools=None,
            stop=["END"],
            stream=True,
        )

    def test_invoke_llm_rejects_per_call_user_override(self) -> None:
        client = Mock(spec=PluginModelClient)
        client.invoke_llm.return_value = sentinel.result
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="bound-user", client=client)

        with pytest.raises(TypeError, match="unexpected keyword argument 'user_id'"):
            runtime.invoke_llm(  # type: ignore[call-arg]
                provider="langgenius/openai/openai",
                model="gpt-4o-mini",
                credentials={"api_key": "secret"},
                model_parameters={"temperature": 0.3},
                prompt_messages=[],
                tools=None,
                stop=None,
                stream=False,
                user_id="request-user",
            )

        client.invoke_llm.assert_not_called()

    def test_invoke_tts_uses_bound_runtime_user_when_runtime_is_unbound(self) -> None:
        client = Mock(spec=PluginModelClient)
        client.invoke_tts.return_value = iter([b"chunk"])
        runtime = PluginModelRuntime(tenant_id="tenant", user_id=None, client=client)

        result = runtime.invoke_tts(
            provider="langgenius/openai/openai",
            model="tts-1",
            credentials={"api_key": "secret"},
            content_text="hello",
            voice="alloy",
        )

        assert list(result) == [b"chunk"]
        client.invoke_tts.assert_called_once_with(
            tenant_id="tenant",
            user_id=None,
            plugin_id="langgenius/openai",
            provider="openai",
            model="tts-1",
            credentials={"api_key": "secret"},
            content_text="hello",
            voice="alloy",
        )

    def test_fetch_model_providers_uses_bound_runtime_cache(self) -> None:
        client = Mock(spec=PluginModelClient)
        client.fetch_model_providers.return_value = []
        runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

        runtime.fetch_model_providers()
        runtime.fetch_model_providers()

        client.fetch_model_providers.assert_called_once_with("tenant")


def test_create_plugin_model_runtime_without_user_context() -> None:
    runtime = create_plugin_model_runtime(tenant_id="tenant")

    assert runtime.user_id is None


def test_plugin_model_runtime_requires_client() -> None:
    with pytest.raises(ValueError, match="client is required"):
        PluginModelRuntime(tenant_id="tenant", user_id="user", client=None)  # type: ignore[arg-type]


def test_get_model_schema_uses_cached_schema_without_hitting_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock(spec=PluginModelClient)
    schema = _build_model_schema()
    monkeypatch.setattr(
        model_runtime_module,
        "redis_client",
        SimpleNamespace(
            get=Mock(return_value=schema.model_dump_json()),
            delete=Mock(),
            setex=Mock(),
        ),
    )

    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)
    result = runtime.get_model_schema(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )

    assert result == schema
    client.get_model_schema.assert_not_called()


def test_structured_output_adapter_invokes_bound_runtime_streaming() -> None:
    runtime = Mock()
    runtime.invoke_llm.return_value = sentinel.stream_result
    adapter = model_runtime_module._PluginStructuredOutputModelInstance(
        runtime=runtime,
        provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )
    tool = Mock()

    result = adapter.invoke_llm(
        prompt_messages=[],
        model_parameters=None,
        tools=[tool],
        stop=["END"],
        stream=True,
        callbacks=sentinel.callbacks,
    )

    assert result is sentinel.stream_result
    runtime.invoke_llm.assert_called_once_with(
        provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
        model_parameters={},
        prompt_messages=[],
        tools=[tool],
        stop=["END"],
        stream=True,
    )


def test_structured_output_adapter_invokes_bound_runtime_non_streaming() -> None:
    runtime = Mock()
    runtime.invoke_llm.return_value = sentinel.result
    adapter = model_runtime_module._PluginStructuredOutputModelInstance(
        runtime=runtime,
        provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )

    result = adapter.invoke_llm(
        prompt_messages=[],
        model_parameters={"temperature": 0},
        tools=None,
        stop=None,
        stream=False,
    )

    assert result is sentinel.result
    runtime.invoke_llm.assert_called_once_with(
        provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
        model_parameters={"temperature": 0},
        prompt_messages=[],
        tools=None,
        stop=None,
        stream=False,
    )


def test_invoke_llm_with_structured_output_delegates_with_bound_adapter() -> None:
    client = Mock(spec=PluginModelClient)
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)
    schema = _build_model_schema()
    runtime.get_model_schema = Mock(return_value=schema)  # type: ignore[method-assign]

    with patch.object(
        model_runtime_module,
        "invoke_llm_with_structured_output_helper",
        return_value=sentinel.structured_result,
    ) as mock_helper:
        result = runtime.invoke_llm_with_structured_output(
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            json_schema={"type": "object"},
            model_parameters={"temperature": 0},
            prompt_messages=[],
            stop=("END",),
            stream=False,
        )

    assert result is sentinel.structured_result
    runtime.get_model_schema.assert_called_once_with(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )
    helper_kwargs = mock_helper.call_args.kwargs
    assert helper_kwargs["provider"] == "langgenius/openai/openai"
    assert helper_kwargs["model_schema"] == schema
    assert helper_kwargs["json_schema"] == {"type": "object"}
    assert helper_kwargs["model_parameters"] == {"temperature": 0}
    assert helper_kwargs["prompt_messages"] == []
    assert helper_kwargs["tools"] is None
    assert helper_kwargs["stop"] == ["END"]
    assert helper_kwargs["stream"] is False
    assert isinstance(helper_kwargs["model_instance"], model_runtime_module._PluginStructuredOutputModelInstance)


def test_invoke_llm_with_structured_output_raises_when_model_schema_is_missing() -> None:
    client = Mock(spec=PluginModelClient)
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)
    runtime.get_model_schema = Mock(return_value=None)  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="Model schema not found for gpt-4o-mini"):
        runtime.invoke_llm_with_structured_output(
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            json_schema={"type": "object"},
            model_parameters={},
            prompt_messages=[],
            stop=None,
            stream=False,
        )


def test_get_model_schema_deletes_invalid_cache_and_refetches(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock(spec=PluginModelClient)
    schema = _build_model_schema()
    delete = Mock()
    setex = Mock()
    monkeypatch.setattr(
        model_runtime_module,
        "redis_client",
        SimpleNamespace(
            get=Mock(return_value="not-json"),
            delete=delete,
            setex=setex,
        ),
    )
    monkeypatch.setattr(model_runtime_module.dify_config, "PLUGIN_MODEL_SCHEMA_CACHE_TTL", 300)
    client.get_model_schema.return_value = schema
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

    result = runtime.get_model_schema(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )

    assert result == schema
    delete.assert_called_once()
    client.get_model_schema.assert_called_once_with(
        tenant_id="tenant",
        user_id="user",
        plugin_id="langgenius/openai",
        provider="openai",
        model_type=ModelType.LLM.value,
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )
    setex.assert_called_once()


def test_get_llm_num_tokens_returns_zero_when_plugin_counting_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock(spec=PluginModelClient)
    monkeypatch.setattr(model_runtime_module.dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", False)
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

    assert (
        runtime.get_llm_num_tokens(
            provider="langgenius/openai/openai",
            model_type=ModelType.LLM,
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            prompt_messages=[],
            tools=None,
        )
        == 0
    )
    client.get_llm_num_tokens.assert_not_called()


def test_get_provider_icon_reads_requested_variant_and_detects_svg_mime(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock(spec=PluginModelClient)
    client.fetch_model_providers.return_value = [
        PluginModelProviderEntity(
            id=uuid.uuid4().hex,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            provider="openai",
            tenant_id="tenant",
            plugin_unique_identifier="langgenius/openai/openai",
            plugin_id="langgenius/openai",
            declaration=ProviderEntity(
                provider="openai",
                label=I18nObject(en_US="OpenAI"),
                icon_small=I18nObject(en_US="logo.svg"),
                icon_small_dark=I18nObject(en_US="logo-dark.png"),
                supported_model_types=[],
                configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            ),
        )
    ]
    fetch_asset = Mock(return_value=b"<svg></svg>")
    monkeypatch.setattr(model_runtime_module.PluginAssetManager, "fetch_asset", fetch_asset)
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

    icon_bytes, mime_type = runtime.get_provider_icon(
        provider="langgenius/openai/openai",
        icon_type="icon_small",
        lang="en_US",
    )

    assert icon_bytes == b"<svg></svg>"
    assert mime_type == "image/svg+xml"
    fetch_asset.assert_called_once_with(tenant_id="tenant", id="logo.svg")


def test_get_provider_icon_rejects_unsupported_types_and_missing_variants() -> None:
    client = Mock(spec=PluginModelClient)
    client.fetch_model_providers.return_value = [
        PluginModelProviderEntity(
            id=uuid.uuid4().hex,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            provider="openai",
            tenant_id="tenant",
            plugin_unique_identifier="langgenius/openai/openai",
            plugin_id="langgenius/openai",
            declaration=ProviderEntity(
                provider="openai",
                label=I18nObject(en_US="OpenAI"),
                supported_model_types=[],
                configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            ),
        )
    ]
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

    with pytest.raises(ValueError, match="does not have small dark icon"):
        runtime.get_provider_icon(
            provider="langgenius/openai/openai",
            icon_type="icon_small_dark",
            lang="en_US",
        )

    with pytest.raises(ValueError, match="Unsupported icon type"):
        runtime.get_provider_icon(
            provider="langgenius/openai/openai",
            icon_type="icon_large",
            lang="en_US",
        )


def test_get_schema_cache_key_is_stable_across_credential_order() -> None:
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=Mock(spec=PluginModelClient))

    first = runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"b": "2", "a": "1"},
    )
    second = runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"a": "1", "b": "2"},
    )

    assert first == second


def test_get_schema_cache_key_separates_distinct_user_scopes() -> None:
    first_runtime = PluginModelRuntime(tenant_id="tenant", user_id="user-a", client=Mock(spec=PluginModelClient))
    second_runtime = PluginModelRuntime(tenant_id="tenant", user_id="user-b", client=Mock(spec=PluginModelClient))

    first = first_runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"a": "1"},
    )
    second = second_runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"a": "1"},
    )

    assert first != second


def test_get_schema_cache_key_separates_tenant_scope_from_user_scope() -> None:
    tenant_runtime = PluginModelRuntime(tenant_id="tenant", user_id=None, client=Mock(spec=PluginModelClient))
    user_runtime = PluginModelRuntime(tenant_id="tenant", user_id="user-a", client=Mock(spec=PluginModelClient))

    tenant_key = tenant_runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"a": "1"},
    )
    user_key = user_runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"a": "1"},
    )

    assert tenant_key != user_key
    assert f":{TENANT_SCOPE_SCHEMA_CACHE_USER_ID}" in tenant_key


def test_get_schema_cache_key_separates_tenant_scope_from_empty_string_user_scope() -> None:
    tenant_runtime = PluginModelRuntime(tenant_id="tenant", user_id=None, client=Mock(spec=PluginModelClient))
    empty_user_runtime = PluginModelRuntime(tenant_id="tenant", user_id="", client=Mock(spec=PluginModelClient))

    tenant_key = tenant_runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={},
    )
    empty_user_key = empty_user_runtime._get_schema_cache_key(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={},
    )

    assert tenant_key != empty_user_key
    assert empty_user_key.endswith(":")
    assert TENANT_SCOPE_SCHEMA_CACHE_USER_ID not in empty_user_key


def test_get_provider_schema_supports_short_alias_and_rejects_invalid_provider() -> None:
    client = Mock(spec=PluginModelClient)
    client.fetch_model_providers.return_value = [
        PluginModelProviderEntity(
            id=uuid.uuid4().hex,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            provider="openai",
            tenant_id="tenant",
            plugin_unique_identifier="langgenius/openai/openai",
            plugin_id="langgenius/openai",
            declaration=ProviderEntity(
                provider="openai",
                label=I18nObject(en_US="OpenAI"),
                supported_model_types=[],
                configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            ),
        )
    ]
    runtime = PluginModelRuntime(tenant_id="tenant", user_id="user", client=client)

    assert runtime._get_provider_schema("openai").provider == "langgenius/openai/openai"

    with pytest.raises(ValueError, match="Invalid provider"):
        runtime._get_provider_schema("missing")
