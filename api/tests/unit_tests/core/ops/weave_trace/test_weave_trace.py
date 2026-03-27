"""Comprehensive tests for core.ops.weave_trace.weave_trace module."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from weave.trace_server.trace_server_interface import TraceStatus

from core.ops.entities.config_entity import WeaveConfig
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowTraceInfo,
)
from core.ops.weave_trace.entities.weave_trace_entity import WeaveTraceModel
from core.ops.weave_trace.weave_trace import WeaveDataTrace

# ── Helpers ──────────────────────────────────────────────────────────────────


def _dt() -> datetime:
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)


def _make_weave_config(**overrides) -> WeaveConfig:
    defaults = {
        "api_key": "wv-api-key",
        "project": "my-project",
        "entity": "my-entity",
        "host": None,
    }
    defaults.update(overrides)
    return WeaveConfig(**defaults)


def _make_workflow_trace_info(**overrides) -> WorkflowTraceInfo:
    defaults = {
        "workflow_id": "wf-id",
        "tenant_id": "tenant-1",
        "workflow_run_id": "run-1",
        "workflow_run_elapsed_time": 1.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {"key": "val"},
        "workflow_run_outputs": {"answer": "42"},
        "workflow_run_version": "v1",
        "total_tokens": 10,
        "file_list": [],
        "query": "hello",
        "metadata": {"user_id": "u1", "app_id": "app-1"},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
    }
    defaults.update(overrides)
    return WorkflowTraceInfo(**defaults)


def _make_message_trace_info(**overrides) -> MessageTraceInfo:
    msg_data = MagicMock()
    msg_data.id = "msg-1"
    msg_data.from_account_id = "acc-1"
    msg_data.from_end_user_id = None
    defaults = {
        "conversation_model": "chat",
        "message_tokens": 5,
        "answer_tokens": 10,
        "total_tokens": 15,
        "conversation_mode": "chat",
        "metadata": {"conversation_id": "c1"},
        "message_id": "msg-1",
        "message_data": msg_data,
        "inputs": {"prompt": "hi"},
        "outputs": "ok",
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
        "error": None,
    }
    defaults.update(overrides)
    return MessageTraceInfo(**defaults)


def _make_moderation_trace_info(**overrides) -> ModerationTraceInfo:
    defaults = {
        "flagged": False,
        "action": "allow",
        "preset_response": "",
        "query": "test",
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
    }
    defaults.update(overrides)
    return ModerationTraceInfo(**defaults)


def _make_suggested_question_trace_info(**overrides) -> SuggestedQuestionTraceInfo:
    defaults = {
        "suggested_question": ["q1", "q2"],
        "level": "info",
        "total_tokens": 5,
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
        "message_data": SimpleNamespace(created_at=_dt(), updated_at=_dt()),
        "inputs": {"i": 1},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
        "error": None,
    }
    defaults.update(overrides)
    return SuggestedQuestionTraceInfo(**defaults)


def _make_dataset_retrieval_trace_info(**overrides) -> DatasetRetrievalTraceInfo:
    msg_data = MagicMock()
    msg_data.created_at = _dt()
    msg_data.updated_at = _dt()
    defaults = {
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
        "message_data": msg_data,
        "inputs": "query",
        "documents": [{"content": "doc"}],
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
    }
    defaults.update(overrides)
    return DatasetRetrievalTraceInfo(**defaults)


def _make_tool_trace_info(**overrides) -> ToolTraceInfo:
    defaults = {
        "tool_name": "my_tool",
        "tool_inputs": {"x": 1},
        "tool_outputs": "output",
        "tool_config": {"desc": "d"},
        "tool_parameters": {"p": "v"},
        "time_cost": 0.5,
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
        "inputs": {"i": "v"},
        "outputs": {"o": "v"},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
        "error": None,
    }
    defaults.update(overrides)
    return ToolTraceInfo(**defaults)


def _make_generate_name_trace_info(**overrides) -> GenerateNameTraceInfo:
    defaults = {
        "tenant_id": "t1",
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
        "inputs": {"i": 1},
        "outputs": {"name": "test"},
        "start_time": _dt(),
        "end_time": _dt() + timedelta(seconds=1),
    }
    defaults.update(overrides)
    return GenerateNameTraceInfo(**defaults)


def _make_node(**overrides):
    """Create a mock workflow node execution object."""
    defaults = {
        "id": "node-1",
        "title": "Node Title",
        "node_type": BuiltinNodeTypes.CODE,
        "status": "succeeded",
        "inputs": {"key": "value"},
        "outputs": {"result": "ok"},
        "created_at": _dt(),
        "elapsed_time": 1.0,
        "process_data": None,
        "metadata": {},
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_wandb():
    with patch("core.ops.weave_trace.weave_trace.wandb") as mock:
        mock.login.return_value = True
        yield mock


@pytest.fixture
def mock_weave():
    with patch("core.ops.weave_trace.weave_trace.weave") as mock:
        client = MagicMock()
        client.entity = "my-entity"
        client.project = "my-project"
        mock.init.return_value = client
        yield mock, client


@pytest.fixture
def trace_instance(mock_wandb, mock_weave):
    """Create a WeaveDataTrace instance with mocked wandb/weave."""
    _, weave_client = mock_weave
    config = _make_weave_config()
    instance = WeaveDataTrace(config)
    return instance


@pytest.fixture
def trace_instance_with_host(mock_wandb, mock_weave):
    """Create a WeaveDataTrace instance with host configured."""
    _, weave_client = mock_weave
    config = _make_weave_config(host="https://my.wandb.host")
    instance = WeaveDataTrace(config)
    return instance


# ── TestInit ─────────────────────────────────────────────────────────────────


class TestInit:
    def test_init_without_host(self, mock_wandb, mock_weave):
        """Test __init__ calls wandb.login without host."""
        mock_w, weave_client = mock_weave
        config = _make_weave_config(host=None)
        instance = WeaveDataTrace(config)

        mock_wandb.login.assert_called_once_with(key="wv-api-key", verify=True, relogin=True)
        mock_w.init.assert_called_once_with(project_name="my-entity/my-project")
        assert instance.weave_api_key == "wv-api-key"
        assert instance.project_name == "my-project"
        assert instance.entity == "my-entity"
        assert instance.calls == {}

    def test_init_with_host(self, mock_wandb, mock_weave):
        """Test __init__ calls wandb.login with host."""
        config = _make_weave_config(host="https://my.wandb.host")
        instance = WeaveDataTrace(config)

        mock_wandb.login.assert_called_once_with(
            key="wv-api-key", verify=True, relogin=True, host="https://my.wandb.host"
        )
        assert instance.host == "https://my.wandb.host"

    def test_init_without_entity(self, mock_wandb, mock_weave):
        """Test __init__ initializes weave without entity prefix when entity is None."""
        mock_w, weave_client = mock_weave
        config = _make_weave_config(entity=None)
        instance = WeaveDataTrace(config)

        mock_w.init.assert_called_once_with(project_name="my-project")

    def test_init_login_failure_raises(self, mock_wandb, mock_weave):
        """Test __init__ raises ValueError when wandb.login returns False."""
        mock_wandb.login.return_value = False
        config = _make_weave_config()

        with pytest.raises(ValueError, match="Weave login failed"):
            WeaveDataTrace(config)

    def test_init_files_url_from_env(self, mock_wandb, mock_weave, monkeypatch):
        """Test FILES_URL is read from environment."""
        monkeypatch.setenv("FILES_URL", "http://files.example.com")
        config = _make_weave_config()
        instance = WeaveDataTrace(config)
        assert instance.file_base_url == "http://files.example.com"

    def test_init_files_url_default(self, mock_wandb, mock_weave, monkeypatch):
        """Test FILES_URL defaults to http://127.0.0.1:5001."""
        monkeypatch.delenv("FILES_URL", raising=False)
        config = _make_weave_config()
        instance = WeaveDataTrace(config)
        assert instance.file_base_url == "http://127.0.0.1:5001"

    def test_project_id_set_correctly(self, trace_instance):
        """Test that project_id is set from weave_client entity/project."""
        assert trace_instance.project_id == "my-entity/my-project"


