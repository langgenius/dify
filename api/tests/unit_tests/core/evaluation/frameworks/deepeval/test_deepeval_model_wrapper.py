from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from core.evaluation.frameworks.deepeval.deepeval_model_wrapper import DifyDeepEvalModel


class _JudgeResponse(BaseModel):
    verdict: str


@pytest.fixture
def model_runtime(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    model_instance = MagicMock()
    model_instance.provider = "plugin/provider"
    model_instance.invoke_llm.return_value = SimpleNamespace(
        message=SimpleNamespace(get_text_content=MagicMock(return_value="plain response"))
    )
    model_manager = MagicMock()
    model_manager.get_model_instance.return_value = model_instance
    monkeypatch.setattr(
        "core.plugin.impl.model_runtime_factory.create_plugin_model_manager",
        MagicMock(return_value=model_manager),
    )
    return model_instance


def test_generate_uses_dify_model_runtime(model_runtime: MagicMock) -> None:
    model = DifyDeepEvalModel("provider", "judge-model", "tenant-1")

    result = model.generate("judge this")

    assert result == "plain response"
    model_runtime.invoke_llm.assert_called_once()
    kwargs = model_runtime.invoke_llm.call_args.kwargs
    assert kwargs["model_parameters"] == {"temperature": 0.0}
    assert kwargs["stream"] is False
    assert model.get_model_name() == "provider/judge-model"


def test_generate_validates_structured_output(
    model_runtime: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_runtime.get_model_schema.return_value = object()
    invoke_structured = MagicMock(return_value=SimpleNamespace(structured_output={"verdict": "yes"}))
    monkeypatch.setattr(
        "core.llm_generator.output_parser.structured_output.invoke_llm_with_structured_output",
        invoke_structured,
    )
    model = DifyDeepEvalModel("provider", "judge-model", "tenant-1")

    result = model.generate("judge this", schema=_JudgeResponse)

    assert result == _JudgeResponse(verdict="yes")
    assert invoke_structured.call_args.kwargs["provider"] == "plugin/provider"
    assert invoke_structured.call_args.kwargs["json_schema"] == {
        "additionalProperties": False,
        "properties": {"verdict": {"title": "Verdict", "type": "string"}},
        "required": ["verdict"],
        "title": "_JudgeResponse",
        "type": "object",
    }
    assert invoke_structured.call_args.kwargs["stream"] is False
