import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def test_dify_embeddings_wrapper_uses_default_model_and_provider_batch_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.entities.embedding_type import EmbeddingInputType
    from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
    from core.model_manager import ModelManager
    from graphon.model_runtime.entities.model_entities import ModelPropertyKey

    model_type_instance = MagicMock()
    model_type_instance.get_model_schema.return_value = SimpleNamespace(
        model_properties={ModelPropertyKey.MAX_CHUNKS: 2}
    )
    model_instance = MagicMock(
        model_type_instance=model_type_instance,
        model_name="embedding-model",
        credentials={"token": "secret"},
    )

    def invoke_text_embedding(*, texts: list[str], input_type: EmbeddingInputType) -> SimpleNamespace:
        del input_type
        return SimpleNamespace(embeddings=[[float(len(text)), 1.0] for text in texts])

    model_instance.invoke_text_embedding.side_effect = invoke_text_embedding
    manager = MagicMock()
    manager.get_default_model_instance.return_value = model_instance
    for_tenant = MagicMock(return_value=manager)
    monkeypatch.setattr(ModelManager, "for_tenant", for_tenant)
    wrapper = DifyEmbeddingsWrapper("tenant-1", "user-1")

    assert wrapper.embed_documents(["one", "four", "five"]) == [
        [3.0, 1.0],
        [4.0, 1.0],
        [4.0, 1.0],
    ]
    assert wrapper.embed_query("query") == [5.0, 1.0]
    assert asyncio.run(wrapper.embed_text("semantic")) == [8.0, 1.0]

    for_tenant.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    assert model_instance.invoke_text_embedding.call_count == 4
    assert model_instance.invoke_text_embedding.call_args_list[0].kwargs == {
        "texts": ["one", "four"],
        "input_type": EmbeddingInputType.DOCUMENT,
    }
    assert model_instance.invoke_text_embedding.call_args_list[1].kwargs == {
        "texts": ["five"],
        "input_type": EmbeddingInputType.DOCUMENT,
    }
    assert model_instance.invoke_text_embedding.call_args_list[2].kwargs == {
        "texts": ["query"],
        "input_type": EmbeddingInputType.QUERY,
    }
    assert model_instance.invoke_text_embedding.call_args_list[3].kwargs == {
        "texts": ["semantic"],
        "input_type": EmbeddingInputType.DOCUMENT,
    }
