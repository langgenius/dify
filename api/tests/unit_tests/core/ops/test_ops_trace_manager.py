import contextlib
import json
import queue
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.ops.ops_trace_manager import (
    OpsTraceManager,
    TraceQueueManager,
    TraceTask,
    TraceTaskName,
)


class DummyConfig:
    def __init__(self, **kwargs):
        self._data = kwargs

    def model_dump(self):
        return dict(self._data)


class DummyTraceInstance:
    instances: list["DummyTraceInstance"] = []

    def __init__(self, config):
        self.config = config
        DummyTraceInstance.instances.append(self)

    def api_check(self):
        return True

    def get_project_key(self):
        return "fake-key"

    def get_project_url(self):
        return "https://project.fake"


FAKE_PROVIDER_ENTRY = {
    "config_class": DummyConfig,
    "secret_keys": ["secret_value"],
    "other_keys": ["other_value"],
    "trace_instance": DummyTraceInstance,
}


class FakeProviderMap:
    def __init__(self, data):
        self._data = data

    def __getitem__(self, key):
        if key in self._data:
            return self._data[key]
        raise KeyError(f"Unsupported tracing provider: {key}")


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


class FakeMessageFile:
    def __init__(self):
        self.url = "path/to/file"
        self.id = "file-id"
        self.type = "document"
        self.created_by_role = "role"
        self.created_by = "user"


def make_message_data(**overrides):
    created_at = datetime(2025, 2, 20, 12, 0, 0)
    base = {
        "id": "msg-id",
        "app_id": "app-id",
        "conversation_id": "conv-id",
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
        "from_end_user_id": "end-user",
        "from_account_id": "account",
        "agent_based": False,
        "workflow_run_id": "workflow-run",
        "from_source": "source",
        "message_metadata": json.dumps({"usage": {"time_to_first_token": 1, "time_to_generate": 2}}),
        "agent_thoughts": [],
        "query": "sample-query",
        "inputs": "sample-input",
    }
    base.update(overrides)

    class MessageData:
        def __init__(self, data):
            self.__dict__.update(data)

        def to_dict(self):
            return dict(self.__dict__)

    return MessageData(base)


def make_agent_thought(tool_name, created_at):
    return SimpleNamespace(
        tools=[tool_name],
        created_at=created_at,
        tool_meta={
            tool_name: {
                "tool_config": {"foo": "bar"},
                "time_cost": 5,
                "error": "",
                "tool_parameters": {"x": 1},
            }
        },
    )


def make_workflow_run():
    return SimpleNamespace(
        workflow_id="wf-1",
        tenant_id="tenant",
        id="run-id",
        elapsed_time=10,
        status="finished",
        inputs_dict={"sys.file": ["f1"], "query": "search"},
        outputs_dict={"out": "value"},
        version="3",
        error=None,
        total_tokens=12,
        workflow_run_id="run-id",
        created_at=datetime(2025, 2, 20, 10, 0, 0),
        finished_at=datetime(2025, 2, 20, 10, 0, 5),
        triggered_from="user",
        app_id="app-id",
        to_dict=lambda self=None: {"run": "value"},
    )


def configure_db_scalar(session, *, message_file=None, workflow_app_log=None):
    """Configure session.scalar to return appropriate values for MessageFile/WorkflowAppLog lookups."""
    original_scalar = session.scalar

    def _side_effect(stmt):
        stmt_str = str(stmt)
        if "message_file" in stmt_str.lower():
            return message_file
        if "workflow_app_log" in stmt_str.lower():
            return workflow_app_log
        return original_scalar(stmt)

    session.scalar.side_effect = _side_effect


class DummySessionContext:
    scalar_values = []

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


@pytest.fixture(autouse=True)
def patch_provider_map(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.provider_config_map", FakeProviderMap({"dummy": FAKE_PROVIDER_ENTRY})
    )
    OpsTraceManager.ops_trace_instances_cache.clear()
    OpsTraceManager.decrypted_configs_cache.clear()