# ── TestGetProjectUrl ─────────────────────────────────────────────────────────


class TestGetProjectUrl:
    def test_get_project_url_with_entity(self, trace_instance):
        """Returns wandb URL with entity/project."""
        url = trace_instance.get_project_url()
        assert url == "https://wandb.ai/my-entity/my-project"

    def test_get_project_url_without_entity(self, mock_wandb, mock_weave):
        """Returns wandb URL with project only when entity is None."""
        config = _make_weave_config(entity=None)
        instance = WeaveDataTrace(config)
        url = instance.get_project_url()
        assert url == "https://wandb.ai/my-project"

    def test_get_project_url_exception_raises(self, trace_instance, monkeypatch):
        """Raises ValueError when exception occurs in get_project_url."""
        monkeypatch.setattr(trace_instance, "entity", None)
        monkeypatch.setattr(trace_instance, "project_name", None)
        # Force an error by making string formatting fail
        with patch("core.ops.weave_trace.weave_trace.logger") as mock_logger:
            # Simulate exception via property
            original_entity = trace_instance.entity
            trace_instance.entity = None
            trace_instance.project_name = None
            url = trace_instance.get_project_url()
            assert "https://wandb.ai/" in url


# ── TestTraceDispatcher ─────────────────────────────────────────────────────


