import json
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Lock
from typing import override
from uuid import uuid4

import pytest

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.completion_trace import record_completion_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, QueuedTrace, TraceProviderSettings, TraceSource, copy_trace_value
from core.ops.trace_queue import TraceQueue


class RecordingQueue(TraceQueue):
    def __init__(self, limit: int = 8388608) -> None:
        self.items: list[QueuedTrace] = []
        self.reserved = 0
        self.limit = limit
        self.lock = Lock()

    @override
    def submit_trace(self, queued_trace: QueuedTrace) -> bool:
        with self.lock:
            self.items.append(queued_trace)
        return True

    @override
    def reserve_recording_bytes(self, tenant_id: str, byte_count: int) -> bool:
        with self.lock:
            if self.reserved + byte_count > self.limit:
                return False
            self.reserved += byte_count
        return True

    @override
    def release_recording_bytes(self, tenant_id: str, byte_count: int) -> None:
        with self.lock:
            self.reserved -= byte_count
            assert self.reserved >= 0


def make_recorder(queue: RecordingQueue | None = None) -> tuple[MessageTraceRecorder, RecordingQueue]:
    source = TraceSource(tenant_id=str(uuid4()), operation_id=str(uuid4()), app_id=str(uuid4()))
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=source.app_id, provider_name="langfuse", config_id=str(uuid4())
    )
    queue = queue or RecordingQueue()
    recorder = MessageTraceRecorder(source, queue, (settings,))
    recorder.bind_message(str(uuid4()), str(uuid4()), external_trace_id="external", session_id="session")
    return recorder, queue


def message_fields(recorder: MessageTraceRecorder) -> dict[str, object]:
    return {
        "message_id": recorder.source.message_id,
        "conversation_id": recorder.source.conversation_id,
        "inputs": [{"role": "user", "text": "hello"}],
        "outputs": "answer",
        "model_name": "test-model",
        "prompt_tokens": 2,
        "completion_tokens": 3,
        "metadata": {"usage": {"time_to_first_token": 0.5}},
        "started_at": datetime.now(UTC),
        "ended_at": datetime.now(UTC),
    }


@pytest.mark.parametrize("record_result", [record_basic_chat_result, record_completion_result])
def test_parallel_operations_are_copied_and_message_submission_releases_budget(
    record_result: Callable[[MessageTraceRecorder, Mapping[str, object]], None],
) -> None:
    recorder, queue = make_recorder()
    query = ["original"]
    inputs = {"query": query, "api_key": "never-export"}
    with ThreadPoolExecutor(max_workers=8) as threads:
        list(threads.map(lambda index: recorder.record_operation(f"tool {index}", inputs=inputs), range(100)))
    query.append("changed")
    record_result(recorder, message_fields(recorder))
    assert recorder.source.message_id is not None
    recorder.record_saved_message(recorder.source.message_id)
    recorder.close()
    assert queue.reserved == 0
    assert len(queue.items) == 1
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert len(trace.spans) == 102
    assert trace.source.external_trace_id == "external"
    assert trace.source.session_id == "session"
    for span in trace.spans[2:]:
        assert span.inputs == {"query": ["original"]}
        assert span.parent_span_id == trace.root_span_id


def test_late_operation_references_original_destination_and_message_root() -> None:
    recorder, queue = make_recorder()
    recorder.finish_message_trace(message_fields(recorder))
    first = queue.items[0]
    recorder.record_operation("suggested_questions", outputs=["next?"], independent=True)
    late = CompletedTrace.model_validate_json(queue.items[1].trace_json)
    assert late.parent is not None
    assert late.parent.export_id == first.export_id
    assert late.parent.span_id == CompletedTrace.model_validate_json(first.trace_json).root_span_id
    assert late.source.operation_id != recorder.source.operation_id
    with pytest.raises(ValueError, match="different tenants"):
        QueuedTrace.from_trace(late, recorder.provider_settings[0].model_copy(update={"tenant_id": str(uuid4())}))


def test_budget_exhaustion_is_explicit_and_close_releases_unfinished_spans() -> None:
    recorder, queue = make_recorder(RecordingQueue(limit=1))
    recorder.record_operation("tool", outputs="answer")
    recorder.finish_message_trace(message_fields(recorder))
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert not trace.complete
    assert trace.truncation["omitted_spans"] == 1
    recorder, queue = make_recorder()
    recorder.record_operation("tool")
    assert queue.reserved > 0
    recorder.close()
    assert queue.reserved == 0


def test_recursive_trace_values_are_bounded_and_do_not_keep_credentials() -> None:
    from pydantic import BaseModel

    class ModelResult(BaseModel):
        data: dict[str, object]
        password: str

    value: dict[str, object] = {"nested": {"authorization": "secret", "answer": "a" * 200000}, "password": "secret"}
    value["cycle"] = value
    copied = copy_trace_value(value)
    assert isinstance(copied, dict)
    assert "password" not in copied
    assert isinstance(copied["nested"], dict)
    assert "authorization" not in copied["nested"]
    assert isinstance(copied["nested"]["answer"], str)
    assert len(copied["nested"]["answer"]) < 65536
    copied_model = copy_trace_value(ModelResult(data=value, password="secret"))
    assert isinstance(copied_model, dict)
    assert isinstance(copied_model["data"], dict)
    assert isinstance(copied_model["data"]["nested"], dict)
    assert "password" not in copied_model
    assert "authorization" not in copied_model["data"]["nested"]
    assert len(json.dumps(copied_model, ensure_ascii=False).encode()) <= 65536


def test_json_byte_budget_accounts_for_escaped_characters_and_signed_urls() -> None:
    copied = copy_trace_value({"value": "\x00" * 100000})
    assert len(json.dumps(copied, ensure_ascii=False).encode()) <= 65536
    assert copy_trace_value("https://files.example/a?X-Amz-Signature=secret&name=x") == "https://files.example/a"
    for value in ({"字段" * 128 + str(i): "value" for i in range(256)}, [1e200] * 256, [2**1000] * 256):
        assert len(json.dumps(copy_trace_value(value, max_bytes=512), ensure_ascii=False).encode()) <= 512
