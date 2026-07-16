"""SQLite-backed tests for :mod:`core.ops.ops_trace_manager`."""

from __future__ import annotations

import contextlib
import json
import queue
from collections.abc import Iterator
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

import core.ops.ops_trace_manager as module
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager, TraceTask, TraceTaskName
from graphon.file import FileTransferMethod, FileType
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus
from models.model import App, AppMode, AppModelConfig, Conversation, Message, MessageFile, TraceAppConfig
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom


class DummyConfig:
    def __init__(self, **kwargs):
        self._data = kwargs

    def model_dump(self):
        return dict(self._data)


class DummyTraceInstance:
    def __init__(self, config):
        self.config = config

    def api_check(self):
        return True

    def get_project_key(self):
        return "fake-key"

    def get_project_url(self):
        return "https://project.fake"


class FakeProviderMap:
    def __init__(self, data):
        self._data = data

    def __getitem__(self, key):
        if key in self._data:
            return self._data[key]
        raise KeyError(key)


PROVIDER_ENTRY = {
    "config_class": DummyConfig,
    "secret_keys": ["secret_value"],
    "other_keys": ["other_value"],
    "trace_instance": DummyTraceInstance,
}


class DummyTimer:
    def __init__(self, interval, function):
        self.interval = interval
        self.function = function
        self.name = ""
        self.daemon = False
        self.started = False

    def start(self):
        self.started = True

    def is_alive(self):
        return False


@pytest.fixture
def database(sqlite_engine: Engine) -> Iterator[scoped_session[Session]]:
    models = (App, AppModelConfig, TraceAppConfig, Conversation, Message, MessageFile, WorkflowAppLog)
    TypeBase.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in models])
    session = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    with (
        patch.object(module.db, "session", session),
        patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=sqlite_engine),
    ):
        yield session
    session.remove()


@pytest.fixture
def trace_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "provider_config_map", FakeProviderMap({"dummy": PROVIDER_ENTRY}))
    OpsTraceManager.ops_trace_instances_cache.clear()
    OpsTraceManager.decrypted_configs_cache.clear()
    monkeypatch.setattr(module.threading, "Timer", DummyTimer)
    monkeypatch.setattr(module, "trace_manager_queue", queue.Queue())
    monkeypatch.setattr(module, "trace_manager_timer", None)

    class FakeApp:
        def app_context(self):
            return contextlib.nullcontext()

    current = MagicMock()
    current._get_current_object.return_value = FakeApp()
    monkeypatch.setattr(module, "current_app", current)
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)


@pytest.fixture
def encryption_mocks(monkeypatch: pytest.MonkeyPatch):
    encrypt = MagicMock(side_effect=lambda _tenant, value: f"enc-{value}")
    decrypt = MagicMock(side_effect=lambda _tenant, values: [f"dec-{value}" for value in values])
    obfuscate = MagicMock(side_effect=lambda value: f"ob-{value}")
    monkeypatch.setattr(module, "encrypt_token", encrypt)
    monkeypatch.setattr(module, "batch_decrypt_token", decrypt)
    monkeypatch.setattr(module, "obfuscated_token", obfuscate)
    return encrypt, decrypt, obfuscate


def _app(session: scoped_session[Session], *, app_id: str = "app-id", tracing: str | None = None) -> App:
    app = App(
        id=app_id,
        tenant_id="tenant-1",
        name="App",
        description="description",
        mode=AppMode.CHAT,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
        tracing=tracing,
    )
    session.add(app)
    session.commit()
    return app


