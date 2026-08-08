"""SQLite-backed tests for :mod:`core.ops.ops_trace_manager`."""

from __future__ import annotations

import json
import queue
from collections.abc import Iterator
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.ops.ops_trace_manager as module
from configs import dify_config
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager, TraceTask, TraceTaskName
from core.rag.models.document import Document as RetrievalDocument
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileTransferMethod, FileType
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.model import App, AppMode, AppModelConfig, Conversation, Message, MessageFile, TraceAppConfig
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


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


class DummyUnifiedTraceInstance(DummyTraceInstance):
    pass


class FailingUnifiedTraceInstance(DummyTraceInstance):
    def __init__(self, config):
        raise RuntimeError("unified constructor failed")


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

UNIFIED_PROVIDER_ENTRY = {
    "config_class": DummyConfig,
    "trace_instance": DummyUnifiedTraceInstance,
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


class EncryptTokenRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, tenant_id: str, value: str) -> str:
        self.calls.append((tenant_id, value))
        return f"enc-{value}"


class BatchDecryptTokenRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    def __call__(self, tenant_id: str, values: list[str]) -> list[str]:
        self.calls.append((tenant_id, values))
        return [f"dec-{value}" for value in values]


class ObfuscatedTokenRecorder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, value: str) -> str:
        self.calls.append(value)
        return f"ob-{value}"


class RecordingStorage:
    def __init__(self) -> None:
        self.writes: list[tuple[str, bytes]] = []

    def save(self, path: str, data: bytes) -> None:
        self.writes.append((path, data))


class RecordingDispatcher:
    def __init__(self) -> None:
        self.payloads: list[dict[str, str]] = []
        self.options: list[dict[str, object]] = []

    def apply_async(self, *, args: list[dict[str, str]], **kwargs: object) -> None:
        self.payloads.append(args[0])
        self.options.append(kwargs)


@pytest.fixture
def database(sqlite_engine: Engine, sqlite_session: Session) -> Iterator[Session]:
    with (
        patch.object(module.db, "session", sqlite_session),
        patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=sqlite_engine),
    ):
        yield sqlite_session


@pytest.fixture
def trace_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(module, "provider_config_map", FakeProviderMap({"dummy": PROVIDER_ENTRY}))
    monkeypatch.setattr(module, "unified_provider_config_map", FakeProviderMap({}))
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", False)
    OpsTraceManager.ops_trace_instances_cache.clear()
    OpsTraceManager.decrypted_configs_cache.clear()
    monkeypatch.setattr(module.threading, "Timer", DummyTimer)
    monkeypatch.setattr(module, "trace_manager_queue", queue.Queue())
    monkeypatch.setattr(module, "trace_manager_timer", None)
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)

    app = Flask(__name__)
    with app.app_context():
        yield


