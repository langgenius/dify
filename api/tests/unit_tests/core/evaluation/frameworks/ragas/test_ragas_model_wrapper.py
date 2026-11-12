import asyncio
import importlib
import sys
from dataclasses import dataclass
from types import ModuleType
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.prompt_values import ChatPromptValue, StringPromptValue

from core.entities.embedding_type import EmbeddingInputType
from graphon.model_runtime.entities.model_entities import ModelPropertyKey


@dataclass
class _TextMessage:
    content: str

    def get_text_content(self) -> str:
        """Return the text provided by the model runtime."""
        return self.content


@dataclass
class _LLMResponse:
    message: _TextMessage


class _LLMModel:
    def __init__(self) -> None:
        """Start with no invocations for the wrapper to record."""
        self.invoke_calls: list[dict[str, object]] = []

    def invoke_llm(self, **kwargs: object) -> _LLMResponse:
        """Capture the actual prompt and parameters and return a text response."""
        self.invoke_calls.append(kwargs)
        return _LLMResponse(message=_TextMessage("response"))


@dataclass
class _EmbeddingSchema:
    model_properties: dict[ModelPropertyKey, int]


class _EmbeddingModelType:
    def get_model_schema(self, _model_name: str, _credentials: dict[str, str]) -> _EmbeddingSchema:
        """Declare a two-text batch limit for this provider model."""
        return _EmbeddingSchema(model_properties={ModelPropertyKey.MAX_CHUNKS: 2})


@dataclass
class _EmbeddingResponse:
    embeddings: list[list[float]]


class _EmbeddingModel:
    model_name = "embedding-model"
    credentials = {"token": "secret"}

    def __init__(self) -> None:
        """Provide a concrete model schema and track calls to its embedding boundary."""
        self.model_type_instance = _EmbeddingModelType()
        self.calls: list[tuple[list[str], EmbeddingInputType]] = []

    def invoke_text_embedding(self, *, texts: list[str], input_type: EmbeddingInputType) -> _EmbeddingResponse:
        """Return deterministic vectors for every text in the requested batch."""
        self.calls.append((texts, input_type))
        return _EmbeddingResponse(embeddings=[[float(len(text)), 1.0] for text in texts])


class _EmbeddingManager:
    def __init__(self, model: _EmbeddingModel) -> None:
        """Bind the model returned for the tenant's default embedding setting."""
        self.model = model

    def get_default_model_instance(self, **_kwargs: object) -> _EmbeddingModel:
        """Return the default embedding model without provider I/O."""
        return self.model


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

            model_instance = _LLMModel()
            monkeypatch.setattr(wrapper, "_get_model_instance", lambda: model_instance)

            generated = wrapper.generate_text(StringPromptValue(text="judge this"), n=2, temperature=0.743)

            assert len(generated.generations[0]) == 2
            assert [generation.text for generation in generated.generations[0]] == ["response", "response"]
            assert len(model_instance.invoke_calls) == 2
            assert model_instance.invoke_calls[0]["model_parameters"] == {"temperature": 0.74}
            assert wrapper.invoke("judge this") == "response"
            assert model_instance.invoke_calls[2]["model_parameters"] == {"temperature": 0.0}
            assert (
                asyncio.run(wrapper.agenerate_text(StringPromptValue(text="async judge"), n=1, temperature=0.0))
                .generations[0][0]
                .text
                == "response"
            )
            assert len(model_instance.invoke_calls) == 4
            wrapper.generate_text(
                ChatPromptValue(
                    messages=[
                        SystemMessage(content="rules"),
                        HumanMessage(content=[{"type": "text", "text": "question"}]),
                        AIMessage(content="earlier answer"),
                    ]
                )
            )
            prompt_messages = model_instance.invoke_calls[4]["prompt_messages"]
            assert isinstance(prompt_messages, list)
            assert [type(message).__name__ for message in prompt_messages] == [
                "SystemPromptMessage",
                "UserPromptMessage",
                "AssistantPromptMessage",
            ]
            assert [message.content for message in prompt_messages] == ["rules", "question", "earlier answer"]
    finally:
        sys.modules.pop(wrapper_module_name, None)
        if previous_wrapper_module is not None:
            sys.modules[wrapper_module_name] = previous_wrapper_module


def test_dify_embeddings_wrapper_uses_default_model_and_provider_batch_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
    from core.model_manager import ModelManager

    model_instance = _EmbeddingModel()
    manager = _EmbeddingManager(model_instance)
    tenant_calls: list[tuple[str, str | None]] = []

    def for_tenant(_cls: type[ModelManager], tenant_id: str, user_id: str | None = None) -> _EmbeddingManager:
        """Record the owner scope used to resolve the default model."""
        tenant_calls.append((tenant_id, user_id))
        return manager

    monkeypatch.setattr(ModelManager, "for_tenant", classmethod(for_tenant))
    wrapper = DifyEmbeddingsWrapper("tenant-1", "user-1")

    assert wrapper.embed_documents(["one", "four", "five"]) == [
        [3.0, 1.0],
        [4.0, 1.0],
        [4.0, 1.0],
    ]
    assert wrapper.embed_query("query") == [5.0, 1.0]
    assert asyncio.run(wrapper.embed_text("semantic")) == [8.0, 1.0]

    assert tenant_calls == [("tenant-1", "user-1")]
    assert model_instance.calls == [
        (["one", "four"], EmbeddingInputType.DOCUMENT),
        (["five"], EmbeddingInputType.DOCUMENT),
        (["query"], EmbeddingInputType.QUERY),
        (["semantic"], EmbeddingInputType.DOCUMENT),
    ]