def _conversation_message(
    session: scoped_session[Session], app: App, *, config: AppModelConfig | None = None
) -> tuple[Conversation, Message]:
    conversation = Conversation(
        id="conversation-1",
        app_id=app.id,
        app_model_config_id=config.id if config else None,
        model_provider="provider",
        override_model_configs=None,
        model_id="model",
        mode=AppMode.CHAT,
        name="Conversation",
        summary="",
        _inputs={},
        introduction="",
        system_instruction="",
        invoke_from=None,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id="end-user-1",
        from_account_id=None,
        read_at=None,
        read_account_id=None,
    )
    message = Message(
        id="message-1",
        app_id=app.id,
        model_provider="provider",
        model_id="model",
        override_model_configs=None,
        conversation_id=conversation.id,
        _inputs={},
        query="query",
        message={"text": "hello"},
        message_tokens=5,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal("0.001"),
        answer="world",
        answer_tokens=7,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal("0.001"),
        parent_message_id=None,
        provider_response_latency=1,
        total_price=Decimal(0),
        currency="USD",
        status=MessageStatus.NORMAL,
        error=None,
        message_metadata=None,
        invoke_from=None,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id="end-user-1",
        from_account_id=None,
        agent_based=False,
        workflow_run_id="run-1",
        app_mode=AppMode.CHAT,
    )
    session.add_all([conversation, message])
    session.commit()
    return conversation, message


def _message_data(**overrides):
    created_at = datetime(2025, 2, 20, 12, 0, 0)
    data = {
        "id": "message-1",
        "app_id": "app-id",
        "conversation_id": "conversation-1",
        "created_at": created_at,
        "updated_at": created_at + timedelta(seconds=3),
        "message": "hello",
        "provider_response_latency": 1,
        "message_tokens": 5,
        "answer_tokens": 7,
        "answer": "world",
        "error": "",
        "status": "complete",
        "model_provider": "provider",
        "model_id": "model",
        "from_end_user_id": "end-user-1",
        "from_account_id": None,
        "agent_based": False,
        "workflow_run_id": "run-1",
        "from_source": "console",
        "message_metadata": json.dumps({"usage": {"time_to_first_token": 1, "time_to_generate": 2}}),
        "agent_thoughts": [],
        "query": "query",
        "inputs": "inputs",
    }
    data.update(overrides)
    return SimpleNamespace(**data, to_dict=lambda: data)


def _workflow_run():
    return SimpleNamespace(
        workflow_id="workflow-1",
        tenant_id="tenant-1",
        id="run-1",
        elapsed_time=10,
        status="finished",
        inputs_dict={"query": "search"},
        outputs_dict={"out": "value"},
        version="3",
        error=None,
        total_tokens=12,
        created_at=datetime(2025, 2, 20, 10, 0, 0),
        finished_at=datetime(2025, 2, 20, 10, 0, 5),
        triggered_from="user",
        app_id="app-id",
        to_dict=lambda: {"run": "value"},
    )


def test_encrypt_decrypt_obfuscate_and_cache(
    trace_environment: None, encryption_mocks: tuple[MagicMock, MagicMock, MagicMock]
) -> None:
    encrypted = OpsTraceManager.encrypt_tracing_config(
        "tenant-1", "dummy", {"secret_value": "value", "other_value": "info"}
    )
    assert encrypted == {"secret_value": "enc-value", "other_value": "info"}
    preserved = OpsTraceManager.encrypt_tracing_config(
        "tenant-1", "dummy", {"secret_value": "*"}, current_trace_config={"secret_value": "keep"}
    )
    assert preserved["secret_value"] == "keep"
    first = OpsTraceManager.decrypt_tracing_config("tenant-1", "dummy", encrypted)
    second = OpsTraceManager.decrypt_tracing_config("tenant-1", "dummy", encrypted)
    assert first == second
    assert encryption_mocks[1].call_count == 1
    assert OpsTraceManager.obfuscated_decrypt_token("dummy", first)["secret_value"].startswith("ob-")


def test_decrypted_config_reads_real_trace_and_app_rows(
    trace_environment: None,
    encryption_mocks,
    database: scoped_session[Session],
) -> None:
    app = _app(database)
    trace = TraceAppConfig(
        app_id=app.id,
        tracing_provider="dummy",
        tracing_config={"secret_value": "encrypted", "other_value": "info"},
    )
    database.add(trace)
    database.commit()
    result = OpsTraceManager.get_decrypted_tracing_config(app.id, "dummy")
    assert result == {"secret_value": "dec-encrypted", "other_value": "info"}
    assert OpsTraceManager.get_decrypted_tracing_config(app.id, "missing") is None
    database.delete(app)
    database.commit()
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy")


