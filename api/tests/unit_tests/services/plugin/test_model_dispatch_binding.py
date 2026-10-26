"""Model dispatches reuse prepared package identities without discovery I/O."""

import json

import httpx
import pytest

from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl import base as client_module
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime_factory import create_model_type_instance, create_plugin_model_runtime
from core.plugin.plugin_service import PluginService
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity

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


@pytest.mark.parametrize("binding", ["assembly", "discovery", "legacy"])
def test_model_dispatch_does_not_discover_providers(monkeypatch: pytest.MonkeyPatch, binding: str) -> None:
    provider = _provider()
    runtime = create_plugin_model_runtime(tenant_id="tenant-a")
    if binding == "discovery":

        def fetch(*, tenant_id: str, client: PluginModelClient | None = None) -> list[PluginModelProviderDeclaration]:
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
        return httpx.Response(200, text="data: " + json.dumps({"code": 0, "message": "", "data": chunk.model_dump()}))

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
