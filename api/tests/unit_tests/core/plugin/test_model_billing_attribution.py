"""Exercise backwards invocation through the real hosted quota owner, with no external I/O."""

from collections.abc import Callable
from dataclasses import dataclass
from unittest.mock import patch

import pytest

from configs import dify_config
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import (
    CustomConfiguration,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    SystemConfiguration,
)
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelInstance
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeLLM,
    RequestInvokeMultimodalEmbedding,
    RequestInvokeRerank,
    RequestInvokeTextEmbedding,
)
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from enums import DeploymentEdition
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.model_providers.base.ai_model import AIModel
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.model_runtime.model_providers.base.rerank_model import RerankModel
from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel
from models.account import Tenant
from models.provider import ProviderType
from services.billing_service import BillingService
from tests.unit_tests.knowledge_fs_core_fakes import Marker

_MODEL_TYPE_CLASSES: dict[ModelType, type[AIModel]] = {
    ModelType.LLM: LargeLanguageModel,
    ModelType.TEXT_EMBEDDING: TextEmbeddingModel,
    ModelType.RERANK: RerankModel,
}


@dataclass(frozen=True)
class _ProviderManager:
    bundle: ProviderModelBundle

    def get_provider_model_bundle(self, **_kwargs: object) -> ProviderModelBundle:
        return self.bundle

    def get_configurations(self, _tenant_id: str) -> dict[str, ProviderConfiguration]:
        return {self.bundle.configuration.provider.provider: self.bundle.configuration}


def _tenant() -> Tenant:
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    return tenant


def _hosted_bundle(model_type: ModelType) -> ProviderModelBundle:
    provider = ProviderEntity(
        provider="langgenius/openai/openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[model_type],
        configurate_methods=[],
    )
    configuration = ProviderConfiguration(
        tenant_id="tenant-1",
        provider=provider,
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=200,
                    quota_used=0,
                    is_valid=True,
                    restrict_models=[],
                )
            ],
        ),
        custom_configuration=CustomConfiguration(provider=None),
        model_settings=[],
    )
    model_type_instance = _MODEL_TYPE_CLASSES[model_type](
        provider_schema=provider,
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-1", user_id="synthetic-end-user"),
    )
    return ProviderModelBundle(configuration=configuration, model_type_instance=model_type_instance)


@pytest.mark.parametrize(
    ("payload_type", "invoke_method", "provider_method", "model_type", "body"),
    [
        (
            RequestInvokeLLM,
            PluginModelBackwardsInvocation.invoke_llm,
            "invoke_llm",
            ModelType.LLM,
            {"mode": "chat", "stream": True},
        ),
        (
            RequestInvokeTextEmbedding,
            PluginModelBackwardsInvocation.invoke_text_embedding,
            "invoke_text_embedding",
            ModelType.TEXT_EMBEDDING,
            {"texts": ["query"], "input_type": "query"},
        ),
        (
            RequestInvokeMultimodalEmbedding,
            PluginModelBackwardsInvocation.invoke_multimodal_embedding,
            "invoke_multimodal_embedding",
            ModelType.TEXT_EMBEDDING,
            {"documents": [{"content": "AQID", "content_type": "image"}]},
        ),
        (
            RequestInvokeRerank,
            PluginModelBackwardsInvocation.invoke_rerank,
            "invoke_rerank",
            ModelType.RERANK,
            {"query": "query", "docs": ["doc"]},
        ),
    ],
)
@pytest.mark.parametrize(
    "created_by",
    ["knowledge_indexing", "knowledge_retrieval", "app", None],
    ids=["indexing", "retrieval", "answer", "legacy-plugin"],
)
def test_model_invocation_preserves_billing_origin(
    payload_type,
    invoke_method: Callable[..., object],
    provider_method: str,
    model_type: ModelType,
    body: dict,
    created_by: str | None,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    provider_manager = _ProviderManager(bundle=_hosted_bundle(model_type))
    metadata = {"app_type": "new_rag", "created_by": created_by} if created_by else {}
    payload = payload_type.model_validate(
        {"provider": "langgenius/openai/openai", "model": "selected-model", **body, **metadata}
    )
    requests: list[tuple[str, dict]] = []

    def billing_transport(method: str, endpoint: str, *, json: dict) -> dict:
        assert method == "POST"
        requests.append((endpoint, json))
        if endpoint == "/quota/reserve":
            return {"reservation_id": "reservation-1", "available": 197, "reserved": 3}
        assert endpoint == "/quota/commit"
        return {"available": 197, "reserved": 0, "refunded": 0}

    chunk = LLMResultChunk(
        model="selected-model",
        prompt_messages=[],
        delta=LLMResultChunkDelta(
            index=0, message=AssistantPromptMessage(content="OK"), usage=LLMUsage.empty_usage(), finish_reason="stop"
        ),
    )
    provider_result = (item for item in [chunk]) if model_type == ModelType.LLM else Marker("provider-result")
    with (
        patch("core.model_manager.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch.object(type(dify_config), "get_model_credits", return_value=3),
        patch.object(ProviderConfiguration, "get_current_credentials", return_value={"api_key": "local-test-only"}),
        patch.object(ProviderConfiguration, "get_provider_model", return_value=None),
        patch.object(ModelInstance, provider_method, return_value=provider_result),
        patch.object(BillingService, "_send_quota_request", side_effect=billing_transport),
    ):
        response = invoke_method("synthetic-end-user", _tenant(), payload)
        assert get_credit_usage_metadata() is None
        if model_type == ModelType.LLM:
            assert list(response)[0].delta.message.content == "OK"

    assert [endpoint for endpoint, _ in requests] == ["/quota/reserve", "/quota/commit"]
    expected_metadata = {
        "source": "llm.invoke" if model_type == ModelType.LLM else "model.invoke",
        "provider": "langgenius/openai/openai",
        "model": "selected-model",
        "app_type": "new_rag" if created_by else "unknown",
        "created_by": created_by or "plugin_api",
    }
    if model_type != ModelType.LLM:
        expected_metadata["model_type"] = model_type.value
    reserve, commit = requests[0][1], requests[1][1]
    assert reserve["tenant_id"] == commit["tenant_id"] == "tenant-1"
    assert reserve["bucket"] == commit["bucket"] == "trial"
    assert reserve["feature_key"] == commit["feature_key"] == "credit_pool"
    assert reserve["amount"] == commit["actual_amount"] == 3
    assert reserve["meta"] == expected_metadata
    assert commit["meta"] == {**expected_metadata, "request_id": reserve["request_id"]}
