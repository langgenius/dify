import pytest

from core.workflow.llm_node import DifyParameterExtractorNode
from core.workflow.node_runtime import DifyPreparedLLM, DifyPromptMessageSerializer
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.nodes.parameter_extractor.parameter_extractor_node import _ParameterExtractorRunContext
from graphon.runtime import RuntimeState
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationInputRejectedInvocationError,
    PlatformModerationOutputRejectedInvocationError,
)
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


@pytest.mark.parametrize(
    "error",
    [
        PlatformModerationInputRejectedInvocationError("Rejected"),
        PlatformModerationOutputRejectedInvocationError("Rejected"),
        ModerationUnavailableInvocationError(),
    ],
)
def test_parameter_extraction_retains_only_the_current_moderation_failure_type(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    model = make_model_instance(provider="test-provider", model="test-model")
    errors = [error, RuntimeError("Unrelated failure")]

    def invoke(**_kwargs: object) -> LLMResult:
        raise errors.pop(0)

    monkeypatch.setattr(model, "invoke_llm", invoke)
    prepared_model = DifyPreparedLLM(model)
    node = DifyParameterExtractorNode(
        node_id="extractor",
        data=ParameterExtractorNodeData.model_validate(
            {
                "type": "parameter-extractor",
                "title": "Extractor",
                "model": {"provider": "test-provider", "name": "test-model", "mode": "chat", "completion_params": {}},
                "query": ["sys", "query"],
                "parameters": [],
                "reasoning_mode": "prompt",
            }
        ),
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=build_test_variable_pool(), start_at=0.0),
        model_instance=prepared_model,
        prompt_message_serializer=DifyPromptMessageSerializer(),
    )
    context = _ParameterExtractorRunContext(
        model_instance=prepared_model,
        prompt_messages=[],
        prompt_message_tools=[],
        process_data={},
        inputs={"query": "query"},
    )
    monkeypatch.setattr(node, "_prepare_run_context", lambda: context)

    rejected = node._run()
    assert rejected.error_type == type(error).__name__
    assert rejected.error == str(error)
    assert node._moderation_error_type == ""

    unrelated = node._run()
    assert unrelated.error_type == ""
    assert unrelated.error == "Unrelated failure"
    assert node._moderation_error_type == ""
