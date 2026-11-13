from collections.abc import Generator
from unittest.mock import sentinel

import pytest

from core.helper.ssrf_proxy import graphon_ssrf_proxy
from core.workflow.llm_node import DifyLLMNode
from core.workflow.node_runtime import DifyPreparedPollingLLM, DifyPromptMessageSerializer, build_dify_llm_file_saver
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.runtime import RuntimeState
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationInputRejectedInvocationError,
    PlatformModerationOutputRejectedInvocationError,
)
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context, build_test_variable_pool


@pytest.fixture
def polling_model() -> DifyPreparedPollingLLM:
    return DifyPreparedPollingLLM(make_model_instance(provider="test-provider", model="test-model"))


@pytest.fixture
def node(polling_model: DifyPreparedPollingLLM) -> DifyLLMNode:
    return DifyLLMNode(
        node_id="llm",
        data=LLMNodeData.model_validate(
            {
                "type": "llm",
                "title": "LLM",
                "model": {"provider": "test-provider", "name": "test-model", "mode": "chat", "completion_params": {}},
                "prompt_template": [],
                "context": {"enabled": False},
            }
        ),
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=build_test_variable_pool(), start_at=0.0),
        model_instance=polling_model,
        llm_file_saver=build_dify_llm_file_saver(run_context=build_test_run_context(), http_client=graphon_ssrf_proxy),
        prompt_message_serializer=DifyPromptMessageSerializer(),
        polling_finalizer=polling_model.finalize_llm_polling,
    )


@pytest.mark.parametrize(
    "error",
    [
        PlatformModerationInputRejectedInvocationError("Rejected"),
        PlatformModerationOutputRejectedInvocationError("Rejected"),
        ModerationUnavailableInvocationError(),
    ],
)
def test_llm_failure_result_retains_moderation_type(
    monkeypatch: pytest.MonkeyPatch, node: DifyLLMNode, error: Exception
) -> None:
    def prepare(*, node_inputs: dict[str, object]) -> Generator[object]:
        assert node_inputs == {}
        raise error

    monkeypatch.setattr(node, "_prepare_run_prompt", prepare)
    [completed] = list(node._run())
    assert completed.node_run_result.error_type == type(error).__name__
    assert completed.node_run_result.error == str(error)


def test_dify_llm_node_finalizes_polling_when_generator_is_closed(
    monkeypatch: pytest.MonkeyPatch, node: DifyLLMNode, polling_model: DifyPreparedPollingLLM
) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args
        assert kwargs["file_outputs"] == []
        yield sentinel.event
        yield sentinel.unconsumed

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalized: list[None] = []
    node._polling_finalizer = lambda: finalized.append(None)

    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=polling_model,
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    events.close()

    assert finalized == [None]


def test_dify_llm_node_finalizes_polling_when_polling_fails(
    monkeypatch: pytest.MonkeyPatch, node: DifyLLMNode, polling_model: DifyPreparedPollingLLM
) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args, kwargs
        yield sentinel.event
        raise RuntimeError("polling failed")

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalized: list[None] = []
    node._polling_finalizer = lambda: finalized.append(None)
    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=polling_model,
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    with pytest.raises(RuntimeError, match="polling failed"):
        next(events)

    assert finalized == [None]