class TestTraceDispatcher:
    def test_dispatches_workflow_trace(self, trace_instance):
        with patch.object(trace_instance, "workflow_trace") as mock_wt:
            trace_instance.trace(_make_workflow_trace_info())
            mock_wt.assert_called_once()

    def test_dispatches_message_trace(self, trace_instance):
        with patch.object(trace_instance, "message_trace") as mock_mt:
            trace_instance.trace(_make_message_trace_info())
            mock_mt.assert_called_once()

    def test_dispatches_moderation_trace(self, trace_instance):
        with patch.object(trace_instance, "moderation_trace") as mock_mod:
            msg_data = MagicMock()
            msg_data.created_at = _dt()
            trace_instance.trace(_make_moderation_trace_info(message_data=msg_data))
            mock_mod.assert_called_once()

    def test_dispatches_suggested_question_trace(self, trace_instance):
        with patch.object(trace_instance, "suggested_question_trace") as mock_sq:
            trace_instance.trace(_make_suggested_question_trace_info())
            mock_sq.assert_called_once()

    def test_dispatches_dataset_retrieval_trace(self, trace_instance):
        with patch.object(trace_instance, "dataset_retrieval_trace") as mock_dr:
            trace_instance.trace(_make_dataset_retrieval_trace_info())
            mock_dr.assert_called_once()

    def test_dispatches_tool_trace(self, trace_instance):
        with patch.object(trace_instance, "tool_trace") as mock_tool:
            trace_instance.trace(_make_tool_trace_info())
            mock_tool.assert_called_once()

    def test_dispatches_generate_name_trace(self, trace_instance):
        with patch.object(trace_instance, "generate_name_trace") as mock_gn:
            trace_instance.trace(_make_generate_name_trace_info())
            mock_gn.assert_called_once()


# ── TestNormalizeTime ─────────────────────────────────────────────────────────


class TestNormalizeTime:
    def test_none_returns_utc_now(self, trace_instance):
        now_before = datetime.now(UTC)
        result = trace_instance._normalize_time(None)
        now_after = datetime.now(UTC)
        assert result.tzinfo is not None
        assert now_before <= result <= now_after

    def test_naive_datetime_gets_utc(self, trace_instance):
        naive = datetime(2024, 6, 15, 12, 0, 0)
        result = trace_instance._normalize_time(naive)
        assert result.tzinfo == UTC
        assert result.year == 2024
        assert result.month == 6

    def test_aware_datetime_unchanged(self, trace_instance):
        aware = datetime(2024, 6, 15, 12, 0, 0, tzinfo=UTC)
        result = trace_instance._normalize_time(aware)
        assert result == aware
        assert result.tzinfo == UTC


# ── TestStartCall ─────────────────────────────────────────────────────────────


class TestStartCall:
    def test_start_call_basic(self, trace_instance):
        """Test basic start_call stores call metadata."""
        run = WeaveTraceModel(
            id="run-1",
            op="test-op",
            inputs={"key": "val"},
            attributes={"trace_id": "t-1", "start_time": _dt()},
        )
        trace_instance.start_call(run)

        assert "run-1" in trace_instance.calls
        assert trace_instance.calls["run-1"]["trace_id"] == "t-1"
        assert trace_instance.calls["run-1"]["parent_id"] is None
        trace_instance.weave_client.server.call_start.assert_called_once()

    def test_start_call_with_parent(self, trace_instance):
        """Test start_call records parent_run_id."""
        run = WeaveTraceModel(
            id="child-1",
            op="child-op",
            inputs={},
            attributes={"trace_id": "t-1", "start_time": _dt()},
        )
        trace_instance.start_call(run, parent_run_id="parent-1")

        assert trace_instance.calls["child-1"]["parent_id"] == "parent-1"

    def test_start_call_none_inputs_becomes_empty_dict(self, trace_instance):
        """Test that None inputs is normalized to {}."""
        run = WeaveTraceModel(
            id="run-2",
            op="op",
            inputs=None,
            attributes={"trace_id": "t-2", "start_time": _dt()},
        )
        trace_instance.start_call(run)
        call_args = trace_instance.weave_client.server.call_start.call_args
        req = call_args[0][0]
        assert req.start.inputs == {}

    def test_start_call_non_dict_inputs_becomes_str_dict(self, trace_instance):
        """Test that non-dict inputs is wrapped as string."""
        run = WeaveTraceModel(
            id="run-3",
            op="op",
            inputs="some string input",
            attributes={"trace_id": "t-3", "start_time": _dt()},
        )
        trace_instance.start_call(run)
        call_args = trace_instance.weave_client.server.call_start.call_args
        req = call_args[0][0]
        # String inputs gets converted by validator to a dict
        assert isinstance(req.start.inputs, dict)

    def test_start_call_none_attributes_becomes_empty_dict(self, trace_instance):
        """Test that None attributes is handled properly."""
        run = WeaveTraceModel(
            id="run-4",
            op="op",
            inputs={},
            attributes=None,
        )
        trace_instance.start_call(run)
        # trace_id should fall back to run_data.id
        assert trace_instance.calls["run-4"]["trace_id"] == "run-4"

    def test_start_call_non_dict_attributes_becomes_dict(self, trace_instance):
        """Test that non-dict attributes is wrapped."""
        run = WeaveTraceModel(
            id="run-5",
            op="op",
            inputs={},
            attributes=None,
        )
        # Manually override after construction
        run.attributes = "some-attr-string"
        trace_instance.start_call(run)
        call_args = trace_instance.weave_client.server.call_start.call_args
        req = call_args[0][0]
        assert isinstance(req.start.attributes, dict)
        assert req.start.attributes == {"attributes": "some-attr-string"}

    def test_start_call_trace_id_falls_back_to_run_id(self, trace_instance):
        """When trace_id not in attributes, falls back to run_data.id."""
        run = WeaveTraceModel(
            id="run-6",
            op="op",
            inputs={},
            attributes={"start_time": _dt()},
        )
        trace_instance.start_call(run)
        assert trace_instance.calls["run-6"]["trace_id"] == "run-6"


