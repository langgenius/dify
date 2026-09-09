import json
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from itertools import repeat
from threading import Lock
from typing import override
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import pytest

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.completion_trace import record_completion_result
from core.ops.legacy_agent_trace import record_legacy_agent_result
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


@pytest.mark.parametrize("custom_result", [False, True])
def test_saved_message_loads_committed_fields_and_finishes_once(custom_result: bool) -> None:
    initial, queue = make_recorder()
    fields = message_fields(initial)
    load_fields = Mock(return_value=fields)
    recorder = MessageTraceRecorder(
        initial.source,
        queue,
        initial.provider_settings,
        load_message_fields=load_fields,
        record_message_result=record_basic_chat_result if custom_result else None,
    )
    recorder.record_operation("retrieval", outputs=["document"])
    bound_source = recorder.source
    recorder.bind_message(str(uuid4()), str(uuid4()))
    assert recorder.source == bound_source
    assert recorder.source.message_id is not None
    recorder.record_saved_message(recorder.source.message_id)
    load_fields.assert_called_once_with(recorder.source.message_id)
    recorder.finish_message_trace(fields)
    recorder.bind_message(str(uuid4()), str(uuid4()))
    assert recorder.source == bound_source
    assert len(queue.items) == 1
    assert queue.reserved == 0
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert trace.spans[-1].outputs == ["document"]
    assert len(trace.spans) == (3 if custom_result else 2)


def test_failed_message_lookup_releases_captured_budget(caplog: pytest.LogCaptureFixture) -> None:
    initial, queue = make_recorder()
    recorder = MessageTraceRecorder(
        initial.source,
        queue,
        initial.provider_settings,
        load_message_fields=Mock(side_effect=ValueError("private message details")),
    )
    recorder.record_operation("retrieval", outputs=["document"])
    assert queue.reserved > 0
    assert recorder.source.message_id is not None
    recorder.record_saved_message(recorder.source.message_id)
    assert queue.reserved == 0
    assert not queue.items
    assert "Cannot record message trace" in caplog.text
    assert "private message details" not in caplog.text


def test_invalid_operation_is_reported_once_without_losing_other_spans() -> None:
    recorder, queue = make_recorder()
    recorder.record_operation("tool", outputs="answer")
    recorder.record_operation("broken", timer={"start": "invalid timestamp"})
    recorder.record_operation("broken again", timer={"start": "invalid timestamp"})
    recorder.finish_message_trace(message_fields(recorder))
    recorder.mark_incomplete("too late")
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert not trace.complete
    assert trace.truncation["reasons"] == ["operation_capture_failed"]
    assert [span.span_name for span in trace.spans] == ["message", "tool"]
    assert queue.reserved == 0


