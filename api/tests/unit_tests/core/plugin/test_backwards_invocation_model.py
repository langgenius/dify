import json
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest

from core.entities.embedding_type import EmbeddingInputType
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.model_manager import ModelInstance
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from core.plugin.entities.request import (
    InvokableModelTokenLimits,
    RequestInvokeMultimodalEmbedding,
    RequestInvokeRerank,
    RequestInvokeSummary,
    RequestInvokeTextEmbedding,
    RequestInvokeTTS,
    RequestListModels,
)
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
)
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.model_providers.base.tts_model import TTSModel
from graphon.model_runtime.protocols.tts_runtime import TTSChunk
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


def _tenant() -> Tenant:
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    return tenant


@dataclass
class _RecordingModelInstance:
    """Bound model instance double: returns a canned result and records invocation kwargs."""

    result: str
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def invoke_text_embedding(self, **kwargs: object) -> str:
        self.calls.append(("invoke_text_embedding", kwargs))
        return self.result

    def invoke_multimodal_embedding(self, **kwargs: object) -> str:
        self.calls.append(("invoke_multimodal_embedding", kwargs))
        return self.result

    def invoke_rerank(self, **kwargs: object) -> str:
        self.calls.append(("invoke_rerank", kwargs))
        return self.result


@dataclass(frozen=True)
class _ModelProvider:
    provider: str


@dataclass(frozen=True)
class _ActiveModel:
    deprecated: bool
    features: list[ModelFeature]
    fetch_from: str
    label: dict[str, str]
    model: str
    model_properties: dict[str, int]
    model_type: ModelType
    provider: _ModelProvider
    status: str


@dataclass
class _ProviderConfigurations:
    models: list[_ActiveModel]
    get_models_calls: list[dict[str, object]] = field(default_factory=list)

    def get_models(self, **kwargs: object) -> list[_ActiveModel]:
        self.get_models_calls.append(kwargs)
        return self.models


@dataclass(frozen=True)
class _ProviderManager:
    configurations: _ProviderConfigurations

    def get_configurations(self, _tenant_id: str) -> _ProviderConfigurations:
        return self.configurations


@dataclass(frozen=True)
class _InstalledPlugin:
    plugin_id: str
    plugin_unique_identifier: str


@dataclass(frozen=True)
class _ParameterRule:
    name: str
    use_template: str | None
    max: object
    default: object = None


@dataclass(frozen=True)
class _ModelSchema:
    model_properties: dict[str, int]
    parameter_rules: list[_ParameterRule]


@dataclass(frozen=True)
class _SchemaModelInstance:
    schema: _ModelSchema

    def get_model_schema(self) -> _ModelSchema:
        return self.schema


def test_invoke_text_embedding_forwards_input_type_to_bound_model_instance():
    tenant = _tenant()
    payload = RequestInvokeTextEmbedding(
        provider="langgenius/openai/openai",
        model="text-embedding-3-small",
        texts=["query text"],
        input_type=EmbeddingInputType.QUERY,
    )
    model_instance = _RecordingModelInstance(result="embedding-result")

    with patch.object(
        PluginModelBackwardsInvocation,
        "_get_bound_model_instance",
        return_value=model_instance,
    ) as mock_get_model:
        result = PluginModelBackwardsInvocation.invoke_text_embedding("user-1", tenant, payload)

    assert result == "embedding-result"
    mock_get_model.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="langgenius/openai/openai",
        model_type=ModelType.TEXT_EMBEDDING,
        model="text-embedding-3-small",
        request_metadata={},
    )
    assert model_instance.calls == [
        ("invoke_text_embedding", {"texts": ["query text"], "input_type": EmbeddingInputType.QUERY})
    ]


def test_invoke_multimodal_embedding_uses_bound_model_instance():
    tenant = _tenant()
    documents = [{"content": "AQID", "content_type": "image", "file_id": "asset.png"}]
    payload = RequestInvokeMultimodalEmbedding(
        provider="langgenius/clip/clip",
        model="clip-multimodal",
        documents=documents,
        input_type=EmbeddingInputType.DOCUMENT,
    )
    model_instance = _RecordingModelInstance(result="embedding-result")

    with patch.object(
        PluginModelBackwardsInvocation,
        "_get_bound_model_instance",
        return_value=model_instance,
    ) as mock_get_model:
        result = PluginModelBackwardsInvocation.invoke_multimodal_embedding("user-1", tenant, payload)

    assert result == "embedding-result"
    mock_get_model.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="langgenius/clip/clip",
        model_type=ModelType.TEXT_EMBEDDING,
        model="clip-multimodal",
        request_metadata={},
    )
    assert model_instance.calls == [
        (
            "invoke_multimodal_embedding",
            {"multimodel_documents": documents, "input_type": EmbeddingInputType.DOCUMENT},
        )
    ]


def test_invoke_rerank_accepts_omitted_threshold_and_top_n():
    tenant = _tenant()
    payload = RequestInvokeRerank(
        provider="langgenius/cohere/cohere",
        model="rerank-v3.5",
        query="query",
        docs=["first", "second"],
    )
    model_instance = _RecordingModelInstance(result="rerank-result")

    with patch.object(
        PluginModelBackwardsInvocation,
        "_get_bound_model_instance",
        return_value=model_instance,
    ):
        result = PluginModelBackwardsInvocation.invoke_rerank("user-1", tenant, payload)

    assert result == "rerank-result"
    assert model_instance.calls == [
        (
            "invoke_rerank",
            {"query": "query", "docs": ["first", "second"], "score_threshold": None, "top_n": None},
        )
    ]