@pytest.fixture
def encryption_functions(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[EncryptTokenRecorder, BatchDecryptTokenRecorder, ObfuscatedTokenRecorder]:
    encrypt = EncryptTokenRecorder()
    decrypt = BatchDecryptTokenRecorder()
    obfuscate = ObfuscatedTokenRecorder()
    monkeypatch.setattr(module, "encrypt_token", encrypt)
    monkeypatch.setattr(module, "batch_decrypt_token", decrypt)
    monkeypatch.setattr(module, "obfuscated_token", obfuscate)
    return encrypt, decrypt, obfuscate


def _app(session: Session, *, app_id: str = "app-id", tracing: str | None = None) -> App:
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
    session: Session, app: App, *, config: AppModelConfig | None = None
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


def test_encrypt_decrypt_obfuscate_and_cache(
    trace_environment: None,
    encryption_functions: tuple[EncryptTokenRecorder, BatchDecryptTokenRecorder, ObfuscatedTokenRecorder],
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
    assert len(encryption_functions[1].calls) == 1
    obfuscated = OpsTraceManager.obfuscated_decrypt_token("dummy", first)
    assert obfuscated["secret_value"] == "ob-dec-enc-value"
    assert encryption_functions[2].calls == ["dec-enc-value"]


def test_decrypted_config_reads_real_trace_and_app_rows(
    trace_environment: None,
    encryption_functions,
    database: Session,
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

    null_config_app = _app(database, app_id="app-null-config")
    database.add(TraceAppConfig(app_id=null_config_app.id, tracing_provider="dummy", tracing_config=None))
    database.commit()
    with pytest.raises(ValueError, match="Tracing config cannot be None"):
        OpsTraceManager.get_decrypted_tracing_config(null_config_app.id, "dummy")

    database.delete(app)
    database.commit()
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy")


def test_ops_trace_instance_uses_persisted_enabled_state_and_cache(
    trace_environment: None,
    encryption_functions,
    database: Session,
) -> None:
    app = _app(database, tracing=json.dumps({"enabled": False, "tracing_provider": "dummy"}))
    assert OpsTraceManager.get_ops_trace_instance(app.id) is None
    app.tracing = json.dumps({"enabled": True, "tracing_provider": "dummy"})
    database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={"secret_value": "encrypted"}))
    database.commit()
    instance = OpsTraceManager.get_ops_trace_instance(app.id)
    assert isinstance(instance, DummyTraceInstance)
    assert OpsTraceManager.get_ops_trace_instance(app.id) is instance

    app.tracing = json.dumps({"enabled": True, "tracing_provider": "missing"})
    database.commit()
    assert OpsTraceManager.get_ops_trace_instance(app.id) is None

    assert OpsTraceManager.get_ops_trace_instance(None) is None
    assert OpsTraceManager.get_ops_trace_instance("tenant-storage-id") is None
    assert OpsTraceManager.get_ops_trace_instance("missing") is None


@pytest.mark.parametrize(
    ("enabled", "registered", "expected_type"),
    [
        (False, False, DummyTraceInstance),
        (False, True, DummyTraceInstance),
        (True, False, DummyTraceInstance),
        (True, True, DummyUnifiedTraceInstance),
    ],
)
def test_ops_trace_instance_routes_by_unified_switch(
    enabled: bool,
    registered: bool,
    expected_type: type[DummyTraceInstance],
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    encryption_functions,
    database: Session,
) -> None:
    app = _app(database, tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
    database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={}))
    database.commit()
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", enabled)
    entries = {"dummy": UNIFIED_PROVIDER_ENTRY} if registered else {}
    monkeypatch.setattr(module, "unified_provider_config_map", FakeProviderMap(entries))

    instance = OpsTraceManager.get_ops_trace_instance(app.id)

    assert type(instance) is expected_type


def test_registered_unified_provider_does_not_fallback_when_construction_fails(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    encryption_functions,
    database: Session,
) -> None:
    app = _app(database, tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
    database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={}))
    database.commit()
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", True)
    monkeypatch.setattr(
        module,
        "unified_provider_config_map",
        FakeProviderMap(
            {
                "dummy": {
                    "config_class": DummyConfig,
                    "trace_instance": FailingUnifiedTraceInstance,
                }
            }
        ),
    )

    with pytest.raises(RuntimeError, match="unified constructor failed"):
        OpsTraceManager.get_ops_trace_instance(app.id)


