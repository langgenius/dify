"""Exercise backwards invocation through the real hosted quota owner, with no external I/O."""

from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelInstance
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeLLM,
    RequestInvokeMultimodalEmbedding,
    RequestInvokeRerank,
    RequestInvokeTextEmbedding,
)
from enums import DeploymentEdition
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType
from services.billing_service import BillingService


@pytest.mark.parametrize(
    ("payload_type", "invoke_method", "provider_method", "model_type", "body"),
    [
        (RequestInvokeLLM, "invoke_llm", "invoke_llm", ModelType.LLM, {"mode": "chat", "stream": True}),
        (
            RequestInvokeTextEmbedding,
            "invoke_text_embedding",
            "invoke_text_embedding",
            ModelType.TEXT_EMBEDDING,
            {"texts": ["query"], "input_type": "query"},
        ),
        (
            RequestInvokeMultimodalEmbedding,
            "invoke_multimodal_embedding",
            "invoke_multimodal_embedding",
            ModelType.TEXT_EMBEDDING,
            {"documents": [{"content": "AQID", "content_type": "image"}]},
        ),
        (RequestInvokeRerank, "invoke_rerank", "invoke_rerank", ModelType.RERANK, {"query": "query", "docs": ["doc"]}),
    ],
)
@pytest.mark.parametrize(
    "created_by",
    ["knowledge_indexing", "knowledge_retrieval", "app", None],
    ids=["indexing", "retrieval", "answer", "legacy-plugin"],
)
def test_model_invocation_preserves_billing_origin(
    payload_type,
    invoke_method: str,
    provider_method: str,
    model_type: ModelType,
    body: dict,
    created_by: str | None,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    configuration = SimpleNamespace(
        tenant_id="tenant-1",
        provider=SimpleNamespace(provider="langgenius/openai/openai"),
        model_settings=[],
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=200,
                    restrict_models=[],
                )
            ],
        ),
        get_current_credentials=lambda **_: {"api_key": "local-test-only"},
        get_provider_model=lambda **_: None,
    )
    bundle = SimpleNamespace(configuration=configuration, model_type_instance=MagicMock(model_type=model_type))
    provider_manager = MagicMock()
    provider_manager.get_provider_model_bundle.return_value = bundle
    provider_manager.get_configurations.return_value = {"langgenius/openai/openai": configuration}
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
    provider_result = (item for item in [chunk]) if model_type == ModelType.LLM else MagicMock()
    with (
        patch("core.model_manager.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch.object(type(dify_config), "get_model_credits", return_value=3),
        patch.object(ModelInstance, provider_method, return_value=provider_result),
        patch.object(BillingService, "_send_quota_request", side_effect=billing_transport),
    ):
        response = getattr(PluginModelBackwardsInvocation, invoke_method)(
            "synthetic-end-user", SimpleNamespace(id="tenant-1"), payload
        )
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