@pytest.mark.parametrize(
    ("model_type", "selected"),
    [(ModelType.TEXT_EMBEDDING, False), (ModelType.LLM, False), (ModelType.LLM, True)],
)
def test_list_models_returns_only_active_tenant_models_with_installed_identity(model_type, selected):
    model_name = "selected-model"
    payload = RequestListModels(model_type=model_type, model=model_name if selected else None, limit=10)
    provider = _ModelProvider(provider="langgenius/openai/openai")
    active_model = _ActiveModel(
        deprecated=False,
        features=[ModelFeature.VISION],
        fetch_from="predefined-model",
        label={"en_US": "Embedding"},
        model=model_name,
        model_properties={"context_size": 8191},
        model_type=model_type,
        provider=provider,
        status="active",
    )
    configurations = _ProviderConfigurations(models=[active_model])
    provider_manager = _ProviderManager(configurations=configurations)
    installed_plugin = _InstalledPlugin(
        plugin_id="langgenius/openai",
        plugin_unique_identifier="langgenius/openai:1.0.0@sha256:installed",
    )

    with (
        patch(
            "core.plugin.backwards_invocation.model.create_plugin_provider_manager",
            return_value=provider_manager,
        ),
        patch("core.plugin.backwards_invocation.model.PluginService.list", return_value=[installed_plugin]),
        patch.object(
            PluginModelBackwardsInvocation,
            "_model_token_limits",
            return_value=InvokableModelTokenLimits(
                context_tokens=32768, max_output_tokens=8192, output_parameter="maxtoken"
            ),
        ) as resolve_limits,
    ):
        result = PluginModelBackwardsInvocation.list_models("tenant-1", "user-1", payload)

    assert result.next_offset is None
    assert [item.model for item in result.items] == [model_name]
    assert result.items[0].plugin_id == "langgenius/openai"
    assert result.items[0].provider == "openai"
    assert result.items[0].plugin_unique_identifier == installed_plugin.plugin_unique_identifier
    assert result.items[0].capabilities["features"] == ["vision"]
    assert configurations.get_models_calls == [{"model_type": model_type, "only_active": True}]
    if selected:
        resolve_limits.assert_called_once_with(
            tenant_id="tenant-1", user_id="user-1", provider=provider.provider, model=model_name
        )
        assert result.items[0].model_dump()["token_limits"] == {
            "context_tokens": 32768,
            "max_output_tokens": 8192,
            "output_parameter": "maxtoken",
        }
    else:
        resolve_limits.assert_not_called()
        assert result.items[0].token_limits is None


@pytest.mark.parametrize("parameter", ["max_tokens", "max_completion_tokens", "maxtoken", "custom_limit"])
def test_model_token_limits_use_schema_maximum_not_default(parameter):
    schema = _ModelSchema(
        model_properties={"context_size": 131072},
        parameter_rules=[_ParameterRule(name=parameter, use_template="max_tokens", max=32768.0, default=1024)],
    )
    instance = _SchemaModelInstance(schema=schema)
    with patch.object(PluginModelBackwardsInvocation, "_get_bound_model_instance", return_value=instance) as bound:
        limits = PluginModelBackwardsInvocation._model_token_limits(
            tenant_id="tenant-1", user_id="user-1", provider="plugin/provider", model="selected-model"
        )
    assert limits.context_tokens == 131072
    assert limits.max_output_tokens == 32768
    assert limits.output_parameter == parameter
    bound.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="plugin/provider",
        model_type=ModelType.LLM,
        model="selected-model",
    )


@pytest.mark.parametrize("maximum", [None, 0, -1, True, float("inf"), float("nan"), 10**400, 12.5, "32768"])
def test_model_token_limits_do_not_invent_unknown_output_capacity(maximum):
    schema = _ModelSchema(
        model_properties={"context_size": 8192},
        parameter_rules=[_ParameterRule(name="max_tokens", use_template=None, max=maximum, default=4096)],
    )
    with patch.object(
        PluginModelBackwardsInvocation,
        "_get_bound_model_instance",
        return_value=_SchemaModelInstance(schema=schema),
    ):
        limits = PluginModelBackwardsInvocation._model_token_limits(
            tenant_id="tenant-1", user_id="user-1", provider="plugin/provider", model="selected-model"
        )
    assert limits.context_tokens == 8192
    assert limits.max_output_tokens is None


def test_model_token_limits_respect_the_tighter_declared_alias():
    schema = _ModelSchema(
        model_properties={},
        parameter_rules=[
            _ParameterRule(name="max_tokens", use_template=None, max=32768),
            _ParameterRule(name="max_output_tokens", use_template=None, max=8192),
        ],
    )
    with patch.object(
        PluginModelBackwardsInvocation,
        "_get_bound_model_instance",
        return_value=_SchemaModelInstance(schema=schema),
    ):
        limits = PluginModelBackwardsInvocation._model_token_limits(
            tenant_id="tenant-1", user_id="user-1", provider="plugin/provider", model="selected-model"
        )
    assert limits.max_output_tokens == 8192
    assert limits.output_parameter == "max_output_tokens"


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
            return_value=[TTSChunk(data=b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data", mime_type=None)],
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
            return_value=[
                TTSChunk(
                    data=TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data", "audio/mpeg"),
                    mime_type="audio/mpeg",
                )
            ],
        ),
        patch.object(model_instance.model_type_instance, "get_model_schema", return_value=_tts_schema("mp3")),
    ):
        response = PluginModelBackwardsInvocation.invoke_tts("user-1", tenant, payload)
        chunks = list(PluginModelBackwardsInvocation.convert_to_event_stream(response))

    assert json.loads(chunks[0])["error"].startswith("TTS provider output MIME does not match")