def test_unified_and_legacy_instances_have_separate_cache_entries(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    encryption_functions,
    database: Session,
) -> None:
    app = _app(database, tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
    database.add(TraceAppConfig(app_id=app.id, tracing_provider="dummy", tracing_config={}))
    database.commit()
    monkeypatch.setattr(module, "unified_provider_config_map", FakeProviderMap({"dummy": UNIFIED_PROVIDER_ENTRY}))

    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", False)
    legacy = OpsTraceManager.get_ops_trace_instance(app.id)
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", True)
    unified = OpsTraceManager.get_ops_trace_instance(app.id)

    assert type(legacy) is DummyTraceInstance
    assert type(unified) is DummyUnifiedTraceInstance
    assert legacy is not unified


def test_message_config_lookup_uses_real_conversation_and_model_config(database: Session) -> None:
    app = _app(database)
    config = AppModelConfig(app_id=app.id, model='{"provider":"openai"}')
    database.add(config)
    database.commit()
    conversation, message = _conversation_message(database, app, config=config)
    result = OpsTraceManager.get_app_config_through_message_id(message.id)
    assert result.id == config.id

    conversation.app_model_config_id = None
    conversation.override_model_configs = json.dumps({"provider": "override"})
    database.commit()
    override = OpsTraceManager.get_app_config_through_message_id(message.id)
    assert json.loads(override) == {"provider": "override"}

    assert OpsTraceManager.get_app_config_through_message_id("missing") is None


def test_update_and_get_app_tracing_config_persist_state(trace_environment: None, database: Session) -> None:
    app = _app(database)
    assert OpsTraceManager.get_app_tracing_config(app.id, database) == {
        "enabled": False,
        "tracing_provider": None,
    }
    OpsTraceManager.update_app_tracing_config(app.id, True, "dummy")
    database.expire_all()
    assert OpsTraceManager.get_app_tracing_config(app.id, database) == {
        "enabled": True,
        "tracing_provider": "dummy",
    }
    with pytest.raises(ValueError, match="Invalid tracing provider"):
        OpsTraceManager.update_app_tracing_config(app.id, True, "missing")
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.update_app_tracing_config("missing", False, None)
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.get_app_tracing_config("missing", database)


def test_message_trace_reads_real_conversation_app_and_message_file(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    database: Session,
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
    result = TraceTask(
        trace_type=TraceTaskName.MESSAGE_TRACE,
        message_id=message.id,
    ).preprocess()
    assert result.message_id == message.id
    assert result.conversation_mode == AppMode.CHAT
    assert result.file_list[0].endswith("path/to/file")
    assert result.metadata["tenant_id"] == "tenant-1"


def test_workflow_log_enriches_moderation_and_suggested_question_traces(
    monkeypatch: pytest.MonkeyPatch,
    database: Session,
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
    result = task.moderation_trace(
        "message-1",
        {"start": 1, "end": 2},
        moderation_result=moderation,
        inputs={"source": "payload"},
    )
    assert result.message_id == log.id
    assert result.flagged is True
    assert result.inputs == {"source": "payload"}
    suggested = task.suggested_question_trace("message-1", {"start": 1, "end": 2}, suggested_question=["q1"])
    assert suggested.message_id == log.id
    assert suggested.suggested_question == ["q1"]


def test_dataset_retrieval_trace_serializes_documents(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    database: Session,
) -> None:
    _app(database)
    monkeypatch.setattr(module, "get_message_data", lambda _message_id: _message_data())
    document = RetrievalDocument(page_content="value")

    result = TraceTask(trace_type=TraceTaskName.DATASET_RETRIEVAL_TRACE).dataset_retrieval_trace(
        "message-1",
        {"start": 1, "end": 2},
        documents=[document],
    )

    assert result.documents == [document.model_dump()]
    assert result.documents[0]["page_content"] == "value"
    assert result.metadata["tenant_id"] == "tenant-1"


def test_workflow_trace_reads_real_workflow_log_from_owned_session(
    monkeypatch: pytest.MonkeyPatch,
    trace_environment: None,
    database: Session,
    sqlite_session_factory: sessionmaker[Session],
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
    workflow_run = WorkflowRun(
        id="run-1",
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="3",
        graph="{}",
        inputs=json.dumps({"query": "search"}),
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs=json.dumps({"out": "value"}),
        error=None,
        elapsed_time=10,
        total_tokens=12,
        total_steps=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        created_at=datetime(2025, 2, 20, 10, 0, 0),
        finished_at=datetime(2025, 2, 20, 10, 0, 5),
    )
    database.add_all([log, workflow_run])
    database.commit()
    repo = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    monkeypatch.setattr(TraceTask, "_get_workflow_run_repo", classmethod(lambda cls: repo))
    monkeypatch.setattr(TraceTask, "_calculate_workflow_token_split", classmethod(lambda cls, *_a, **_k: (5, 7)))
    result = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE).workflow_trace(
        workflow_run_id="run-1", conversation_id=None, user_id="user-1"
    )
    assert result.workflow_run_id == "run-1"
    assert result.workflow_id == "workflow-1"
    assert result.workflow_app_log_id == log.id
    assert result.prompt_tokens == 5
    assert result.completion_tokens == 7


def test_tool_trace_reads_real_message_file(monkeypatch: pytest.MonkeyPatch, database: Session) -> None:
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
    assert result.time_cost == 5
    assert result.message_file_data.id == file.id


def test_node_execution_trace_resolves_real_message_by_conversation_and_run(
    trace_environment: None, database: Session
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
    task = TraceTask(trace_type=TraceTaskName.MESSAGE_TRACE, message_id="message-1")
    assert task.conversation_trace(foo="bar") == {"foo": "bar"}
    assert task._extract_streaming_metrics(_message_data(message_metadata="invalid")) == {}
    assert task.generate_name_trace("conversation", {"start": 1, "end": 2}, tenant_id=None) == {}
    generated = task.generate_name_trace(
        "conversation",
        {"start": 1, "end": 2},
        tenant_id="tenant-1",
        generate_conversation_name="name",
        inputs="query",
    )
    assert generated.outputs == "name"
    assert generated.tenant_id == "tenant-1"
    assert generated.message_id == "message-1"


def test_trace_queue_collect_run_and_storage_boundary(monkeypatch: pytest.MonkeyPatch, trace_environment: None) -> None:
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
    manager = TraceQueueManager(app_id="app-id", user_id="user-1")
    task = TraceTask(
        trace_type=TraceTaskName.GENERATE_NAME_TRACE,
        conversation_id="conversation-1",
        timer={"start": 1, "end": 2},
        tenant_id="tenant-1",
        generate_conversation_name="name",
        inputs="query",
    )
    manager.add_trace_task(task)
    assert manager.collect_tasks() == [task]

    recording_storage = RecordingStorage()
    dispatcher = RecordingDispatcher()
    monkeypatch.setattr(module.storage, "save", recording_storage.save)
    monkeypatch.setattr(module.process_trace_tasks, "apply_async", dispatcher.apply_async)
    file_id = UUID("00000000-0000-0000-0000-000000000123")
    monkeypatch.setattr(module, "uuid4", lambda: file_id)
    manager.add_trace_task(task)
    manager.run()

    assert len(recording_storage.writes) == 1
    path, data = recording_storage.writes[0]
    assert path.endswith(f"app-id/{file_id.hex}.json")
    assert json.loads(data)["app_id"] == "app-id"
    assert dispatcher.payloads == [{"file_id": file_id.hex, "app_id": "app-id"}]


def test_trace_queue_persists_with_caller_supplied_file_id(
    monkeypatch: pytest.MonkeyPatch, trace_environment: None
) -> None:
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
    manager = TraceQueueManager(app_id="app-id", user_id="user-1")
    task = TraceTask(
        trace_type=TraceTaskName.GENERATE_NAME_TRACE,
        conversation_id="conversation-1",
        timer={"start": 1, "end": 2},
        tenant_id="tenant-1",
        generate_conversation_name="name",
        inputs="query",
    )
    recording_storage = RecordingStorage()
    monkeypatch.setattr(module.storage, "save", recording_storage.save)

    file_info = manager.persist_trace_task(task, file_id="workflow-final-run-1")

    assert file_info == {"file_id": "workflow-final-run-1", "app_id": "app-id"}
    path, data = recording_storage.writes[0]
    payload = json.loads(data)
    assert path == "ops_trace/app-id/workflow-final-run-1.json"
    assert UUID(payload["trace_info"]["operation_id"])


def test_trace_queue_persistence_error_propagates(monkeypatch: pytest.MonkeyPatch, trace_environment: None) -> None:
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
    manager = TraceQueueManager(app_id="app-id", user_id="user-1")
    task = TraceTask(trace_type=TraceTaskName.GENERATE_NAME_TRACE)

    def fail_save(_path: str, _data: bytes) -> None:
        raise OSError("storage unavailable")

    monkeypatch.setattr(module.storage, "save", fail_save)

    with pytest.raises(OSError, match="storage unavailable"):
        manager.persist_trace_task(task, file_id="workflow-final-run-1")


def test_trace_queue_enqueue_error_propagates(monkeypatch: pytest.MonkeyPatch, trace_environment: None) -> None:
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", classmethod(lambda cls, _app_id: True))
    manager = TraceQueueManager(app_id="app-id", user_id="user-1")

    def fail_enqueue(*_args: object, **_kwargs: object) -> None:
        raise ConnectionError("broker unavailable")

    monkeypatch.setattr(module.process_trace_tasks, "apply_async", fail_enqueue)

    with pytest.raises(ConnectionError, match="broker unavailable"):
        manager.enqueue_persisted_trace({"file_id": "workflow-final-run-1", "app_id": "app-id"})
