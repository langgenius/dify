from collections.abc import Generator
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock, sentinel

import pytest

from core.workflow.llm_node import DifyLLMNode
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol


def test_dify_llm_node_finalizes_polling_when_generator_is_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object, None, None]:
        _ = args, kwargs
        yield sentinel.event
        yield sentinel.unconsumed

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalizer = Mock()
    node = object.__new__(DifyLLMNode)
    node._polling_finalizer = finalizer

    events = node._invoke_llm_with_polling(
        polling_model=cast(LLMPollingCapableProtocol, SimpleNamespace()),
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    events.close()

    finalizer.assert_called_once_with()


def test_dify_llm_node_finalizes_polling_when_polling_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object, None, None]:
        _ = args, kwargs
        yield sentinel.event
        raise RuntimeError("polling failed")

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalizer = Mock()
    node = object.__new__(DifyLLMNode)
    node._polling_finalizer = finalizer
    events = node._invoke_llm_with_polling(
        polling_model=cast(LLMPollingCapableProtocol, SimpleNamespace()),
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    with pytest.raises(RuntimeError, match="polling failed"):
        next(events)

    finalizer.assert_called_once_with()
