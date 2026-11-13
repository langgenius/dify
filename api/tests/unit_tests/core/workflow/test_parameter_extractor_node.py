from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.workflow.llm_node import DifyParameterExtractorNode
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationInputRejectedInvocationError,
    PlatformModerationOutputRejectedInvocationError,
)


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
    node = object.__new__(DifyParameterExtractorNode)
    model = Mock(parameters={}, stop=[])
    model.invoke_llm.side_effect = [error, RuntimeError("Unrelated failure")]
    context = SimpleNamespace(
        model_instance=model, prompt_messages=[], prompt_message_tools=[], process_data={}, inputs={"query": "query"}
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
