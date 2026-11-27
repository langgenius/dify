import asyncio
from collections.abc import Mapping
from dataclasses import dataclass

import pytest
from pydantic import BaseModel, ValidationError
from ragas.embeddings.base import BaseRagasEmbedding
from ragas.llms.base import InstructorBaseRagasLLM

from core.credit_usage import CreditUsageAppType
from core.entities.embedding_type import EmbeddingInputType
from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper
from core.model_context import use_credit_usage_metadata
from core.model_manager import ModelManager
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelPropertyKey


@dataclass
class _TextMessage:
    content: str

    def get_text_content(self) -> str:
        return self.content


@dataclass
class _LLMResponse:
    message: _TextMessage


@dataclass
class _StructuredResponse:
    structured_output: dict[str, object]


class _LLMModel:
    provider = "provider"

    def __init__(self) -> None:
        self.invoke_calls: list[dict[str, object]] = []

    def get_model_schema(self) -> object:
        return object()

    def invoke_llm(self, **kwargs: object) -> _LLMResponse:
        self.invoke_calls.append(kwargs)
        return _LLMResponse(message=_TextMessage("response"))


class _JudgeOutput(BaseModel):
    verdict: int


def test_dify_model_wrapper_uses_tenant_model_and_validates_structured_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ragas structured prompts use Dify's tenant model and validate the returned schema."""
    wrapper = DifyModelWrapper("provider", "model", "tenant")
    assert isinstance(wrapper, InstructorBaseRagasLLM)
    model_instance = _LLMModel()
    assembly = PluginModelAssembly(tenant_id="tenant", user_id=None)
    model_requests: list[dict[str, object]] = []

    def get_model_instance(**kwargs: object) -> _LLMModel:
        model_requests.append(kwargs)
        return model_instance

    monkeypatch.setattr(assembly.model_manager, "get_model_instance", get_model_instance)
    monkeypatch.setattr(
        "core.plugin.impl.model_runtime_factory.create_plugin_model_manager",
        lambda **_kwargs: assembly.model_manager,
    )
    expected_model_request = {
        "tenant_id": "tenant",
        "provider": "provider",
        "model_type": "llm",
        "model": "model",
        "request_metadata": {"app_type": "workflow", "created_by": "evaluation"},
    }

    structured_calls: list[dict[str, object]] = []
    structured_output: dict[str, object] = {"verdict": 1}

    def fake_structured_output(**kwargs: object) -> _StructuredResponse:
        structured_calls.append(kwargs)
        return _StructuredResponse(structured_output=structured_output)

    monkeypatch.setattr(
        "core.llm_generator.output_parser.structured_output.invoke_llm_with_structured_output",
        fake_structured_output,
    )
    with use_credit_usage_metadata({"app_type": CreditUsageAppType.WORKFLOW}):
        assert wrapper._get_model_instance() is model_instance
        assert wrapper.generate("judge this", _JudgeOutput) == _JudgeOutput(verdict=1)
        assert asyncio.run(wrapper.agenerate("judge async", _JudgeOutput)) == _JudgeOutput(verdict=1)
        assert wrapper.invoke("plain judge") == "response"

    assert model_requests == [expected_model_request] * 4
    assert structured_calls[0]["model_instance"] is model_instance
    assert structured_calls[0]["provider"] == "provider"
    assert structured_calls[0]["model_parameters"] == {"temperature": 0.0}
    assert structured_calls[0]["stream"] is False
    assert structured_calls[0]["json_schema"] == {
        "type": "object",
        "title": "_JudgeOutput",
        "properties": {"verdict": {"type": "integer", "title": "Verdict"}},
        "required": ["verdict"],
        "additionalProperties": False,
    }
    prompt_messages = structured_calls[0]["prompt_messages"]
    assert isinstance(prompt_messages, list)
    assert len(prompt_messages) == 2
    assert isinstance(prompt_messages[0], SystemPromptMessage)
    assert isinstance(prompt_messages[1], UserPromptMessage)
    assert [message.content for message in prompt_messages] == [
        "You are an evaluation judge. Follow the requested output format exactly.",
        "judge this",
    ]

    assert model_instance.invoke_calls[0]["model_parameters"] == {"temperature": 0.0}

    structured_output.clear()
    with pytest.raises(ValidationError):
        wrapper.generate("invalid result", _JudgeOutput)


@dataclass
class _EmbeddingSchema:
    model_properties: dict[ModelPropertyKey, int]


class _EmbeddingModelType:
    def get_model_schema(self, _model_name: str, _credentials: dict[str, str]) -> _EmbeddingSchema:
        return _EmbeddingSchema(model_properties={ModelPropertyKey.MAX_CHUNKS: 2})


@dataclass
class _EmbeddingResponse:
    embeddings: list[list[float]]


class _EmbeddingModel:
    model_name = "embedding-model"
    credentials = {"token": "secret"}

    def __init__(self) -> None:
        self.model_type_instance = _EmbeddingModelType()
        self.calls: list[tuple[list[str], EmbeddingInputType]] = []

    def invoke_text_embedding(self, *, texts: list[str], input_type: EmbeddingInputType) -> _EmbeddingResponse:
        self.calls.append((texts, input_type))
        return _EmbeddingResponse(embeddings=[[float(len(text)), 1.0] for text in texts])


class _EmbeddingManager:
    def __init__(self, model: _EmbeddingModel) -> None:
        self.model = model

    def get_default_model_instance(self, **_kwargs: object) -> _EmbeddingModel:
        return self.model


def test_dify_embeddings_wrapper_uses_modern_ragas_contract_and_query_semantics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_instance = _EmbeddingModel()
    manager = _EmbeddingManager(model_instance)
    tenant_calls: list[tuple[str, str | None, Mapping[str, object] | None]] = []

    def for_tenant(
        _cls: type[ModelManager],
        tenant_id: str,
        user_id: str | None = None,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> _EmbeddingManager:
        tenant_calls.append((tenant_id, user_id, request_metadata))
        return manager

    monkeypatch.setattr(ModelManager, "for_tenant", classmethod(for_tenant))
    wrapper = DifyEmbeddingsWrapper("tenant-1", "user-1")
    assert isinstance(wrapper, BaseRagasEmbedding)
    with use_credit_usage_metadata({"app_type": CreditUsageAppType.WORKFLOW}):
        assert wrapper.embed_texts(["one", "four", "five"]) == [[3.0, 1.0], [4.0, 1.0], [4.0, 1.0]]
        assert wrapper.embed_text("semantic") == [8.0, 1.0]
        assert asyncio.run(wrapper.aembed_text("async")) == [5.0, 1.0]
        assert asyncio.run(wrapper.aembed_texts(["one", "two"])) == [[3.0, 1.0], [3.0, 1.0]]

        query_wrapper = wrapper.for_answer_relevancy()
        assert asyncio.run(query_wrapper.aembed_text("question")) == [8.0, 1.0]
        assert asyncio.run(query_wrapper.aembed_texts(["generated"])) == [[9.0, 1.0]]

    assert model_instance.calls[-2:] == [
        (["question"], EmbeddingInputType.QUERY),
        (["generated"], EmbeddingInputType.DOCUMENT),
    ]
    assert tenant_calls == [("tenant-1", "user-1", {"app_type": "workflow", "created_by": "evaluation"})] * 2
    assert wrapper.embed_texts([]) == []
    monkeypatch.setattr(model_instance.model_type_instance, "get_model_schema", lambda *_args: None)
    assert DifyEmbeddingsWrapper._max_batch_size(model_instance) == 1
