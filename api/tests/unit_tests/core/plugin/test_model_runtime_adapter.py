"""Unit tests for the plugin-backed model runtime adapter."""

import datetime
import uuid
from unittest.mock import Mock, sentinel

import pytest

from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity


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
        assert providers[0].label.en_US == "OpenAI"
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
        client.invoke_llm.return_value = sentinel.result
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

        assert result is sentinel.result
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