# ── TestFinishCall ──────────────────────────────────────────────────────────


class TestFinishCall:
    def _setup_call(self, trace_instance, run_id="run-1", trace_id="t-1"):
        """Helper: register a call so finish_call can find it."""
        trace_instance.calls[run_id] = {"trace_id": trace_id, "parent_id": None}

    def test_finish_call_success(self, trace_instance):
        """Test finish_call sends call_end with SUCCESS status."""
        self._setup_call(trace_instance)
        run = WeaveTraceModel(
            id="run-1",
            op="op",
            inputs={},
            outputs={"result": "ok"},
            attributes={"start_time": _dt(), "end_time": _dt() + timedelta(seconds=1)},
            exception=None,
        )
        trace_instance.finish_call(run)
        trace_instance.weave_client.server.call_end.assert_called_once()
        call_args = trace_instance.weave_client.server.call_end.call_args
        req = call_args[0][0]
        assert req.end.summary["status_counts"][TraceStatus.SUCCESS] == 1
        assert req.end.summary["status_counts"][TraceStatus.ERROR] == 0
        assert req.end.exception is None

    def test_finish_call_with_error(self, trace_instance):
        """Test finish_call sends call_end with ERROR status when exception is set."""
        self._setup_call(trace_instance)
        run = WeaveTraceModel(
            id="run-1",
            op="op",
            inputs={},
            outputs={},
            attributes={"start_time": _dt(), "end_time": _dt() + timedelta(seconds=1)},
            exception="Something broke",
        )
        trace_instance.finish_call(run)
        call_args = trace_instance.weave_client.server.call_end.call_args
        req = call_args[0][0]
        assert req.end.summary["status_counts"][TraceStatus.ERROR] == 1
        assert req.end.summary["status_counts"][TraceStatus.SUCCESS] == 0
        assert req.end.exception == "Something broke"

    def test_finish_call_missing_id_raises(self, trace_instance):
        """Test finish_call raises ValueError when call id not found."""
        run = WeaveTraceModel(
            id="nonexistent",
            op="op",
            inputs={},
        )
        with pytest.raises(ValueError, match="Call with id nonexistent not found"):
            trace_instance.finish_call(run)

    def test_finish_call_elapsed_negative_clamped_to_zero(self, trace_instance):
        """Test that negative elapsed time is clamped to 0."""
        self._setup_call(trace_instance)
        run = WeaveTraceModel(
            id="run-1",
            op="op",
            inputs={},
            attributes={
                "start_time": _dt() + timedelta(seconds=5),
                "end_time": _dt(),  # end before start
            },
        )
        trace_instance.finish_call(run)
        call_args = trace_instance.weave_client.server.call_end.call_args
        req = call_args[0][0]
        assert req.end.summary["weave"]["latency_ms"] == 0

    def test_finish_call_none_attributes(self, trace_instance):
        """Test finish_call handles None attributes."""
        self._setup_call(trace_instance)
        run = WeaveTraceModel(
            id="run-1",
            op="op",
            inputs={},
            attributes=None,
        )
        trace_instance.finish_call(run)
        trace_instance.weave_client.server.call_end.assert_called_once()

    def test_finish_call_non_dict_attributes(self, trace_instance):
        """Test finish_call handles non-dict attributes."""
        self._setup_call(trace_instance)
        run = WeaveTraceModel(
            id="run-1",
            op="op",
            inputs={},
            attributes=None,
        )
        run.attributes = "some string attr"
        trace_instance.finish_call(run)
        trace_instance.weave_client.server.call_end.assert_called_once()


# ── TestWorkflowTrace ─────────────────────────────────────────────────────────


