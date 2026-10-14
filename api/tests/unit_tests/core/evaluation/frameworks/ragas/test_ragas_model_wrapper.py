import asyncio
import importlib
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.prompt_values import StringPromptValue


def test_dify_model_wrapper_rounds_ragas_temperature_for_plugin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeBaseRagasLLM:
        pass

    ragas_module = ModuleType("ragas")
    ragas_module.__path__ = []
    llms_module = ModuleType("ragas.llms")
    llms_module.__path__ = []
    llms_base_module = ModuleType("ragas.llms.base")
    llms_base_module.__dict__["BaseRagasLLM"] = FakeBaseRagasLLM
    wrapper_module_name = "core.evaluation.frameworks.ragas.ragas_model_wrapper"
    previous_wrapper_module = sys.modules.pop(wrapper_module_name, None)

    try:
        with patch.dict(
            sys.modules,
            {
                "ragas": ragas_module,
                "ragas.llms": llms_module,
                "ragas.llms.base": llms_base_module,
            },
        ):
            wrapper_module = importlib.import_module(wrapper_module_name)
            wrapper = wrapper_module.DifyModelWrapper("provider", "model", "tenant")

            model_instance = MagicMock()
            model_instance.invoke_llm.return_value = SimpleNamespace(
                message=SimpleNamespace(get_text_content=lambda: "response")
            )
            monkeypatch.setattr(wrapper, "_get_model_instance", lambda: model_instance)

            wrapper.generate_text(StringPromptValue(text="judge this"))

            assert model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {"temperature": 0.0}
    finally:
        sys.modules.pop(wrapper_module_name, None)
        if previous_wrapper_module is not None:
            sys.modules[wrapper_module_name] = previous_wrapper_module


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