@pytest.fixture(autouse=True)
def patch_timer_and_current_app(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.ops.ops_trace_manager.threading.Timer", DummyTimer)
    monkeypatch.setattr("core.ops.ops_trace_manager.trace_manager_queue", queue.Queue())
    monkeypatch.setattr("core.ops.ops_trace_manager.trace_manager_timer", None)

    class FakeApp:
        def app_context(self):
            return contextlib.nullcontext()

    fake_current = MagicMock()
    fake_current._get_current_object.return_value = FakeApp()
    monkeypatch.setattr("core.ops.ops_trace_manager.current_app", fake_current)


@pytest.fixture(autouse=True)
def patch_sqlalchemy_session(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.ops.ops_trace_manager.Session", DummySessionContext)


@pytest.fixture
def encryption_mocks(monkeypatch: pytest.MonkeyPatch):
    encrypt_mock = MagicMock(side_effect=lambda tenant, value: f"enc-{value}")
    batch_decrypt_mock = MagicMock(side_effect=lambda tenant, values: [f"dec-{value}" for value in values])
    obfuscate_mock = MagicMock(side_effect=lambda value: f"ob-{value}")
    monkeypatch.setattr("core.ops.ops_trace_manager.encrypt_token", encrypt_mock)
    monkeypatch.setattr("core.ops.ops_trace_manager.batch_decrypt_token", batch_decrypt_mock)
    monkeypatch.setattr("core.ops.ops_trace_manager.obfuscated_token", obfuscate_mock)
    return encrypt_mock, batch_decrypt_mock, obfuscate_mock


@pytest.fixture
def mock_db(monkeypatch: pytest.MonkeyPatch):
    session = MagicMock()
    session.scalars.return_value.all.return_value = ["chat"]
    db_mock = MagicMock()
    db_mock.session = session
    db_mock.engine = MagicMock()
    monkeypatch.setattr("core.ops.ops_trace_manager.db", db_mock)
    return session


@pytest.fixture
def workflow_repo_fixture(monkeypatch: pytest.MonkeyPatch):
    repo = MagicMock()
    repo.get_workflow_run_by_id_without_tenant.return_value = make_workflow_run()
    monkeypatch.setattr(TraceTask, "_get_workflow_run_repo", classmethod(lambda cls: repo))
    return repo


@pytest.fixture
def trace_task_message(monkeypatch, mock_db):
    message_data = make_message_data()
    monkeypatch.setattr("core.ops.ops_trace_manager.get_message_data", lambda msg_id: message_data)
    configure_db_scalar(mock_db, message_file=FakeMessageFile(), workflow_app_log=SimpleNamespace(id="log-id"))
    return message_data


def test_encrypt_tracing_config_handles_star_and_encrypt(encryption_mocks):
    encrypted = OpsTraceManager.encrypt_tracing_config(
        "tenant",
        "dummy",
        {"secret_value": "value", "other_value": "info"},
        current_trace_config={"secret_value": "keep"},
    )
    assert encrypted["secret_value"] == "enc-value"
    assert encrypted["other_value"] == "info"


def test_encrypt_tracing_config_preserves_star(encryption_mocks):
    encrypted = OpsTraceManager.encrypt_tracing_config(
        "tenant",
        "dummy",
        {"secret_value": "*", "other_value": "info"},
        current_trace_config={"secret_value": "keep"},
    )
    assert encrypted["secret_value"] == "keep"


def test_decrypt_tracing_config_caches(encryption_mocks):
    _, decrypt_mock, _ = encryption_mocks
    payload = {"secret_value": "enc", "other_value": "info"}
    first = OpsTraceManager.decrypt_tracing_config("tenant", "dummy", payload)
    second = OpsTraceManager.decrypt_tracing_config("tenant", "dummy", payload)
    assert first == second
    assert decrypt_mock.call_count == 1


def test_obfuscated_decrypt_token(encryption_mocks):
    _, _, obfuscate_mock = encryption_mocks
    result = OpsTraceManager.obfuscated_decrypt_token("dummy", {"secret_value": "value", "other_value": "info"})
    assert "secret_value" in result
    assert result["secret_value"] == "ob-value"
    obfuscate_mock.assert_called_once()


def test_get_decrypted_tracing_config_returns_config(encryption_mocks, mock_db):
    trace_config_data = SimpleNamespace(tracing_config={"secret_value": "enc", "other_value": "info"})
    app = SimpleNamespace(id="app-id", tenant_id="tenant")
    mock_db.scalar.side_effect = [trace_config_data, app]

    decrypted = OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy")
    assert decrypted["other_value"] == "info"


def test_get_decrypted_tracing_config_missing_trace_config(mock_db):
    mock_db.scalar.return_value = None
    assert OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy") is None


def test_get_decrypted_tracing_config_raises_for_missing_app(mock_db):
    trace_config_data = SimpleNamespace(tracing_config={"secret_value": "enc"})
    mock_db.scalar.side_effect = [trace_config_data, None]
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy")


def test_get_decrypted_tracing_config_raises_for_none_config(mock_db):
    trace_config_data = SimpleNamespace(tracing_config=None)
    mock_db.scalar.side_effect = [trace_config_data, SimpleNamespace(tenant_id="tenant")]
    with pytest.raises(ValueError, match="Tracing config cannot be None"):
        OpsTraceManager.get_decrypted_tracing_config("app-id", "dummy")


def test_get_ops_trace_instance_handles_none_app(mock_db):
    mock_db.get.return_value = None
    assert OpsTraceManager.get_ops_trace_instance("app-id") is None


def test_get_ops_trace_instance_returns_none_when_disabled(mock_db, monkeypatch: pytest.MonkeyPatch):
    app = SimpleNamespace(id="app-id", tracing=json.dumps({"enabled": False}))
    mock_db.get.return_value = app
    assert OpsTraceManager.get_ops_trace_instance("app-id") is None


def test_get_ops_trace_instance_invalid_provider(mock_db, monkeypatch: pytest.MonkeyPatch):
    app = SimpleNamespace(id="app-id", tracing=json.dumps({"enabled": True, "tracing_provider": "missing"}))
    mock_db.get.return_value = app
    monkeypatch.setattr("core.ops.ops_trace_manager.provider_config_map", FakeProviderMap({}))
    assert OpsTraceManager.get_ops_trace_instance("app-id") is None


def test_get_ops_trace_instance_success(monkeypatch, mock_db):
    app = SimpleNamespace(id="app-id", tracing=json.dumps({"enabled": True, "tracing_provider": "dummy"}))
    mock_db.get.return_value = app
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.OpsTraceManager.get_decrypted_tracing_config",
        classmethod(lambda cls, aid, provider: {"secret_value": "decrypted", "other_value": "info"}),
    )
    instance = OpsTraceManager.get_ops_trace_instance("app-id")
    assert instance is not None
    cached_instance = OpsTraceManager.get_ops_trace_instance("app-id")
    assert instance is cached_instance


def test_get_app_config_through_message_id_returns_none(mock_db):
    mock_db.scalar.return_value = None
    assert OpsTraceManager.get_app_config_through_message_id("m") is None


def test_get_app_config_through_message_id_prefers_override(mock_db):
    message = SimpleNamespace(conversation_id="conv")
    conversation = SimpleNamespace(app_model_config_id=None, override_model_configs={"foo": "bar"})
    app_config = SimpleNamespace(id="config-id")
    mock_db.scalar.side_effect = [message, conversation]
    result = OpsTraceManager.get_app_config_through_message_id("m")
    assert result == {"foo": "bar"}


def test_get_app_config_through_message_id_app_model_config(mock_db):
    message = SimpleNamespace(conversation_id="conv")
    conversation = SimpleNamespace(app_model_config_id="cfg", override_model_configs=None)
    mock_db.scalar.side_effect = [message, conversation, SimpleNamespace(id="cfg")]
    result = OpsTraceManager.get_app_config_through_message_id("m")
    assert result.id == "cfg"


def test_update_app_tracing_config_invalid_provider(mock_db, monkeypatch: pytest.MonkeyPatch):
    mock_db.get.return_value = None
    with pytest.raises(ValueError, match="Invalid tracing provider"):
        OpsTraceManager.update_app_tracing_config("app", True, "bad")
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.update_app_tracing_config("app", True, None)


def test_update_app_tracing_config_success(mock_db):
    app = SimpleNamespace(id="app-id", tracing="{}")
    mock_db.get.return_value = app
    OpsTraceManager.update_app_tracing_config("app-id", True, "dummy")
    assert app.tracing is not None
    mock_db.commit.assert_called_once()


def test_get_app_tracing_config_errors_when_missing(mock_db):
    mock_db.get.return_value = None
    with pytest.raises(ValueError, match="App not found"):
        OpsTraceManager.get_app_tracing_config("app", mock_db)


def test_get_app_tracing_config_returns_defaults(mock_db):
    mock_db.get.return_value = SimpleNamespace(tracing=None)
    assert OpsTraceManager.get_app_tracing_config("app-id", mock_db) == {"enabled": False, "tracing_provider": None}


def test_get_app_tracing_config_returns_payload(mock_db):
    payload = {"enabled": True, "tracing_provider": "dummy"}
    mock_db.get.return_value = SimpleNamespace(tracing=json.dumps(payload))
    assert OpsTraceManager.get_app_tracing_config("app-id", mock_db) == payload


def test_check_and_project_helpers(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.provider_config_map",
        FakeProviderMap(
            {
                "dummy": {
                    "config_class": DummyConfig,
                    "trace_instance": type(
                        "Trace",
                        (),
                        {
                            "__init__": lambda self, cfg: None,
                            "api_check": lambda self: True,
                            "get_project_key": lambda self: "key",
                            "get_project_url": lambda self: "url",
                        },
                    ),
                    "secret_keys": [],
                    "other_keys": [],
                }
            }
        ),
    )
    assert OpsTraceManager.check_trace_config_is_effective({}, "dummy")
    assert OpsTraceManager.get_trace_config_project_key({}, "dummy") == "key"
    assert OpsTraceManager.get_trace_config_project_url({}, "dummy") == "url"


def test_trace_task_conversation_and_extract(monkeypatch: pytest.MonkeyPatch):
    task = TraceTask(trace_type=TraceTaskName.CONVERSATION_TRACE, message_id="msg")
    assert task.conversation_trace(foo="bar") == {"foo": "bar"}
    assert task._extract_streaming_metrics(make_message_data(message_metadata="not json")) == {}


def test_trace_task_message_trace(trace_task_message, mock_db):
    task = TraceTask(trace_type=TraceTaskName.MESSAGE_TRACE, message_id="msg-id")
    result = task.message_trace("msg-id")
    assert result.message_id == "msg-id"


def test_trace_task_workflow_trace(workflow_repo_fixture, mock_db):
    DummySessionContext.scalar_values = ["wf-app-log", "message-ref"]
    execution = SimpleNamespace(id_="run-id", total_tokens=0)
    task = TraceTask(
        trace_type=TraceTaskName.WORKFLOW_TRACE, workflow_execution=execution, conversation_id="conv", user_id="user"
    )
    result = task.workflow_trace(workflow_run_id="run-id", conversation_id="conv", user_id="user")
    assert result.workflow_run_id == "run-id"
    assert result.workflow_id == "wf-1"


def test_trace_task_moderation_trace(trace_task_message):
    task = TraceTask(trace_type=TraceTaskName.MODERATION_TRACE, message_id="msg-id")
    moderation_result = SimpleNamespace(action="block", preset_response="no", query="q", flagged=True)
    timer = {"start": 1, "end": 2}
    result = task.moderation_trace("msg-id", timer, moderation_result=moderation_result, inputs={"src": "payload"})
    assert result.flagged is True
    assert result.message_id == "log-id"


def test_trace_task_suggested_question_trace(trace_task_message):
    task = TraceTask(trace_type=TraceTaskName.SUGGESTED_QUESTION_TRACE, message_id="msg-id")
    timer = {"start": 1, "end": 2}
    result = task.suggested_question_trace("msg-id", timer, suggested_question=["q1"])
    assert result.message_id == "log-id"
    assert "suggested_question" in result.__dict__


def test_trace_task_dataset_retrieval_trace(trace_task_message):
    task = TraceTask(trace_type=TraceTaskName.DATASET_RETRIEVAL_TRACE, message_id="msg-id")
    timer = {"start": 1, "end": 2}
    mock_doc = SimpleNamespace(model_dump=lambda: {"doc": "value"})
    result = task.dataset_retrieval_trace("msg-id", timer, documents=[mock_doc])
    assert result.documents == [{"doc": "value"}]


def test_trace_task_tool_trace(monkeypatch, mock_db):
    custom_message = make_message_data(agent_thoughts=[make_agent_thought("tool-a", datetime(2025, 2, 20, 12, 1, 0))])
    monkeypatch.setattr("core.ops.ops_trace_manager.get_message_data", lambda _: custom_message)
    configure_db_scalar(mock_db, message_file=FakeMessageFile())
    task = TraceTask(trace_type=TraceTaskName.TOOL_TRACE, message_id="msg-id")
    timer = {"start": 1, "end": 5}
    result = task.tool_trace("msg-id", timer, tool_name="tool-a", tool_inputs={"foo": 1}, tool_outputs="result")
    assert result.tool_name == "tool-a"
    assert result.time_cost == 5


def test_trace_task_generate_name_trace():
    task = TraceTask(trace_type=TraceTaskName.GENERATE_NAME_TRACE, conversation_id="conv-id")
    timer = {"start": 1, "end": 2}
    assert task.generate_name_trace("conv-id", timer, tenant_id=None) == {}
    result = task.generate_name_trace(
        "conv-id", timer, tenant_id="tenant", generate_conversation_name="name", inputs="q"
    )
    assert result.outputs == "name"
    assert result.tenant_id == "tenant"


def test_extract_streaming_metrics_invalid_json():
    task = TraceTask(trace_type=TraceTaskName.MESSAGE_TRACE, message_id="msg-id")
    fake_message = make_message_data(message_metadata="invalid")
    assert task._extract_streaming_metrics(fake_message) == {}


def test_trace_queue_manager_add_and_collect(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", classmethod(lambda cls, aid: True)
    )
    manager = TraceQueueManager(app_id="app-id", user_id="user")
    task = TraceTask(trace_type=TraceTaskName.CONVERSATION_TRACE)
    manager.add_trace_task(task)
    tasks = manager.collect_tasks()
    assert tasks == [task]


def test_trace_queue_manager_run_invokes_send(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", classmethod(lambda cls, aid: True)
    )
    manager = TraceQueueManager(app_id="app-id", user_id="user")
    task = TraceTask(trace_type=TraceTaskName.CONVERSATION_TRACE)
    called = {}

    def fake_collect():
        return [task]

    def fake_send(tasks):
        called["tasks"] = tasks

    monkeypatch.setattr(TraceQueueManager, "collect_tasks", lambda self: fake_collect())
    monkeypatch.setattr(TraceQueueManager, "send_to_celery", lambda self, t: fake_send(t))
    manager.run()
    assert called["tasks"] == [task]


def test_trace_queue_manager_send_to_celery(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", classmethod(lambda cls, aid: True)
    )
    storage_save = MagicMock()
    process_delay = MagicMock()
    monkeypatch.setattr("core.ops.ops_trace_manager.storage.save", storage_save)
    monkeypatch.setattr("core.ops.ops_trace_manager.process_trace_tasks.delay", process_delay)
    monkeypatch.setattr("core.ops.ops_trace_manager.uuid4", MagicMock(return_value=SimpleNamespace(hex="file-123")))

    manager = TraceQueueManager(app_id="app-id", user_id="user")

    class DummyTraceInfo:
        def model_dump(self):
            return {"trace": "info"}

    class DummyTask:
        def __init__(self):
            self.app_id = "app-id"

        def execute(self):
            return DummyTraceInfo()

    task = DummyTask()
    manager.send_to_celery([task])
    storage_save.assert_called_once()
    process_delay.assert_called_once_with({"file_id": "file-123", "app_id": "app-id"})