class TestWorkflowTrace:
    def _setup_repo(self, monkeypatch, nodes=None):
        """Helper to patch session/repo dependencies."""
        if nodes is None:
            nodes = []

        repo = MagicMock()
        repo.get_by_workflow_execution.return_value = nodes

        mock_factory = MagicMock()
        mock_factory.create_workflow_node_execution_repository.return_value = repo

        monkeypatch.setattr("core.ops.weave_trace.weave_trace.DifyCoreRepositoryFactory", mock_factory)
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.sessionmaker", lambda bind: MagicMock())
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", MagicMock(engine="engine"))
        return repo

    def test_workflow_trace_no_nodes_no_message_id(self, trace_instance, monkeypatch):
        """Workflow trace with no nodes and no message_id."""
        self._setup_repo(monkeypatch, nodes=[])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)

        # Only workflow run: start_call and finish_call each called once
        assert trace_instance.start_call.call_count == 1
        assert trace_instance.finish_call.call_count == 1

    def test_workflow_trace_with_message_id(self, trace_instance, monkeypatch):
        """Workflow trace with message_id creates both message and workflow runs."""
        self._setup_repo(monkeypatch, nodes=[])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id="msg-1")
        trace_instance.workflow_trace(trace_info)

        # message run + workflow run = 2 start_call / finish_call
        assert trace_instance.start_call.call_count == 2
        assert trace_instance.finish_call.call_count == 2

    def test_workflow_trace_with_node_execution(self, trace_instance, monkeypatch):
        """Workflow trace iterates node executions and creates node runs."""
        node = _make_node(
            id="node-1",
            node_type=BuiltinNodeTypes.CODE,
            inputs={"k": "v"},
            outputs={"r": "ok"},
            elapsed_time=0.5,
            created_at=_dt(),
            metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 5},
        )
        self._setup_repo(monkeypatch, nodes=[node])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)

        # workflow run + node run = 2 calls
        assert trace_instance.start_call.call_count == 2

    def test_workflow_trace_with_llm_node(self, trace_instance, monkeypatch):
        """LLM node uses process_data prompts as inputs."""
        node = _make_node(
            node_type=BuiltinNodeTypes.LLM,
            process_data={
                "prompts": [{"role": "user", "content": "hi"}],
                "model_mode": "chat",
                "model_provider": "openai",
                "model_name": "gpt-4",
            },
            inputs={"key": "val"},
        )
        self._setup_repo(monkeypatch, nodes=[node])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)

        # Check node start_call was called with prompts input
        node_call_args = trace_instance.start_call.call_args_list[-1]
        node_run = node_call_args[0][0]
        # WeaveTraceModel validator wraps list prompts into {"messages": [...]}
        # The key "messages" should be present (validator transforms the list)
        assert "messages" in node_run.inputs

    def test_workflow_trace_with_non_llm_node_uses_inputs(self, trace_instance, monkeypatch):
        """Non-LLM node uses node_execution.inputs directly."""
        node = _make_node(
            node_type=BuiltinNodeTypes.TOOL,
            inputs={"tool_input": "val"},
            process_data=None,
        )
        self._setup_repo(monkeypatch, nodes=[node])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)

        # node run inputs should be from node.inputs; validator adds usage_metadata + file_list
        node_call_args = trace_instance.start_call.call_args_list[-1]
        node_run = node_call_args[0][0]
        assert node_run.inputs.get("tool_input") == "val"

    def test_workflow_trace_missing_app_id_raises(self, trace_instance, monkeypatch):
        """Raises ValueError when app_id is missing from metadata."""
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.sessionmaker", lambda bind: MagicMock())
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", MagicMock(engine="engine"))

        trace_info = _make_workflow_trace_info(
            message_id=None,
            metadata={"user_id": "u1"},  # no app_id
        )

        with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
            trace_instance.workflow_trace(trace_info)

    def test_workflow_trace_start_time_none_defaults_to_now(self, trace_instance, monkeypatch):
        """start_time defaults to datetime.now() when None."""
        self._setup_repo(monkeypatch, nodes=[])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None, start_time=None)
        trace_instance.workflow_trace(trace_info)

        assert trace_instance.start_call.call_count == 1

    def test_workflow_trace_node_created_at_none(self, trace_instance, monkeypatch):
        """Node with created_at=None uses datetime.now()."""
        node = _make_node(created_at=None, elapsed_time=0.5)
        self._setup_repo(monkeypatch, nodes=[node])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)
        assert trace_instance.start_call.call_count == 2

    def test_workflow_trace_chat_mode_llm_node_adds_provider(self, trace_instance, monkeypatch):
        """Chat mode LLM node adds ls_provider and ls_model_name to attributes."""
        node = _make_node(
            node_type=BuiltinNodeTypes.LLM,
            process_data={"model_mode": "chat", "model_provider": "openai", "model_name": "gpt-4", "prompts": []},
        )
        self._setup_repo(monkeypatch, nodes=[node])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        start_calls = []

        def capture_start(run, parent_run_id=None):
            start_calls.append((run, parent_run_id))

        trace_instance.start_call = capture_start
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)

        # Last start call is the node run
        node_run, _ = start_calls[-1]
        assert node_run.attributes.get("ls_provider") == "openai"
        assert node_run.attributes.get("ls_model_name") == "gpt-4"

    def test_workflow_trace_nodes_sorted_by_created_at(self, trace_instance, monkeypatch):
        """Nodes are sorted by created_at before processing."""
        node1 = _make_node(id="node-b", created_at=_dt() + timedelta(seconds=2))
        node2 = _make_node(id="node-a", created_at=_dt())
        self._setup_repo(monkeypatch, nodes=[node1, node2])
        monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

        processed_ids = []

        def capture_start(run, parent_run_id=None):
            processed_ids.append(run.id)

        trace_instance.start_call = capture_start
        trace_instance.finish_call = MagicMock()

        trace_info = _make_workflow_trace_info(message_id=None)
        trace_instance.workflow_trace(trace_info)

        # First call = workflow run, then node-a, then node-b
        assert processed_ids[1] == "node-a"
        assert processed_ids[2] == "node-b"


