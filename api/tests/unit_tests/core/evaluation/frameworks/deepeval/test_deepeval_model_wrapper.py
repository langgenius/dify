from dataclasses import dataclass

import pytest
from pydantic import BaseModel

from core.evaluation.frameworks.deepeval.deepeval_model_wrapper import DifyDeepEvalModel


class _JudgeResponse(BaseModel):
    verdict: str


@dataclass
class _TextMessage:
    content: str

    def get_text_content(self) -> str:
        """Return the exact text supplied by the model runtime."""
        return self.content


@dataclass
class _LLMResponse:
    message: _TextMessage


@dataclass
class _StructuredResponse:
    structured_output: dict[str, str]


class _ModelRuntime:
    provider = "plugin/provider"

    def __init__(self) -> None:
        """Start with no invocations so tests can inspect the actual adapter call."""
        self.invoke_calls: list[dict[str, object]] = []

    def invoke_llm(self, **kwargs: object) -> _LLMResponse:
        """Record an invocation and return a concrete text response."""
        self.invoke_calls.append(kwargs)
        return _LLMResponse(message=_TextMessage(content="plain response"))

    def get_model_schema(self) -> object:
        """Return the schema passed unchanged to structured output generation."""
        return object()


class _ModelManager:
    def __init__(self, model: _ModelRuntime) -> None:
        """Bind the concrete runtime returned for the configured model."""
        self.model = model

    def get_model_instance(self, **_kwargs: object) -> _ModelRuntime:
        """Return the configured runtime to the DeepEval adapter."""
        return self.model


@pytest.fixture
def model_runtime(monkeypatch: pytest.MonkeyPatch) -> _ModelRuntime:
    """Install a tenant-scoped model manager and return its concrete runtime."""
    model_instance = _ModelRuntime()
    model_manager = _ModelManager(model_instance)
    monkeypatch.setattr(
        "core.plugin.impl.model_runtime_factory.create_plugin_model_manager",
        lambda **_kwargs: model_manager,
    )
    return model_instance


def test_generate_uses_dify_model_runtime(model_runtime: _ModelRuntime) -> None:
    model = DifyDeepEvalModel("provider", "judge-model", "tenant-1")

    result = model.generate("judge this")

    assert result == "plain response"
    assert len(model_runtime.invoke_calls) == 1
    kwargs = model_runtime.invoke_calls[0]
    assert kwargs["model_parameters"] == {"temperature": 0.0}
    assert kwargs["stream"] is False
    assert model.get_model_name() == "provider/judge-model"


def test_generate_validates_structured_output(
    model_runtime: _ModelRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    structured_calls: list[dict[str, object]] = []

    def invoke_structured(**kwargs: object) -> _StructuredResponse:
        """Record the schema sent to the parser and return a valid structured result."""
        structured_calls.append(kwargs)
        return _StructuredResponse(structured_output={"verdict": "yes"})

    monkeypatch.setattr(
        "core.llm_generator.output_parser.structured_output.invoke_llm_with_structured_output",
        invoke_structured,
    )
    model = DifyDeepEvalModel("provider", "judge-model", "tenant-1")

    result = model.generate("judge this", schema=_JudgeResponse)

    assert result == _JudgeResponse(verdict="yes")
    assert len(structured_calls) == 1
    assert structured_calls[0]["provider"] == "plugin/provider"
    assert structured_calls[0]["json_schema"] == {
        "additionalProperties": False,
        "properties": {"verdict": {"title": "Verdict", "type": "string"}},
        "required": ["verdict"],
        "title": "_JudgeResponse",
        "type": "object",
    }
    assert structured_calls[0]["stream"] is False
    assert model_runtime.invoke_calls == []
