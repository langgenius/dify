import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_weave.weave_trace import WeaveTraceClient
from pydantic import JsonValue

from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.model_runtime.entities import ImagePromptMessageContent, TextPromptMessageContent, UserPromptMessage
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node


def export_calls(trace: CompletedTrace, legacy_server: bool, monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Decode accepted Weave requests after the real provider transport serializes them."""
    calls: list[dict[str, Any]] = []
    starts: dict[str, dict[str, Any]] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if request.url.path == "/graphql":
            return httpx.Response(200, json={"data": {"project": {"name": "project"}}})
        if request.url.path.endswith("/calls/complete"):
            if legacy_server:
                return httpx.Response(404)
            calls.extend(body["batch"])
        elif request.url.path == "/call/upsert_batch":
            for event in body["batch"]:
                if event["mode"] == "start":
                    start = event["req"]["start"]
                    starts[start["id"]] = start
                else:
                    end = event["req"]["end"]
                    calls.append({**starts[end["id"]], **end})
        else:
            pytest.fail(f"Unexpected Weave endpoint: {request.url.path}")
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    client = WeaveTraceClient({"api_key": "key", "entity": "team", "project": "project"})
    original = trace.model_dump_json()
    client.export_trace(trace)
    assert trace.model_dump_json() == original
    assert len(calls) == len(trace.spans)
    return calls


@pytest.mark.parametrize("legacy_server", [False, True])
@pytest.mark.parametrize("mode", ["chat", "completion", "agent-chat", "advanced-chat"])
def test_recorded_multimodal_messages_keep_native_prompts_answers_usage_and_files(
    monkeypatch: pytest.MonkeyPatch, mode: str, legacy_server: bool
) -> None:
    source = TraceSource(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        actor_id=str(uuid4()),
        operation_id=str(uuid4()),
        message_id=str(uuid4()),
    )
    recorder = MessageTraceRecorder(source, Mock(), (), attributes={"app_mode": mode})
    submitted = Mock(return_value=True)
    monkeypatch.setattr(recorder, "submit_completed_trace", submitted)
    started_at = datetime(2026, 9, 12, tzinfo=UTC)
    prompts = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
        "completion" if mode == "completion" else "chat",
        [
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="Describe this image"),
                    ImagePromptMessageContent(
                        url="https://files.example/picture.jpg", format="jpg", mime_type="image/jpeg"
                    ),
                ]
            )
        ],
    )
    assert prompts[0]["text"] == "Describe this image"
    assert prompts[0]["files"][0]["type"] == "image"
    if mode == "agent-chat":
        # Legacy agent result capture records thought spans and uses the message root for the full chat.
        recorder.record_operation(
            "Agent round 1",
            span_type="llm",
            inputs="",
            outputs={"thought": "Inspect image", "answer": "A cat"},
            timer={"start": started_at, "end": started_at + timedelta(seconds=1)},
            attributes={"operation_type": "llm", "agent_round": 1, "metrics_from_parent": True},
        )
    recorder.finish_message_trace(
        {
            "message_id": source.message_id,
            "conversation_id": str(uuid4()),
            "workflow_run_id": str(uuid4()) if mode == "advanced-chat" else None,
            "inputs": prompts,
            "outputs": "A cat",
            "model_name": "vision-model",
            "model_provider": "provider",
            "started_at": started_at,
            "ended_at": started_at + timedelta(seconds=2),
            "prompt_tokens": 3,
            "completion_tokens": 5,
            "files": [
                {"type": "image", "url": "https://files.example/picture.jpg", "upload_file_id": None},
                {"type": "image", "url": None, "upload_file_id": str(uuid4())},
            ],
            "metadata": {"conversation_mode": mode},
        },
        span_name="Legacy Agent" if mode == "agent-chat" else "message",
        include_llm=mode in {"chat", "completion"},
    )
    trace = CompletedTrace.model_validate_json(submitted.call_args.args[0].model_dump_json())
    captured_prompts = trace.spans[0].inputs
    assert isinstance(captured_prompts, list)
    assert isinstance(captured_prompts[0], dict)
    captured_files = captured_prompts[0]["files"]
    assert captured_files == [{"type": "image", "data": "[invalid URL]", "detail": "low"}]
    calls = export_calls(trace, legacy_server, monkeypatch)
    metadata = {
        "usage_metadata": {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8},
        "file_list": ["https://files.example/picture.jpg"],
    }
    for call in calls[:2] if mode in {"chat", "completion"} else calls[:1]:
        assert call["inputs"] == {
            "messages": [{"role": "user", "content": "Describe this image", "files": captured_files, **metadata}]
        }
        assert call["output"] == {"choices": {"role": "ai", "content": "A cat", **metadata}}
        assert call["attributes"]["dify.tenant_id"] == source.tenant_id
    if mode == "agent-chat":
        assert calls[1]["output"]["thought"] == "Inspect image"


@pytest.mark.parametrize("legacy_server", [False, True])
def test_recorded_workflow_model_preserves_multimodal_saved_prompts_and_structured_output(
    monkeypatch: pytest.MonkeyPatch, legacy_server: bool
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), actor_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []

    def submit_trace(trace: CompletedTrace) -> bool:
        submitted.append(trace)
        return True

    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={"query": "Describe image"},
        submit_completed_trace=submit_trace,
    )
    node = workflow_node(source, node_type="llm")
    start_node(recorder, node)
    prompts = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
        "chat",
        [
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="Image question"),
                    ImagePromptMessageContent(
                        url="https://files.example/image.jpg", format="jpg", mime_type="image/jpeg"
                    ),
                ]
            )
        ],
    )
    started_at = datetime.now(UTC)
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="llm",
            start_at=started_at,
            finished_at=started_at + timedelta(seconds=1),
            node_run_result=NodeRunResult(
                inputs={"query": "Describe image"},
                process_data={"prompts": prompts},
                outputs={"text": "A cat", "finish_reason": "stop", "structured_output": {"animal": "cat"}},
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    call = export_calls(trace, legacy_server, monkeypatch)[1]
    assert call["inputs"]["messages"][0]["content"] == "Image question"
    captured_prompts = trace.spans[1].inputs
    assert isinstance(captured_prompts, list)
    assert isinstance(captured_prompts[0], dict)
    assert call["inputs"]["messages"][0]["files"] == captured_prompts[0]["files"]
    assert call["inputs"]["messages"][0]["file_list"] == []
    assert call["output"]["text"] == "A cat"
    assert call["output"]["structured_output"] == {"animal": "cat"}


@pytest.mark.parametrize("legacy_server", [False, True])
def test_existing_native_content_and_structured_tool_data_are_preserved(
    monkeypatch: pytest.MonkeyPatch, legacy_server: bool
) -> None:
    trace = make_completed_trace()
    messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Native content"},
                {"type": "image_url", "image_url": {"url": "https://files.example/image.jpg"}},
            ],
        },
        {
            "role": "assistant",
            "content": "Native answer",
            "text": "extra captured field",
            "tool_calls": [{"id": "call-1", "function": {"name": "echo", "arguments": {"text": "keep argument"}}}],
        },
    ]
    span = trace.spans[-1].model_copy(
        update={
            "parent_span_id": None,
            "inputs": messages,
            "outputs": {"choices": [{"message": {"role": "assistant", "content": "Native answer"}}]},
        }
    )
    trace = trace.model_copy(update={"spans": (span,), "root_span_id": span.span_id})
    call = export_calls(trace, legacy_server, monkeypatch)[0]
    for expected, actual in zip(messages, call["inputs"]["messages"], strict=True):
        assert all(actual[key] == value for key, value in expected.items())
    assert isinstance(span.outputs, dict)
    assert call["output"]["choices"] == span.outputs["choices"]


@pytest.mark.parametrize("legacy_server", [False, True])
@pytest.mark.parametrize(
    ("inputs", "outputs", "expected_inputs", "expected_output"),
    [
        (None, None, {}, None),
        ({}, {}, {}, {}),
        (
            "question",
            "answer",
            {"messages": {"role": "user", "content": "question"}},
            {"choices": {"role": "ai", "content": "answer"}},
        ),
        (
            ["first", "second"],
            ["answer"],
            {"choices": {"role": "user", "content": "['first', 'second']"}},
            {"choices": {"role": "ai", "content": "['answer']"}},
        ),
        ([], [], {"choices": {"role": "user", "content": "[]"}}, {"choices": {"role": "ai", "content": "[]"}}),
        (
            {"query": "question", "nested": {"text": "retain field"}},
            {"text": "answer"},
            {"query": "question", "nested": {"text": "retain field"}},
            {"text": "answer"},
        ),
        (
            [{"role": "user", "text": "question"}],
            [{"role": "assistant", "text": "answer"}],
            {"messages": [{"role": "user", "content": "question"}]},
            {"choices": {"role": "ai", "content": [{"role": "assistant", "content": "answer"}]}},
        ),
        (
            {"messages": [{"role": "user", "content": "native"}]},
            {"choices": [{"text": "native"}]},
            {"messages": [{"role": "user", "content": "native"}]},
            {"choices": [{"text": "native"}]},
        ),
    ],
)
def test_native_scalar_list_and_structured_io_contract(
    monkeypatch: pytest.MonkeyPatch,
    legacy_server: bool,
    inputs: JsonValue,
    outputs: JsonValue,
    expected_inputs: dict[str, Any],
    expected_output: Any,
) -> None:
    trace = make_completed_trace()
    span = trace.spans[0].model_copy(update={"inputs": inputs, "outputs": outputs, "usage": {}})
    trace = trace.model_copy(update={"spans": (span,)})
    call = export_calls(trace, legacy_server, monkeypatch)[0]
    metadata = {"usage_metadata": {"input_tokens": None, "output_tokens": None, "total_tokens": None}, "file_list": []}
    for expected, actual in ((expected_inputs, call["inputs"]), (expected_output, call["output"])):
        if not expected:
            assert actual == expected
            continue
        assert isinstance(expected, dict)
        if "choices" in expected and isinstance(expected["choices"], dict):
            assert actual == {"choices": {**expected["choices"], **metadata}}
        elif isinstance(expected.get("messages"), dict):
            assert actual == {"messages": {**expected["messages"], **metadata}}
        elif isinstance(expected.get("messages"), list) and isinstance(inputs, list):
            assert actual == {"messages": [{**message, **metadata} for message in expected["messages"]]}
        else:
            assert actual == {**expected, **metadata}