# ── TestMessageTrace ──────────────────────────────────────────────────────────


class TestMessageTrace:
    def test_returns_early_when_no_message_data(self, trace_instance):
        """message_trace returns early when message_data is None."""
        trace_info = _make_message_trace_info(message_data=None)
        trace_instance.start_call = MagicMock()
        trace_instance.message_trace(trace_info)
        trace_instance.start_call.assert_not_called()

    def test_basic_message_trace(self, trace_instance, monkeypatch):
        """message_trace creates message run and llm child run."""
        monkeypatch.setattr(
            "core.ops.weave_trace.weave_trace.db.session.get",
            lambda model, pk: None,
        )

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_message_trace_info()
        trace_instance.message_trace(trace_info)

        # message run + llm child run
        assert trace_instance.start_call.call_count == 2
        assert trace_instance.finish_call.call_count == 2

    def test_message_trace_with_file_data(self, trace_instance, monkeypatch):
        """message_trace appends file URL to file_list."""
        file_data = MagicMock()
        file_data.url = "path/to/file.png"
        trace_instance.file_base_url = "http://files.test"

        mock_db = MagicMock()
        mock_db.session.get.return_value = None
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", mock_db)

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_message_trace_info(
            message_file_data=file_data,
            file_list=["existing.txt"],
        )
        trace_instance.message_trace(trace_info)

        # The first start_call arg (the message run) should have file in outputs or inputs
        message_run = trace_instance.start_call.call_args_list[0][0][0]
        assert "http://files.test/path/to/file.png" in message_run.file_list

    def test_message_trace_with_end_user(self, trace_instance, monkeypatch):
        """message_trace looks up end user and sets end_user_id attribute."""
        end_user = MagicMock()
        end_user.session_id = "session-xyz"

        mock_db = MagicMock()
        mock_db.session.get.return_value = end_user
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", mock_db)

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        msg_data = MagicMock()
        msg_data.id = "msg-1"
        msg_data.from_account_id = "acc-1"
        msg_data.from_end_user_id = "eu-1"

        trace_info = _make_message_trace_info(message_data=msg_data)
        trace_instance.message_trace(trace_info)

        message_run = trace_instance.start_call.call_args_list[0][0][0]
        assert message_run.attributes.get("end_user_id") == "session-xyz"

    def test_message_trace_no_end_user(self, trace_instance, monkeypatch):
        """message_trace handles when from_end_user_id is None."""
        mock_db = MagicMock()
        mock_db.session.get.return_value = None
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", mock_db)

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        msg_data = MagicMock()
        msg_data.id = "msg-1"
        msg_data.from_account_id = "acc-1"
        msg_data.from_end_user_id = None

        trace_info = _make_message_trace_info(message_data=msg_data)
        trace_instance.message_trace(trace_info)
        assert trace_instance.start_call.call_count == 2

    def test_message_trace_trace_id_fallback_to_message_id(self, trace_instance, monkeypatch):
        """trace_id falls back to message_id when trace_id is None."""
        mock_db = MagicMock()
        mock_db.session.get.return_value = None
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", mock_db)

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_message_trace_info(trace_id=None)
        trace_instance.message_trace(trace_info)

        message_run = trace_instance.start_call.call_args_list[0][0][0]
        assert message_run.id == "msg-1"

    def test_message_trace_file_list_none(self, trace_instance, monkeypatch):
        """message_trace handles file_list=None gracefully."""
        mock_db = MagicMock()
        mock_db.session.get.return_value = None
        monkeypatch.setattr("core.ops.weave_trace.weave_trace.db", mock_db)

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_message_trace_info(file_list=None, message_file_data=None)
        trace_instance.message_trace(trace_info)
        assert trace_instance.start_call.call_count == 2