def test_one_destination_failure_does_not_block_other_exports(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    recorder, queue = make_recorder()
    destination = recorder.provider_settings[0]
    recorder.provider_settings = (destination, destination.model_copy(update={"config_id": str(uuid4())}))
    submit = Mock(side_effect=[ValueError("private export contents"), True])
    monkeypatch.setattr(queue, "submit_trace", submit)
    recorder.finish_message_trace(message_fields(recorder))
    assert submit.call_count == 2
    assert queue.reserved == 0
    assert "Cannot submit trace" in caplog.text
    assert "private export contents" not in caplog.text


def test_operation_without_message_has_no_parent_reference() -> None:
    initial, queue = make_recorder()
    recorder = MessageTraceRecorder(
        initial.source.model_copy(update={"message_id": None, "conversation_id": None, "actor_id": "actor"}),
        queue,
        initial.provider_settings,
    )
    recorder.record_operation("prompt_generation", inputs="instructions", outputs="prompt")
    assert recorder.user_id == "actor"
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert trace.parent is None
    assert trace.source.message_id is None
    assert trace.spans[0].inputs == "instructions"
    assert queue.reserved == 0


def test_resuming_workflow_uses_checkpoint_destination_revision() -> None:
    recorder, queue = make_recorder()
    workflow_id, run_id = str(uuid4()), str(uuid4())
    workflow = recorder.create_workflow_trace(
        workflow_id=workflow_id, workflow_version="1", workflow_run_id=run_id, inputs={}
    )
    checkpoint = workflow.save_pause_state()
    recorder.provider_settings = (recorder.provider_settings[0].model_copy(update={"config_revision": 99}),)
    resumed = recorder.create_workflow_trace(
        workflow_id=workflow_id,
        workflow_version="1",
        workflow_run_id=run_id,
        inputs={},
        workflow_trace_state=checkpoint,
    )
    assert recorder.provider_settings[0].config_revision == 0
    resumed.save_pause_state()
    assert queue.reserved == 0


def test_legacy_agent_thoughts_preserve_usage_and_tenant_query(monkeypatch: pytest.MonkeyPatch) -> None:
    from extensions import ext_database
    from models.enums import CreatorUserRole
    from models.model import MessageAgentThought

    recorder, queue = make_recorder()
    assert recorder.source.message_id is not None
    thought = MessageAgentThought(
        message_id=recorder.source.message_id,
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        message="question",
        thought="reasoning",
        answer="answer",
        tool="search;calculate",
        latency=0.5,
        message_token=2,
        answer_token=3,
        tokens=5,
        currency="USD",
    )
    thought.created_at = datetime(2026, 9, 9, tzinfo=UTC)
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.return_value = [thought]
    monkeypatch.setattr("sqlalchemy.orm.Session", Mock(return_value=context))
    monkeypatch.setattr(ext_database, "db", Mock(engine=Mock()))
    record_legacy_agent_result(recorder, message_fields(recorder))
    statement = session.scalars.call_args.args[0]
    sql = str(statement)
    assert "apps.tenant_id" in sql
    assert "apps.id" in sql
    assert "messages.id" in sql
    parameters = statement.compile().params
    for identifier in (recorder.source.tenant_id, recorder.source.app_id, recorder.source.message_id):
        assert identifier in parameters.values()
    assert 10001 in parameters.values()
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert trace.complete
    root, captured = trace.spans
    assert root.span_name == "Legacy Agent"
    assert captured.inputs == "question"
    assert captured.outputs == {"thought": "reasoning", "answer": "answer", "tools": ["search", "calculate"]}
    assert captured.usage["total_tokens"] == 5
    assert captured.attributes["metrics_from_parent"] is True
    assert captured.started_at == thought.created_at
    assert captured.ended_at == thought.created_at + timedelta(seconds=0.5)
    assert queue.reserved == 0


@pytest.mark.parametrize("unavailable", [False, True])
def test_legacy_agent_missing_or_excessive_thoughts_are_explicit(
    monkeypatch: pytest.MonkeyPatch, unavailable: bool
) -> None:
    from extensions import ext_database

    recorder, queue = make_recorder()
    context = MagicMock()
    session = context.__enter__.return_value
    record = Mock()
    monkeypatch.setattr(recorder, "record_operation", record)
    monkeypatch.setattr("sqlalchemy.orm.Session", Mock(return_value=context))
    monkeypatch.setattr(ext_database, "db", Mock(engine=Mock()))
    if unavailable:
        session.scalars.side_effect = OSError("database unavailable")
    else:
        thought = Mock(position=1, created_at=datetime(2026, 9, 9, tzinfo=UTC), latency=None)
        session.scalars.return_value = repeat(thought, 10001)
    record_legacy_agent_result(recorder, message_fields(recorder))
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert not trace.complete
    assert trace.truncation["reasons"] == ["agent_thoughts_unavailable" if unavailable else "agent_thought_limit"]
    assert record.call_count == (0 if unavailable else 10000)
    assert trace.spans[0].span_name == "Legacy Agent"
