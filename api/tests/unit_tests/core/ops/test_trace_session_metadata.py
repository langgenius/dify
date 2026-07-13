import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceTask
from models.model import App, AppMode, Conversation, Message, MessageFile
from models.workflow import WorkflowAppLog, WorkflowNodeExecutionModel

TABLES = (App, Conversation, Message, MessageFile, WorkflowAppLog, WorkflowNodeExecutionModel)


@pytest.fixture(autouse=True)
def _bind_trace_database(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    """Use real SQLite sessions for ORM lookups without changing trace-domain data."""
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.db",
        SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
    )


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


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_workflow_trace_metadata_includes_trace_session_id(monkeypatch, sqlite_session: Session):
    repo = MagicMock()
    repo.get_workflow_run_by_id_without_tenant.return_value = _make_workflow_run()
    monkeypatch.setattr(TraceTask, "_get_workflow_run_repo", classmethod(lambda cls: repo))
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)

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


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_message_trace_metadata_includes_trace_session_id(monkeypatch, sqlite_session: Session):
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Trace App",
        description="",
        mode=AppMode.CHAT,
        icon_type=None,
        icon=None,
        icon_background=None,
        app_model_config_id=None,
        workflow_id=None,
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
        created_by=None,
    )
    conversation = Conversation(
        id="conv-1",
        app_id=app.id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.CHAT,
        name="Trace Conversation",
        summary=None,
        inputs={},
        introduction="",
        system_instruction="",
        invoke_from=None,
        from_source="api",
        from_end_user_id="end-user-1",
        from_account_id=None,
        read_at=None,
        read_account_id=None,
    )
    sqlite_session.add_all([app, conversation])
    sqlite_session.commit()

    monkeypatch.setattr("core.ops.ops_trace_manager.get_message_data", lambda message_id: _make_message_data())
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)

    task = TraceTask(
        TraceTaskName.MESSAGE_TRACE,
        message_id="message-1",
        trace_session_id="session-1",
    )

    trace_info = task.message_trace(message_id="message-1", **task.kwargs)

    assert task.kwargs["trace_session_id"] == "session-1"
    assert trace_info.metadata["trace_session_id"] == "session-1"
