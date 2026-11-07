from collections.abc import Generator
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock, sentinel

import pytest

from core.workflow.llm_node import DifyLLMNode
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol


def test_dify_llm_node_finalizes_polling_when_generator_is_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args
        assert kwargs["file_outputs"] == []
        yield sentinel.event
        yield sentinel.unconsumed

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalizer = Mock()
    node = object.__new__(DifyLLMNode)
    node._polling_finalizer = finalizer

    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=cast(LLMPollingCapableProtocol, SimpleNamespace()),
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    events.close()

    finalizer.assert_called_once_with()


def test_dify_llm_node_finalizes_polling_when_polling_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args, kwargs
        yield sentinel.event
        raise RuntimeError("polling failed")

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalizer = Mock()
    node = object.__new__(DifyLLMNode)
    node._polling_finalizer = finalizer
    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=cast(LLMPollingCapableProtocol, SimpleNamespace()),
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    with pytest.raises(RuntimeError, match="polling failed"):
        next(events)

    finalizer.assert_called_once_with()


def _node_with_structured_output(*, switch_on: bool = True) -> DifyLLMNode:
    node = object.__new__(DifyLLMNode)
    node._node_data = LLMNodeData.model_construct(
        structured_output_switch_on=switch_on,
        structured_output={"schema": {"type": "object"}},
    )
    node._node_id = "node-id"
    return node


def test_dify_llm_node_hides_structured_output_from_graphon_while_preparing_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[bool] = []

    def prepare(self: LLMNode, **kwargs: object) -> Generator[object, None, object]:
        _ = kwargs
        # graphon rejects models without the `structured-output` feature when it sees this flag on.
        seen.append(self.node_data.structured_output_enabled)
        yield sentinel.event
        return sentinel.prepared

    monkeypatch.setattr(LLMNode, "_prepare_run_prompt", prepare)
    node = _node_with_structured_output()

    events = node._prepare_run_prompt(node_inputs={})

    assert next(events) is sentinel.event
    with pytest.raises(StopIteration) as stop:
        next(events)
    assert stop.value.value is sentinel.prepared
    assert seen == [False]
    # The invocation that follows must still request structured output.
    assert node.node_data.structured_output_enabled is True


def test_dify_llm_node_restores_structured_output_when_prompt_preparation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def prepare(self: LLMNode, **kwargs: object) -> Generator[object, None, object]:
        _ = self, kwargs
        yield sentinel.event
        raise RuntimeError("preparation failed")

    monkeypatch.setattr(LLMNode, "_prepare_run_prompt", prepare)
    node = _node_with_structured_output()
    events = node._prepare_run_prompt(node_inputs={})

    assert next(events) is sentinel.event
    with pytest.raises(RuntimeError, match="preparation failed"):
        next(events)

    assert node.node_data.structured_output_enabled is True


def test_dify_llm_node_restores_structured_output_when_prompt_generator_is_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def prepare(self: LLMNode, **kwargs: object) -> Generator[object]:
        _ = self, kwargs
        yield sentinel.event
        yield sentinel.unconsumed

    monkeypatch.setattr(LLMNode, "_prepare_run_prompt", prepare)
    node = _node_with_structured_output()
    events = node._prepare_run_prompt(node_inputs={})

    assert next(events) is sentinel.event
    events.close()

    assert node.node_data.structured_output_enabled is True


def test_dify_llm_node_keeps_structured_output_disabled_when_it_was_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def prepare(self: LLMNode, **kwargs: object) -> Generator[object, None, object]:
        _ = kwargs
        assert self.node_data.structured_output_enabled is False
        yield sentinel.event
        return sentinel.prepared

    monkeypatch.setattr(LLMNode, "_prepare_run_prompt", prepare)
    node = _node_with_structured_output(switch_on=False)

    events = node._prepare_run_prompt(node_inputs={})

    assert next(events) is sentinel.event
    with pytest.raises(StopIteration):
        next(events)
    assert node.node_data.structured_output_enabled is False
    assert node.node_data.structured_output_switch_on is False