def test_ops_trace_instance_uses_persisted_enabled_state_and_cache(
    trace_environment: None,
    encryption_mocks,
    database: scoped_session[Session],
) -> None:
    app = _app(database, tracing=json.dumps({"enabled": False, "tracing_provider": "dummy"}))
    assert OpsTraceManager.get_ops_trace_instance(app.id) is None
    app.tracing = json.dumps({"enabled": True, "tracing_provider": "dummy"})
    database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={"secret_value": "encrypted"}))
    database.commit()
    instance = OpsTraceManager.get_ops_trace_instance(app.id)
    assert isinstance(instance, DummyTraceInstance)
    assert OpsTraceManager.get_ops_trace_instance(app.id) is instance
    assert OpsTraceManager.get_ops_trace_instance("missing") is None


def test_message_config_lookup_uses_real_conversation_and_model_config(database: scoped_session[Session]) -> None:
    app = _app(database)
    config = AppModelConfig(app_id=app.id, model='{"provider":"openai"}')
    database.add(config)
    database.commit()
    _, message = _conversation_message(database, app, config=config)
    result = OpsTraceManager.get_app_config_through_message_id(message.id)
    assert result.id == config.id
    assert OpsTraceManager.get_app_config_through_message_id("missing") is None


def test_update_and_get_app_tracing_config_persist_state(
    trace_environment: None, database: scoped_session[Session]
) -> None:
    app = _app(database)
    assert OpsTraceManager.get_app_tracing_config(app.id, database()) == {
        "enabled": False,
        "tracing_provider": None,
    }
    OpsTraceManager.update_app_tracing_config(app.id, True, "dummy")
    database.expire_all()
    assert OpsTraceManager.get_app_tracing_config(app.id, database()) == {
        "enabled": True,
        "tracing_provider": "dummy",
    }
    with pytest.raises(ValueError, match="Invalid tracing provider"):
        OpsTraceManager.update_app_tracing_config(app.id, True, "missing")
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.get_app_tracing_config("missing", database())


def test_message_trace_reads_real_conversation_app_and_message_file(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    database: scoped_session[Session],
) -> None:
    app = _app(database)
    _, message = _conversation_message(database, app)
    file = MessageFile(
        message_id=message.id,
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        url="path/to/file",
    )
    database.add(file)
    database.commit()
    monkeypatch.setattr(module, "get_message_data", lambda _message_id: _message_data())
    result = TraceTask(trace_type=TraceTaskName.MESSAGE_TRACE, message_id=message.id).message_trace(message.id)
    assert result.message_id == message.id
    assert result.conversation_mode == AppMode.CHAT
    assert result.file_list[0].endswith("path/to/file")
    assert result.metadata["tenant_id"] == "tenant-1"


def test_workflow_log_enriches_moderation_and_suggested_question_traces(
    monkeypatch: pytest.MonkeyPatch,
    database: scoped_session[Session],
) -> None:
    log = WorkflowAppLog(
        tenant_id="tenant-1",
        app_id="app-id",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        created_from=WorkflowAppLogCreatedFrom.WEB_APP,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
    )
    database.add(log)
    database.commit()
    monkeypatch.setattr(module, "get_message_data", lambda _message_id: _message_data())
    task = TraceTask(trace_type=TraceTaskName.MODERATION_TRACE, message_id="message-1")
    moderation = SimpleNamespace(action="block", preset_response="no", query="q", flagged=True)
    result = task.moderation_trace("message-1", {"start": 1, "end": 2}, moderation_result=moderation)
    assert result.message_id == log.id
    suggested = task.suggested_question_trace("message-1", {"start": 1, "end": 2}, suggested_question=["q1"])
    assert suggested.message_id == log.id


