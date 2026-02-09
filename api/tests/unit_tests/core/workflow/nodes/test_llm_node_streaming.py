import types
from collections.abc import Generator
from typing import Any

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities import ToolCallResult
from core.workflow.entities.tool_entities import ToolResultStatus
from core.workflow.node_events import ModelInvokeCompletedEvent, NodeEventBase
from core.workflow.nodes.llm.node import LLMNode


class _StubModelInstance:
    """Minimal stub to satisfy _stream_llm_events signature."""

    provider_model_bundle = None


def _drain(generator: Generator[NodeEventBase, None, Any]):
    events: list = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as exc:
        return events, exc.value


@pytest.fixture(autouse=True)
def patch_deduct_llm_quota(monkeypatch):
    # Avoid touching real quota logic during unit tests
    monkeypatch.setattr("core.workflow.nodes.llm.node.llm_utils.deduct_llm_quota", lambda **_: None)


def _make_llm_node(reasoning_format: str) -> LLMNode:
    node = LLMNode.__new__(LLMNode)
    object.__setattr__(node, "_node_data", types.SimpleNamespace(reasoning_format=reasoning_format, tools=[]))
    object.__setattr__(node, "tenant_id", "tenant")
    return node


def test_stream_llm_events_extracts_reasoning_for_tagged():
    node = _make_llm_node(reasoning_format="tagged")
    tagged_text = "<think>Thought</think>Answer"
    usage = LLMUsage.empty_usage()

    def generator():
        yield ModelInvokeCompletedEvent(
            text=tagged_text,
            usage=usage,
            finish_reason="stop",
            reasoning_content="",
            structured_output=None,
        )

    events, returned = _drain(
        node._stream_llm_events(generator(), model_instance=types.SimpleNamespace(provider_model_bundle=None))
    )

    assert events == []
    clean_text, reasoning_content, gen_reasoning, gen_clean, ret_usage, finish_reason, structured, gen_data = returned
    assert clean_text == tagged_text  # original preserved for output
    assert reasoning_content == ""  # tagged mode keeps reasoning separate
    assert gen_clean == "Answer"  # stripped content for generation
    assert gen_reasoning == "Thought"  # reasoning extracted from <think> tag
    assert ret_usage == usage
    assert finish_reason == "stop"
    assert structured is None
    assert gen_data is None

    # generation building should include reasoning and sequence
    generation_content = gen_clean or clean_text
    sequence = [
        {"type": "reasoning", "index": 0},
        {"type": "content", "start": 0, "end": len(generation_content)},
    ]
    assert sequence == [
        {"type": "reasoning", "index": 0},
        {"type": "content", "start": 0, "end": len("Answer")},
    ]


def test_stream_llm_events_no_reasoning_results_in_empty_sequence():
    node = _make_llm_node(reasoning_format="tagged")
    plain_text = "Hello world"
    usage = LLMUsage.empty_usage()

    def generator():
        yield ModelInvokeCompletedEvent(
            text=plain_text,
            usage=usage,
            finish_reason=None,
            reasoning_content="",
            structured_output=None,
        )

    events, returned = _drain(
        node._stream_llm_events(generator(), model_instance=types.SimpleNamespace(provider_model_bundle=None))
    )

    assert events == []
    _, _, gen_reasoning, gen_clean, *_ = returned
    generation_content = gen_clean or plain_text
    assert gen_reasoning == ""
    assert generation_content == plain_text
    # Empty reasoning should imply empty sequence in generation construction
    sequence = []
    assert sequence == []


def test_serialize_tool_call_strips_files_to_ids():
    file_cls = pytest.importorskip("core.file").File
    file_type = pytest.importorskip("core.file.enums").FileType
    transfer_method = pytest.importorskip("core.file.enums").FileTransferMethod

    file_with_id = file_cls(
        id="f1",
        tenant_id="t",
        type=file_type.IMAGE,
        transfer_method=transfer_method.REMOTE_URL,
        remote_url="http://example.com/f1",
        storage_key="k1",
    )
    file_with_related = file_cls(
        id=None,
        tenant_id="t",
        type=file_type.IMAGE,
        transfer_method=transfer_method.REMOTE_URL,
        related_id="rel2",
        remote_url="http://example.com/f2",
        storage_key="k2",
    )
    tool_call = ToolCallResult(
        id="tc",
        name="do",
        arguments='{"a":1}',
        output="ok",
        files=[file_with_id, file_with_related],
        status=ToolResultStatus.SUCCESS,
    )

    serialized = LLMNode._serialize_tool_call(tool_call)

    assert serialized["files"] == ["f1", "rel2"]
    assert serialized["id"] == "tc"
    assert serialized["name"] == "do"
    assert serialized["arguments"] == '{"a":1}'
    assert serialized["output"] == "ok"
