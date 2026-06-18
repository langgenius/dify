import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceTask


class _DummySession:
    scalar_values: list[object | None] = []

    def __init__(self, engine):
        self._values = list(self.scalar_values)
        self._index = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def execute(self, *args, **kwargs):
        return self

    def scalar(self, *args, **kwargs):
        if self._index >= len(self._values):
            return None
        value = self._values[self._index]
        self._index += 1
        return value

    def scalars(self, *args, **kwargs):
        return self

    def all(self):
        return []


def _make_workflow_run():
    return SimpleNamespace(
        workflow_id="wf-1",
        tenant_id="tenant-1",
        id="run-1",
        elapsed_time=1,
        status="succeeded",
        inputs_dict={},
        outputs_dict={},
        version="1",
        error=None,
        total_tokens=0,
        created_at=datetime(2026, 1, 1, 0, 0, 0),
        finished_at=datetime(2026, 1, 1, 0, 0, 1),
        triggered_from="user",
        app_id="app-1",
        to_dict=lambda self=None: {"id": "run-1"},
    )


def _make_message_data():
    created_at = datetime(2026, 1, 1, 0, 0, 0)
    data = {
        "id": "message-1",
        "app_id": "app-1",
        "conversation_id": "conv-1",
        "created_at": created_at,
        "updated_at": created_at + timedelta(seconds=1),
        "message": "hello",
        "provider_response_latency": 1,
        "message_tokens": 0,
        "answer_tokens": 0,
        "answer": "world",
        "error": "",
        "status": "normal",
        "model_provider": "provider",
        "model_id": "model",
        "from_end_user_id": "end-user-1",
        "from_account_id": None,
        "agent_based": False,
        "workflow_run_id": None,
        "from_source": "api",
        "message_metadata": json.dumps({"usage": {}}),
    }

    class _MessageData:
        def __init__(self, values):
            self.__dict__.update(values)

        def to_dict(self):
            return dict(self.__dict__)

    return _MessageData(data)


def test_workflow_trace_metadata_includes_trace_session_id(monkeypatch):
    repo = MagicMock()
    repo.get_workflow_run_by_id_without_tenant.return_value = _make_workflow_run()
    monkeypatch.setattr(TraceTask, "_get_workflow_run_repo", classmethod(lambda cls: repo))
    monkeypatch.setattr("core.ops.ops_trace_manager.Session", _DummySession)
    monkeypatch.setattr("core.ops.ops_trace_manager.db", SimpleNamespace(engine=MagicMock()))
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)
    _DummySession.scalar_values = [None, None]

    task = TraceTask(
        TraceTaskName.WORKFLOW_TRACE,
        workflow_execution=SimpleNamespace(id_="run-1", total_tokens=0),
        conversation_id="conv-1",
        user_id="user-1",
        trace_session_id="session-1",
    )

    trace_info = task.workflow_trace(workflow_run_id="run-1", conversation_id="conv-1", user_id="user-1")

    assert task.kwargs["trace_session_id"] == "session-1"
    assert trace_info.metadata["trace_session_id"] == "session-1"


def test_message_trace_metadata_includes_trace_session_id(monkeypatch):
    db_session = MagicMock()
    db_session.scalars.return_value.all.return_value = ["chat"]
    db_session.scalar.return_value = None
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.db",
        SimpleNamespace(engine=MagicMock(), session=db_session),
    )
    monkeypatch.setattr("core.ops.ops_trace_manager.Session", _DummySession)
    monkeypatch.setattr("core.ops.ops_trace_manager.get_message_data", lambda message_id, session: _make_message_data())
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)
    _DummySession.scalar_values = ["tenant-1"]

    task = TraceTask(
        TraceTaskName.MESSAGE_TRACE,
        message_id="message-1",
        trace_session_id="session-1",
    )

    trace_info = task.message_trace(message_id="message-1", **task.kwargs)

    assert task.kwargs["trace_session_id"] == "session-1"
    assert trace_info.metadata["trace_session_id"] == "session-1"