def test_workflow_trace_reads_real_workflow_log_from_owned_session(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    database: scoped_session[Session],
) -> None:
    app = _app(database)
    log = WorkflowAppLog(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        created_from=WorkflowAppLogCreatedFrom.WEB_APP,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
    )
    database.add(log)
    database.commit()
    repo = MagicMock()
    repo.get_workflow_run_by_id_without_tenant.return_value = _workflow_run()
    monkeypatch.setattr(TraceTask, "_get_workflow_run_repo", classmethod(lambda cls: repo))
    monkeypatch.setattr(TraceTask, "_calculate_workflow_token_split", classmethod(lambda cls, *_a, **_k: (5, 7)))
    result = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE).workflow_trace(
        workflow_run_id="run-1", conversation_id=None, user_id="user-1"
    )
    assert result.workflow_app_log_id == log.id
    assert result.prompt_tokens == 5
    assert result.completion_tokens == 7


def test_tool_trace_reads_real_message_file(monkeypatch: pytest.MonkeyPatch, database: scoped_session[Session]) -> None:
    file = MessageFile(
        message_id="message-1",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        url="tool/file",
    )
    database.add(file)
    database.commit()
    thought = SimpleNamespace(
        tools=["tool-a"],
        created_at=datetime(2025, 2, 20, 12, 1),
        tool_meta={"tool-a": {"tool_config": {}, "time_cost": 5, "error": "", "tool_parameters": {}}},
    )
    monkeypatch.setattr(module, "get_message_data", lambda _message_id: _message_data(agent_thoughts=[thought]))
    result = TraceTask(trace_type=TraceTaskName.TOOL_TRACE).tool_trace(
        "message-1", {"start": 1, "end": 2}, tool_name="tool-a", tool_inputs={}, tool_outputs="result"
    )
    assert result.tool_name == "tool-a"
    assert result.message_file_data.id == file.id


def test_node_execution_trace_resolves_real_message_by_conversation_and_run(
    trace_environment: None, database: scoped_session[Session]
) -> None:
    app = _app(database)
    conversation, message = _conversation_message(database, app)
    result = TraceTask(trace_type=TraceTaskName.NODE_EXECUTION_TRACE).node_execution_trace(
        node_execution_data={
            "tenant_id": app.tenant_id,
            "app_id": app.id,
            "conversation_id": conversation.id,
            "workflow_execution_id": message.workflow_run_id,
            "workflow_id": "workflow-1",
            "node_execution_id": "node-execution-1",
            "node_id": "node-1",
            "node_type": "llm",
            "title": "Node",
            "status": "succeeded",
        }
    )
    assert result.message_id == message.id
    assert result.metadata["conversation_id"] == conversation.id


def test_trace_helpers_and_streaming_metrics(trace_environment: None) -> None:
    assert OpsTraceManager.check_trace_config_is_effective({}, "dummy")
    assert OpsTraceManager.get_trace_config_project_key({}, "dummy") == "fake-key"
    assert OpsTraceManager.get_trace_config_project_url({}, "dummy") == "https://project.fake"
    task = TraceTask(trace_type=TraceTaskName.MESSAGE_TRACE)
    assert task._extract_streaming_metrics(_message_data(message_metadata="invalid")) == {}
    assert task.generate_name_trace("conversation", {"start": 1, "end": 2}, tenant_id=None) == {}


def test_trace_queue_collect_run_and_storage_boundary(monkeypatch: pytest.MonkeyPatch, trace_environment: None) -> None:
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
    manager = TraceQueueManager(app_id="app-id", user_id="user-1")
    task = TraceTask(trace_type=TraceTaskName.CONVERSATION_TRACE, foo="bar")
    manager.add_trace_task(task)
    assert manager.collect_tasks() == [task]

    task.execute = MagicMock(return_value=SimpleNamespace(model_dump=lambda: {"trace": True}))
    save = MagicMock()
    delay = MagicMock()
    monkeypatch.setattr(module.storage, "save", save)
    monkeypatch.setattr(module.process_trace_tasks, "delay", delay)
    manager.send_to_celery([task])
    save.assert_called_once()
    delay.assert_called_once()
