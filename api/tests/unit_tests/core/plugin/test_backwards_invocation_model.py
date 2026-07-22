from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.entities.embedding_type import EmbeddingInputType
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeMultimodalEmbedding,
    RequestInvokeRerank,
    RequestInvokeSummary,
    RequestInvokeTextEmbedding,
    RequestListModels,
)
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType


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
    tenant = SimpleNamespace(id="tenant-1")
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


def test_invoke_text_embedding_forwards_input_type_to_bound_model_instance():
    tenant = SimpleNamespace(id="tenant-1")
    payload = RequestInvokeTextEmbedding(
        provider="langgenius/openai/openai",
        model="text-embedding-3-small",
        texts=["query text"],
        input_type=EmbeddingInputType.QUERY,
    )
    model_instance = SimpleNamespace(invoke_text_embedding=lambda **_: "unused")

    with (
        patch.object(
            PluginModelBackwardsInvocation,
            "_get_bound_model_instance",
            return_value=model_instance,
        ) as mock_get_model,
        patch.object(model_instance, "invoke_text_embedding", return_value="embedding-result") as mock_invoke,
    ):
        result = PluginModelBackwardsInvocation.invoke_text_embedding("user-1", tenant, payload)

    assert result == "embedding-result"
    mock_get_model.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="langgenius/openai/openai",
        model_type=ModelType.TEXT_EMBEDDING,
        model="text-embedding-3-small",
    )
    mock_invoke.assert_called_once_with(texts=["query text"], input_type=EmbeddingInputType.QUERY)


def test_invoke_multimodal_embedding_uses_bound_model_instance():
    tenant = SimpleNamespace(id="tenant-1")
    documents = [{"content": "AQID", "content_type": "image", "file_id": "asset.png"}]
    payload = RequestInvokeMultimodalEmbedding(
        provider="langgenius/clip/clip",
        model="clip-multimodal",
        documents=documents,
        input_type=EmbeddingInputType.DOCUMENT,
    )
    model_instance = SimpleNamespace(invoke_multimodal_embedding=lambda **_: "unused")

    with (
        patch.object(
            PluginModelBackwardsInvocation,
            "_get_bound_model_instance",
            return_value=model_instance,
        ) as mock_get_model,
        patch.object(
            model_instance,
            "invoke_multimodal_embedding",
            return_value="embedding-result",
        ) as mock_invoke,
    ):
        result = PluginModelBackwardsInvocation.invoke_multimodal_embedding("user-1", tenant, payload)

    assert result == "embedding-result"
    mock_get_model.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="langgenius/clip/clip",
        model_type=ModelType.TEXT_EMBEDDING,
        model="clip-multimodal",
    )
    mock_invoke.assert_called_once_with(
        multimodel_documents=documents,
        input_type=EmbeddingInputType.DOCUMENT,
    )


def test_invoke_rerank_accepts_omitted_threshold_and_top_n():
    tenant = SimpleNamespace(id="tenant-1")
    payload = RequestInvokeRerank(
        provider="langgenius/cohere/cohere",
        model="rerank-v3.5",
        query="query",
        docs=["first", "second"],
    )
    model_instance = SimpleNamespace(invoke_rerank=lambda **_: "unused")

    with (
        patch.object(
            PluginModelBackwardsInvocation,
            "_get_bound_model_instance",
            return_value=model_instance,
        ),
        patch.object(model_instance, "invoke_rerank", return_value="rerank-result") as mock_invoke,
    ):
        result = PluginModelBackwardsInvocation.invoke_rerank("user-1", tenant, payload)

    assert result == "rerank-result"
    mock_invoke.assert_called_once_with(
        query="query",
        docs=["first", "second"],
        score_threshold=None,
        top_n=None,
    )


def test_list_models_returns_only_active_tenant_models_with_installed_identity():
    payload = RequestListModels(model_type=ModelType.TEXT_EMBEDDING, limit=10)
    provider = SimpleNamespace(provider="langgenius/openai/openai")
    active_model = SimpleNamespace(
        deprecated=False,
        features=[],
        fetch_from="predefined-model",
        label={"en_US": "Embedding"},
        model="text-embedding-3-small",
        model_properties={"context_size": 8191},
        model_type=ModelType.TEXT_EMBEDDING,
        provider=provider,
        status="active",
    )
    configurations = SimpleNamespace(get_models=MagicMock(return_value=[active_model]))
    provider_manager = SimpleNamespace(get_configurations=lambda _tenant_id: configurations)
    installed_plugin = SimpleNamespace(
        plugin_id="langgenius/openai",
        plugin_unique_identifier="langgenius/openai:1.0.0@sha256:installed",
    )

    with (
        patch(
            "core.plugin.backwards_invocation.model.create_plugin_provider_manager",
            return_value=provider_manager,
        ),
        patch("core.plugin.backwards_invocation.model.PluginService.list", return_value=[installed_plugin]),
    ):
        result = PluginModelBackwardsInvocation.list_models("tenant-1", "user-1", payload)

    assert result.next_offset is None
    assert [item.model for item in result.items] == ["text-embedding-3-small"]
    assert result.items[0].plugin_id == "langgenius/openai"
    assert result.items[0].provider == "openai"
    assert result.items[0].plugin_unique_identifier == installed_plugin.plugin_unique_identifier
    configurations.get_models.assert_called_once_with(
        model_type=ModelType.TEXT_EMBEDDING,
        only_active=True,
    )