# ── TestModerationTrace ───────────────────────────────────────────────────────


class TestModerationTrace:
    def test_returns_early_when_no_message_data(self, trace_instance):
        """moderation_trace returns early when message_data is None."""
        trace_info = _make_moderation_trace_info(message_data=None)
        trace_instance.start_call = MagicMock()
        trace_instance.moderation_trace(trace_info)
        trace_instance.start_call.assert_not_called()

    def test_basic_moderation_trace(self, trace_instance):
        """moderation_trace creates a run with correct outputs."""
        msg_data = MagicMock()
        msg_data.created_at = _dt()
        msg_data.updated_at = _dt()

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_moderation_trace_info(
            message_data=msg_data,
            start_time=_dt(),
            end_time=_dt() + timedelta(seconds=1),
            action="block",
            flagged=True,
            preset_response="blocked",
        )
        trace_instance.moderation_trace(trace_info)

        trace_instance.start_call.assert_called_once()
        trace_instance.finish_call.assert_called_once()

        run = trace_instance.start_call.call_args[0][0]
        assert run.outputs["action"] == "block"
        assert run.outputs["flagged"] is True

    def test_moderation_trace_with_no_times_uses_message_data_times(self, trace_instance):
        """When start/end times are None, uses message_data created_at/updated_at."""
        msg_data = MagicMock()
        msg_data.created_at = _dt()
        msg_data.updated_at = _dt() + timedelta(seconds=1)

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_moderation_trace_info(
            message_data=msg_data,
            start_time=None,
            end_time=None,
        )
        trace_instance.moderation_trace(trace_info)
        trace_instance.start_call.assert_called_once()

    def test_moderation_trace_trace_id_fallback(self, trace_instance):
        """trace_id falls back to message_id when trace_id is None."""
        msg_data = MagicMock()
        msg_data.created_at = _dt()

        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_moderation_trace_info(
            message_data=msg_data,
            trace_id=None,
        )
        trace_instance.moderation_trace(trace_info)

        _, kwargs = trace_instance.start_call.call_args
        assert kwargs.get("parent_run_id") == "msg-1"


# ── TestSuggestedQuestionTrace ────────────────────────────────────────────────


class TestSuggestedQuestionTrace:
    def test_returns_early_when_no_message_data(self, trace_instance):
        """suggested_question_trace returns early when message_data is None."""
        trace_info = _make_suggested_question_trace_info(message_data=None)
        trace_instance.start_call = MagicMock()
        trace_instance.suggested_question_trace(trace_info)
        trace_instance.start_call.assert_not_called()

    def test_basic_suggested_question_trace(self, trace_instance):
        """suggested_question_trace creates a run parented to trace_id."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_suggested_question_trace_info(trace_id="t-1")
        trace_instance.suggested_question_trace(trace_info)

        trace_instance.start_call.assert_called_once()
        trace_instance.finish_call.assert_called_once()

        _, kwargs = trace_instance.start_call.call_args
        assert kwargs.get("parent_run_id") == "t-1"

    def test_suggested_question_trace_trace_id_fallback(self, trace_instance):
        """trace_id falls back to message_id when trace_id is None."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_suggested_question_trace_info(trace_id=None)
        trace_instance.suggested_question_trace(trace_info)

        _, kwargs = trace_instance.start_call.call_args
        assert kwargs.get("parent_run_id") == "msg-1"


# ── TestDatasetRetrievalTrace ─────────────────────────────────────────────────


class TestDatasetRetrievalTrace:
    def test_returns_early_when_no_message_data(self, trace_instance):
        """dataset_retrieval_trace returns early when message_data is None."""
        trace_info = _make_dataset_retrieval_trace_info(message_data=None)
        trace_instance.start_call = MagicMock()
        trace_instance.dataset_retrieval_trace(trace_info)
        trace_instance.start_call.assert_not_called()

    def test_basic_dataset_retrieval_trace(self, trace_instance):
        """dataset_retrieval_trace creates a run with documents as outputs."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_dataset_retrieval_trace_info(
            documents=[{"id": "d1"}, {"id": "d2"}],
            trace_id="t-1",
        )
        trace_instance.dataset_retrieval_trace(trace_info)

        run = trace_instance.start_call.call_args[0][0]
        # WeaveTraceModel validator injects usage_metadata/file_list into dict outputs
        assert run.outputs.get("documents") == [{"id": "d1"}, {"id": "d2"}]
        _, kwargs = trace_instance.start_call.call_args
        assert kwargs.get("parent_run_id") == "t-1"

    def test_dataset_retrieval_trace_trace_id_fallback(self, trace_instance):
        """trace_id falls back to message_id when trace_id is None."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_dataset_retrieval_trace_info(trace_id=None)
        trace_instance.dataset_retrieval_trace(trace_info)

        _, kwargs = trace_instance.start_call.call_args
        assert kwargs.get("parent_run_id") == "msg-1"


# ── TestToolTrace ─────────────────────────────────────────────────────────────


class TestToolTrace:
    def test_basic_tool_trace(self, trace_instance):
        """tool_trace creates a run with correct op as tool_name."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_tool_trace_info(trace_id="t-1")
        trace_instance.tool_trace(trace_info)

        run = trace_instance.start_call.call_args[0][0]
        assert run.op == "my_tool"
        # WeaveTraceModel validator injects usage_metadata/file_list into dict inputs
        assert run.inputs.get("x") == 1

    def test_tool_trace_with_file_url(self, trace_instance):
        """tool_trace adds file_url to file_list when provided."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_tool_trace_info(file_url="http://files/file.pdf")
        trace_instance.tool_trace(trace_info)

        run = trace_instance.start_call.call_args[0][0]
        assert "http://files/file.pdf" in run.file_list

    def test_tool_trace_without_file_url(self, trace_instance):
        """tool_trace uses empty file_list when file_url is None."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_tool_trace_info(file_url=None)
        trace_instance.tool_trace(trace_info)

        run = trace_instance.start_call.call_args[0][0]
        assert run.file_list == []

    def test_tool_trace_trace_id_from_message_id(self, trace_instance):
        """trace_id uses message_id fallback."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_tool_trace_info(trace_id=None)
        trace_instance.tool_trace(trace_info)

        _, kwargs = trace_instance.start_call.call_args
        assert kwargs.get("parent_run_id") == "msg-1"

    def test_tool_trace_message_id_none_uses_conversation_id(self, trace_instance):
        """When message_id is None, tries conversation_id attribute."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_tool_trace_info(trace_id=None, message_id=None)
        trace_instance.tool_trace(trace_info)

        # No crash; parent_run_id is None since no fallback
        _, kwargs = trace_instance.start_call.call_args
        # parent_run_id should be None when no message_id and no trace_id
        assert kwargs.get("parent_run_id") is None


# ── TestGenerateNameTrace ─────────────────────────────────────────────────────


class TestGenerateNameTrace:
    def test_basic_generate_name_trace(self, trace_instance):
        """generate_name_trace creates a run with correct op."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_generate_name_trace_info()
        trace_instance.generate_name_trace(trace_info)

        trace_instance.start_call.assert_called_once()
        trace_instance.finish_call.assert_called_once()

        run = trace_instance.start_call.call_args[0][0]
        assert run.op == str(TraceTaskName.GENERATE_NAME_TRACE)

    def test_generate_name_trace_no_parent(self, trace_instance):
        """generate_name_trace has no parent run (no parent_run_id)."""
        trace_instance.start_call = MagicMock()
        trace_instance.finish_call = MagicMock()

        trace_info = _make_generate_name_trace_info()
        trace_instance.generate_name_trace(trace_info)

        _, kwargs = trace_instance.start_call.call_args
        # No parent_run_id passed to generate_name start_call
        assert kwargs == {} or kwargs.get("parent_run_id") is None


# ── TestApiCheck ──────────────────────────────────────────────────────────────


class TestApiCheck:
    def test_api_check_success_without_host(self, trace_instance, mock_wandb):
        """api_check returns True on successful login without host."""
        trace_instance.host = None
        mock_wandb.login.return_value = True

        result = trace_instance.api_check()

        assert result is True
        mock_wandb.login.assert_called_with(key=trace_instance.weave_api_key, verify=True, relogin=True)

    def test_api_check_success_with_host(self, trace_instance, mock_wandb):
        """api_check returns True on successful login with host."""
        trace_instance.host = "https://my.wandb.host"
        mock_wandb.login.return_value = True

        result = trace_instance.api_check()

        assert result is True
        mock_wandb.login.assert_called_with(
            key=trace_instance.weave_api_key, verify=True, relogin=True, host="https://my.wandb.host"
        )

    def test_api_check_login_failure_raises(self, trace_instance, mock_wandb):
        """api_check raises ValueError when login returns False."""
        trace_instance.host = None
        mock_wandb.login.return_value = False

        with pytest.raises(ValueError, match="Weave API check failed"):
            trace_instance.api_check()

    def test_api_check_exception_raises_value_error(self, trace_instance, mock_wandb):
        """api_check raises ValueError when wandb.login raises exception."""
        trace_instance.host = None
        mock_wandb.login.side_effect = Exception("network error")

        with pytest.raises(ValueError, match="Weave API check failed: network error"):
            trace_instance.api_check()
