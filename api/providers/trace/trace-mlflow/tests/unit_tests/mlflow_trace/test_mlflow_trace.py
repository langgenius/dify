"""Comprehensive tests for dify_trace_mlflow.mlflow_trace module."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowDataTrace, datetime_to_nanoseconds

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from graphon.enums import BuiltinNodeTypes

# ── Helpers ──────────────────────────────────────────────────────────────────


def _dt() -> datetime:
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)


def _make_workflow_trace_info(**overrides) -> WorkflowTraceInfo:
    defaults = {
        "workflow_id": "wf-id",
        "tenant_id": "tenant",
        "workflow_run_id": "run-1",
        "workflow_run_elapsed_time": 1.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {"key": "val"},
        "workflow_run_outputs": {"answer": "42"},
        "workflow_run_version": "v1",
        "total_tokens": 10,
        "file_list": [],
        "query": "hello",
        "metadata": {"user_id": "u1", "conversation_id": "c1"},
        "start_time": _dt(),
        "end_time": _dt(),
    }
    defaults.update(overrides)
    return WorkflowTraceInfo(**defaults)


def _make_message_trace_info(**overrides) -> MessageTraceInfo:
    defaults = {
        "conversation_model": "chat",
        "message_tokens": 5,
        "answer_tokens": 10,
        "total_tokens": 15,
        "conversation_mode": "chat",
        "metadata": {"conversation_id": "c1", "from_account_id": "a1"},
        "message_id": "msg-1",
        "message_data": SimpleNamespace(
            model_provider="openai",
            model_id="gpt-4",
            total_price=0.01,
            answer="response text",
        ),
        "inputs": {"prompt": "hi"},
        "outputs": "ok",
        "start_time": _dt(),
        "end_time": _dt(),
        "error": None,
    }
    defaults.update(overrides)
    return MessageTraceInfo(**defaults)


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
        "end_time": _dt(),
        "error": None,
    }
    defaults.update(overrides)
    return ToolTraceInfo(**defaults)


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


def _make_dataset_retrieval_trace_info(**overrides) -> DatasetRetrievalTraceInfo:
    defaults = {
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
        "message_data": SimpleNamespace(),
        "inputs": "query",
        "documents": [{"content": "doc"}],
        "start_time": _dt(),
        "end_time": _dt(),
    }
    defaults.update(overrides)
    return DatasetRetrievalTraceInfo(**defaults)


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
        "end_time": _dt(),
        "error": None,
    }
    defaults.update(overrides)
    return SuggestedQuestionTraceInfo(**defaults)


def _make_generate_name_trace_info(**overrides) -> GenerateNameTraceInfo:
    defaults = {
        "tenant_id": "t1",
        "metadata": {"user_id": "u1"},
        "message_id": "msg-1",
        "inputs": {"i": 1},
        "outputs": {"name": "test"},
        "start_time": _dt(),
        "end_time": _dt(),
    }
    defaults.update(overrides)
    return GenerateNameTraceInfo(**defaults)


def _make_node(**overrides):
    """Create a mock workflow node execution row."""
    defaults = {
        "id": "node-1",
        "tenant_id": "t1",
        "app_id": "app-1",
        "title": "Node Title",
        "node_type": BuiltinNodeTypes.CODE,
        "status": "succeeded",
        "inputs": '{"key": "value"}',
        "outputs": '{"result": "ok"}',
        "created_at": _dt(),
        "elapsed_time": 1.0,
        "process_data": None,
        "execution_metadata": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_mlflow():
    with patch("dify_trace_mlflow.mlflow_trace.mlflow") as mock:
        yield mock


@pytest.fixture
def mock_tracing():
    """Patch all MLflow tracing functions used by the module."""
    with (
        patch("dify_trace_mlflow.mlflow_trace.start_span_no_context") as mock_start,
        patch("dify_trace_mlflow.mlflow_trace.update_current_trace") as mock_update,
        patch("dify_trace_mlflow.mlflow_trace.set_span_in_context") as mock_set,
        patch("dify_trace_mlflow.mlflow_trace.detach_span_from_context") as mock_detach,
    ):
        yield {
            "start": mock_start,
            "update": mock_update,
            "set": mock_set,
            "detach": mock_detach,
        }


@pytest.fixture
def mock_db():
    with patch("dify_trace_mlflow.mlflow_trace.db") as mock:
        yield mock


@pytest.fixture
def trace_instance(mock_mlflow):
    """Create an MLflowDataTrace using a basic MLflowConfig (no auth)."""
    config = MLflowConfig(tracking_uri="http://localhost:5000", experiment_id="0")
    return MLflowDataTrace(config)


# ── datetime_to_nanoseconds ─────────────────────────────────────────────────


class TestDatetimeToNanoseconds:
    def test_none_returns_none(self):
        assert datetime_to_nanoseconds(None) is None

    def test_converts_datetime(self):
        dt = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
        expected = int(dt.timestamp() * 1_000_000_000)
        assert datetime_to_nanoseconds(dt) == expected


# ── __init__ / setup ─────────────────────────────────────────────────────────


class TestInit:
    def test_mlflow_config_no_auth(self, mock_mlflow):
        config = MLflowConfig(tracking_uri="http://localhost:5000", experiment_id="0")
        trace = MLflowDataTrace(config)
        mock_mlflow.set_tracking_uri.assert_called_with("http://localhost:5000")
        mock_mlflow.set_experiment.assert_called_with(experiment_id="0")
        assert trace.get_project_url() == "http://localhost:5000/#/experiments/0/traces"
        assert os.environ["MLFLOW_ENABLE_ASYNC_TRACE_LOGGING"] == "true"

    def test_mlflow_config_with_auth(self, mock_mlflow):
        config = MLflowConfig(
            tracking_uri="http://localhost:5000",
            experiment_id="1",
            username="user",
            password="pass",
        )
        MLflowDataTrace(config)
        assert os.environ["MLFLOW_TRACKING_USERNAME"] == "user"
        assert os.environ["MLFLOW_TRACKING_PASSWORD"] == "pass"

    def test_databricks_oauth(self, mock_mlflow):
        config = DatabricksConfig(
            host="https://db.com/",
            experiment_id="42",
            client_id="cid",
            client_secret="csec",
        )
        trace = MLflowDataTrace(config)
        assert os.environ["DATABRICKS_HOST"] == "https://db.com/"
        assert os.environ["DATABRICKS_CLIENT_ID"] == "cid"
        assert os.environ["DATABRICKS_CLIENT_SECRET"] == "csec"
        mock_mlflow.set_tracking_uri.assert_called_with("databricks")
        # Trailing slash stripped
        assert trace.get_project_url() == "https://db.com/ml/experiments/42/traces"

    def test_databricks_pat(self, mock_mlflow):
        config = DatabricksConfig(
            host="https://db.com",
            experiment_id="1",
            personal_access_token="pat",
        )
        trace = MLflowDataTrace(config)
        assert os.environ["DATABRICKS_TOKEN"] == "pat"
        assert "db.com/ml/experiments/1/traces" in trace.get_project_url()

    def test_databricks_no_creds_raises(self, mock_mlflow):
        config = DatabricksConfig(host="https://db.com", experiment_id="1")
        with pytest.raises(ValueError, match="Either Databricks token"):
            MLflowDataTrace(config)


# ── trace dispatcher ────────────────────────────────────────────────────────


class TestTraceDispatcher:
    def test_dispatches_workflow(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "workflow_trace") as mock_wt:
            trace_instance.trace(_make_workflow_trace_info())
            mock_wt.assert_called_once()

    def test_dispatches_message(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "message_trace") as mock_mt:
            trace_instance.trace(_make_message_trace_info())
            mock_mt.assert_called_once()

    def test_dispatches_tool(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "tool_trace") as mock_tt:
            trace_instance.trace(_make_tool_trace_info())
            mock_tt.assert_called_once()

    def test_dispatches_moderation(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "moderation_trace") as mock_mod:
            trace_instance.trace(_make_moderation_trace_info(message_data=SimpleNamespace(created_at=_dt())))
            mock_mod.assert_called_once()

    def test_dispatches_dataset_retrieval(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "dataset_retrieval_trace") as mock_dr:
            trace_instance.trace(_make_dataset_retrieval_trace_info())
            mock_dr.assert_called_once()

    def test_dispatches_suggested_question(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "suggested_question_trace") as mock_sq:
            trace_instance.trace(_make_suggested_question_trace_info())
            mock_sq.assert_called_once()

    def test_dispatches_generate_name(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "generate_name_trace") as mock_gn:
            trace_instance.trace(_make_generate_name_trace_info())
            mock_gn.assert_called_once()

    def test_reraises_exception(self, trace_instance, mock_tracing, mock_db):
        with patch.object(trace_instance, "workflow_trace", side_effect=RuntimeError("boom")):
            with pytest.raises(RuntimeError, match="boom"):
                trace_instance.trace(_make_workflow_trace_info())


# ── workflow_trace ───────────────────────────────────────────────────────────


class TestWorkflowTrace:
    def test_basic_workflow_no_nodes(self, trace_instance, mock_tracing, mock_db):
        mock_db.session.scalars.return_value.all.return_value = []
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_workflow_trace_info(conversation_id="sess-1")
        trace_instance.workflow_trace(trace_info)

        # Workflow span started and ended
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()

    def test_workflow_filters_sys_inputs_and_adds_query(self, trace_instance, mock_tracing, mock_db):
        mock_db.session.scalars.return_value.all.return_value = []
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_workflow_trace_info(
            workflow_run_inputs={"sys.app_id": "x", "user_input": "hi"},
            query="hello",
        )
        trace_instance.workflow_trace(trace_info)

        call_kwargs = mock_tracing["start"].call_args
        inputs = call_kwargs.kwargs["inputs"]
        assert "sys.app_id" not in inputs
        assert inputs["user_input"] == "hi"
        assert inputs["query"] == "hello"

    def test_workflow_with_llm_node(self, trace_instance, mock_tracing, mock_db):
        llm_node = _make_node(
            node_type=BuiltinNodeTypes.LLM,
            process_data=json.dumps(
                {
                    "prompts": [{"role": "user", "text": "hi"}],
                    "model_name": "gpt-4",
                    "model_provider": "openai",
                    "finish_reason": "stop",
                    "usage": {"prompt_tokens": 5, "completion_tokens": 10, "total_tokens": 15},
                }
            ),
            outputs='{"text": "hello world"}',
        )
        mock_db.session.scalars.return_value.all.return_value = [llm_node]

        workflow_span = MagicMock()
        node_span = MagicMock()
        mock_tracing["start"].side_effect = [workflow_span, node_span]
        mock_tracing["set"].return_value = "token"

        trace_instance.workflow_trace(_make_workflow_trace_info())
        assert mock_tracing["start"].call_count == 2
        node_span.end.assert_called_once()
        workflow_span.end.assert_called_once()

    def test_workflow_with_question_classifier_node(self, trace_instance, mock_tracing, mock_db):
        qc_node = _make_node(
            node_type=BuiltinNodeTypes.QUESTION_CLASSIFIER,
            process_data=json.dumps(
                {
                    "prompts": "classify this",
                    "model_name": "gpt-4",
                    "model_provider": "openai",
                }
            ),
        )
        mock_db.session.scalars.return_value.all.return_value = [qc_node]
        workflow_span = MagicMock()
        node_span = MagicMock()
        mock_tracing["start"].side_effect = [workflow_span, node_span]
        mock_tracing["set"].return_value = "token"

        trace_instance.workflow_trace(_make_workflow_trace_info())
        assert mock_tracing["start"].call_count == 2

    def test_workflow_with_http_request_node(self, trace_instance, mock_tracing, mock_db):
        http_node = _make_node(
            node_type=BuiltinNodeTypes.HTTP_REQUEST,
            process_data='{"url": "https://api.com"}',
        )
        mock_db.session.scalars.return_value.all.return_value = [http_node]
        workflow_span = MagicMock()
        node_span = MagicMock()
        mock_tracing["start"].side_effect = [workflow_span, node_span]
        mock_tracing["set"].return_value = "token"

        trace_instance.workflow_trace(_make_workflow_trace_info())
        # HTTP_REQUEST uses process_data as inputs
        node_start_call = mock_tracing["start"].call_args_list[1]
        assert node_start_call.kwargs["inputs"] == '{"url": "https://api.com"}'

    def test_workflow_with_knowledge_retrieval_node(self, trace_instance, mock_tracing, mock_db):
        kr_node = _make_node(
            node_type=BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
            outputs=json.dumps(
                {
                    "result": [
                        {"content": "doc1", "metadata": {"source": "s1"}},
                        {"content": "doc2", "metadata": {}},
                    ]
                }
            ),
        )
        mock_db.session.scalars.return_value.all.return_value = [kr_node]
        workflow_span = MagicMock()
        node_span = MagicMock()
        mock_tracing["start"].side_effect = [workflow_span, node_span]
        mock_tracing["set"].return_value = "token"

        trace_instance.workflow_trace(_make_workflow_trace_info())
        # outputs should be parsed to Document objects
        end_call = node_span.end.call_args
        outputs = end_call.kwargs["outputs"]
        assert len(outputs) == 2

    def test_workflow_with_failed_node(self, trace_instance, mock_tracing, mock_db):
        failed_node = _make_node(status="failed")
        mock_db.session.scalars.return_value.all.return_value = [failed_node]
        workflow_span = MagicMock()
        node_span = MagicMock()
        mock_tracing["start"].side_effect = [workflow_span, node_span]
        mock_tracing["set"].return_value = "token"

        trace_instance.workflow_trace(_make_workflow_trace_info())
        node_span.set_status.assert_called_once()
        node_span.add_event.assert_called_once()

    def test_workflow_with_workflow_error(self, trace_instance, mock_tracing, mock_db):
        mock_db.session.scalars.return_value.all.return_value = []
        workflow_span = MagicMock()
        mock_tracing["start"].return_value = workflow_span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_workflow_trace_info(error="workflow failed")
        trace_instance.workflow_trace(trace_info)
        workflow_span.set_status.assert_called_once()
        workflow_span.add_event.assert_called_once()
        # Still ends the span via finally
        workflow_span.end.assert_called_once()

    def test_workflow_node_no_inputs_no_outputs(self, trace_instance, mock_tracing, mock_db):
        node = _make_node(inputs=None, outputs=None)
        mock_db.session.scalars.return_value.all.return_value = [node]
        workflow_span = MagicMock()
        node_span = MagicMock()
        mock_tracing["start"].side_effect = [workflow_span, node_span]
        mock_tracing["set"].return_value = "token"

        trace_instance.workflow_trace(_make_workflow_trace_info())
        node_call = mock_tracing["start"].call_args_list[1]
        assert node_call.kwargs["inputs"] == {}
        end_call = node_span.end.call_args
        assert end_call.kwargs["outputs"] == {}

    def test_workflow_no_user_id_no_conversation_id(self, trace_instance, mock_tracing, mock_db):
        mock_db.session.scalars.return_value.all.return_value = []
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_workflow_trace_info(
            metadata={},
            conversation_id=None,
        )
        trace_instance.workflow_trace(trace_info)
        # _set_trace_metadata still called with empty metadata
        mock_tracing["update"].assert_called_once()

    def test_workflow_empty_query(self, trace_instance, mock_tracing, mock_db):
        """When query is empty string, it's falsy so no query key added."""
        mock_db.session.scalars.return_value.all.return_value = []
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_workflow_trace_info(query="")
        trace_instance.workflow_trace(trace_info)
        call_kwargs = mock_tracing["start"].call_args
        inputs = call_kwargs.kwargs["inputs"]
        assert "query" not in inputs


# ── _parse_llm_inputs_and_attributes ─────────────────────────────────────────


class TestParseLlmInputsAndAttributes:
    def test_none_process_data(self, trace_instance):
        node = _make_node(process_data=None)
        inputs, attrs = trace_instance._parse_llm_inputs_and_attributes(node)
        assert inputs == {}
        assert attrs == {}

    def test_invalid_json(self, trace_instance):
        node = _make_node(process_data="not json")
        inputs, attrs = trace_instance._parse_llm_inputs_and_attributes(node)
        assert inputs == {}
        assert attrs == {}

    def test_valid_process_data_with_usage(self, trace_instance):
        node = _make_node(
            process_data=json.dumps(
                {
                    "prompts": [{"role": "user", "text": "hi"}],
                    "model_name": "gpt-4",
                    "model_provider": "openai",
                    "finish_reason": "stop",
                    "usage": {"prompt_tokens": 5, "completion_tokens": 10, "total_tokens": 15},
                }
            )
        )
        inputs, attrs = trace_instance._parse_llm_inputs_and_attributes(node)
        assert isinstance(inputs, list)
        assert attrs["model_name"] == "gpt-4"
        assert "usage" in attrs

    def test_valid_process_data_without_usage(self, trace_instance):
        node = _make_node(
            process_data=json.dumps(
                {
                    "prompts": "simple prompt",
                    "model_name": "gpt-3.5",
                }
            )
        )
        inputs, attrs = trace_instance._parse_llm_inputs_and_attributes(node)
        assert inputs == "simple prompt"
        assert attrs["model_name"] == "gpt-3.5"


# ── _parse_knowledge_retrieval_outputs ───────────────────────────────────────


class TestParseKnowledgeRetrievalOutputs:
    def test_with_results(self, trace_instance):
        outputs = {"result": [{"content": "c1", "metadata": {"s": "1"}}]}
        docs = trace_instance._parse_knowledge_retrieval_outputs(outputs)
        assert len(docs) == 1
        assert docs[0].page_content == "c1"

    def test_empty_result(self, trace_instance):
        outputs = {"result": []}
        result = trace_instance._parse_knowledge_retrieval_outputs(outputs)
        assert result == outputs

    def test_no_result_key(self, trace_instance):
        outputs = {"other": "data"}
        result = trace_instance._parse_knowledge_retrieval_outputs(outputs)
        assert result == outputs

    def test_result_not_list(self, trace_instance):
        outputs = {"result": "not a list"}
        result = trace_instance._parse_knowledge_retrieval_outputs(outputs)
        assert result == outputs


# ── message_trace ────────────────────────────────────────────────────────────


class TestMessageTrace:
    def test_returns_early_if_no_message_data(self, trace_instance, mock_tracing, mock_db):
        trace_info = _make_message_trace_info(message_data=None)
        trace_instance.message_trace(trace_info)
        mock_tracing["start"].assert_not_called()

    def test_basic_message_trace(self, trace_instance, mock_tracing, mock_db):
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_instance.message_trace(_make_message_trace_info())
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()

    def test_message_trace_with_error(self, trace_instance, mock_tracing, mock_db):
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_message_trace_info(error="something broke")
        trace_instance.message_trace(trace_info)
        span.set_status.assert_called_once()
        span.add_event.assert_called_once()

    def test_message_trace_with_file_data(self, trace_instance, mock_tracing, mock_db, monkeypatch: pytest.MonkeyPatch):
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"
        monkeypatch.setenv("FILES_URL", "http://files.test")

        file_data = SimpleNamespace(url="path/to/file.png")
        trace_info = _make_message_trace_info(
            message_file_data=file_data,
            file_list=["existing_file.txt"],
        )
        trace_instance.message_trace(trace_info)
        call_kwargs = mock_tracing["start"].call_args
        attrs = call_kwargs.kwargs["attributes"]
        assert "http://files.test/path/to/file.png" in attrs["file_list"]
        assert "existing_file.txt" in attrs["file_list"]

    def test_message_trace_file_list_none(self, trace_instance, mock_tracing, mock_db):
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_message_trace_info(file_list=None, message_file_data=None)
        trace_instance.message_trace(trace_info)
        mock_tracing["start"].assert_called_once()

    def test_message_trace_with_end_user(self, trace_instance, mock_tracing, mock_db):
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        end_user = MagicMock()
        end_user.session_id = "session-xyz"

        trace_info = _make_message_trace_info(
            metadata={"from_end_user_id": "eu-1", "conversation_id": "c1"},
        )
        trace_instance.message_trace(trace_info)
        # update_current_trace called with user id from EndUser
        mock_tracing["update"].assert_called_once()

    def test_message_trace_with_no_conversation_id(self, trace_instance, mock_tracing, mock_db):
        span = MagicMock()
        mock_tracing["start"].return_value = span
        mock_tracing["set"].return_value = "token"

        trace_info = _make_message_trace_info(
            metadata={"from_account_id": "acc-1"},
        )
        trace_instance.message_trace(trace_info)
        mock_tracing["update"].assert_called_once()


# ── _get_message_user_id ─────────────────────────────────────────────────────


class TestGetMessageUserId:
    def test_returns_end_user_session_id(self, trace_instance, mock_db):
        end_user = MagicMock()
        end_user.session_id = "session-1"
        mock_db.session.get.return_value = end_user
        result = trace_instance._get_message_user_id({"from_end_user_id": "eu-1"})
        assert result == "session-1"

    def test_returns_account_id_when_no_end_user(self, trace_instance, mock_db):
        mock_db.session.get.return_value = None
        result = trace_instance._get_message_user_id({"from_end_user_id": "eu-1", "from_account_id": "acc-1"})
        assert result == "acc-1"

    def test_returns_account_id_when_no_end_user_id(self, trace_instance, mock_db):
        result = trace_instance._get_message_user_id({"from_account_id": "acc-1"})
        assert result == "acc-1"

    def test_returns_none_when_nothing(self, trace_instance, mock_db):
        result = trace_instance._get_message_user_id({})
        assert result is None


# ── tool_trace ───────────────────────────────────────────────────────────────


class TestToolTrace:
    def test_basic_tool_trace(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_instance.tool_trace(_make_tool_trace_info())
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()
        span.set_status.assert_not_called()

    def test_tool_trace_with_error(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_instance.tool_trace(_make_tool_trace_info(error="tool failed"))
        span.set_status.assert_called_once()
        span.add_event.assert_called_once()
        span.end.assert_called_once()


# ── moderation_trace ─────────────────────────────────────────────────────────


class TestModerationTrace:
    def test_returns_early_if_no_message_data(self, trace_instance, mock_tracing):
        trace_info = _make_moderation_trace_info(message_data=None)
        trace_instance.moderation_trace(trace_info)
        mock_tracing["start"].assert_not_called()

    def test_basic_moderation_trace(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_info = _make_moderation_trace_info(
            message_data=SimpleNamespace(created_at=_dt()),
            start_time=_dt(),
            end_time=_dt(),
        )
        trace_instance.moderation_trace(trace_info)
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()
        end_kwargs = span.end.call_args.kwargs["outputs"]
        assert end_kwargs["action"] == "allow"
        assert end_kwargs["flagged"] is False

    def test_moderation_uses_message_data_created_at_if_no_start_time(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_info = _make_moderation_trace_info(
            message_data=SimpleNamespace(created_at=_dt()),
            start_time=None,
            end_time=_dt(),
        )
        trace_instance.moderation_trace(trace_info)
        mock_tracing["start"].assert_called_once()


# ── dataset_retrieval_trace ──────────────────────────────────────────────────


class TestDatasetRetrievalTrace:
    def test_returns_early_if_no_message_data(self, trace_instance, mock_tracing):
        trace_info = _make_dataset_retrieval_trace_info(message_data=None)
        trace_instance.dataset_retrieval_trace(trace_info)
        mock_tracing["start"].assert_not_called()

    def test_basic_dataset_retrieval_trace(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_instance.dataset_retrieval_trace(_make_dataset_retrieval_trace_info())
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()


# ── suggested_question_trace ─────────────────────────────────────────────────


class TestSuggestedQuestionTrace:
    def test_returns_early_if_no_message_data(self, trace_instance, mock_tracing):
        trace_info = _make_suggested_question_trace_info(message_data=None)
        trace_instance.suggested_question_trace(trace_info)
        mock_tracing["start"].assert_not_called()

    def test_basic_suggested_question_trace(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_instance.suggested_question_trace(_make_suggested_question_trace_info())
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()

    def test_suggested_question_with_error(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_info = _make_suggested_question_trace_info(error="failed")
        trace_instance.suggested_question_trace(trace_info)
        span.set_status.assert_called_once()
        span.add_event.assert_called_once()

    def test_uses_message_data_times_when_no_start_end(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_info = _make_suggested_question_trace_info(
            start_time=None,
            end_time=None,
        )
        trace_instance.suggested_question_trace(trace_info)
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()


# ── generate_name_trace ──────────────────────────────────────────────────────


class TestGenerateNameTrace:
    def test_basic_generate_name_trace(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["start"].return_value = span

        trace_instance.generate_name_trace(_make_generate_name_trace_info())
        mock_tracing["start"].assert_called_once()
        span.end.assert_called_once()


# ── _get_workflow_nodes ──────────────────────────────────────────────────────


class TestGetWorkflowNodes:
    def test_queries_db(self, trace_instance, mock_db):
        mock_db.session.scalars.return_value.all.return_value = ["n1", "n2"]
        result = trace_instance._get_workflow_nodes("run-1")
        assert result == ["n1", "n2"]


# ── _get_node_span_type ─────────────────────────────────────────────────────


class TestGetNodeSpanType:
    @pytest.mark.parametrize(
        ("node_type", "expected_contains"),
        [
            (BuiltinNodeTypes.LLM, "LLM"),
            (BuiltinNodeTypes.QUESTION_CLASSIFIER, "LLM"),
            (BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "RETRIEVER"),
            (BuiltinNodeTypes.TOOL, "TOOL"),
            (BuiltinNodeTypes.CODE, "TOOL"),
            (BuiltinNodeTypes.HTTP_REQUEST, "TOOL"),
            (BuiltinNodeTypes.AGENT, "AGENT"),
        ],
    )
    def test_mapped_types(self, trace_instance, node_type, expected_contains):
        result = trace_instance._get_node_span_type(node_type)
        assert expected_contains in str(result)

    def test_unknown_type_returns_chain(self, trace_instance):
        result = trace_instance._get_node_span_type("unknown_node")
        assert result == "CHAIN"


# ── _set_trace_metadata ─────────────────────────────────────────────────────


class TestSetTraceMetadata:
    def test_sets_and_detaches(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["set"].return_value = "token"

        trace_instance._set_trace_metadata(span, {"key": "val"})
        mock_tracing["set"].assert_called_once_with(span)
        mock_tracing["update"].assert_called_once_with(metadata={"key": "val"})
        mock_tracing["detach"].assert_called_once_with("token")

    def test_detaches_even_on_error(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["set"].return_value = "token"
        mock_tracing["update"].side_effect = RuntimeError("fail")

        with pytest.raises(RuntimeError):
            trace_instance._set_trace_metadata(span, {})
        mock_tracing["detach"].assert_called_once_with("token")

    def test_no_detach_when_token_is_none(self, trace_instance, mock_tracing):
        span = MagicMock()
        mock_tracing["set"].return_value = None

        trace_instance._set_trace_metadata(span, {})
        mock_tracing["detach"].assert_not_called()


# ── _parse_prompts ───────────────────────────────────────────────────────────


class TestParsePrompts:
    def test_string_input(self, trace_instance):
        assert trace_instance._parse_prompts("hello") == "hello"

    def test_dict_input(self, trace_instance):
        result = trace_instance._parse_prompts({"role": "user", "text": "hi"})
        assert result == {"role": "user", "content": "hi"}

    def test_list_input(self, trace_instance):
        prompts = [
            {"role": "user", "text": "hi"},
            {"role": "assistant", "text": "hello"},
        ]
        result = trace_instance._parse_prompts(prompts)
        assert len(result) == 2
        assert result[0]["role"] == "user"

    def test_none_input(self, trace_instance):
        assert trace_instance._parse_prompts(None) is None

    def test_int_passthrough(self, trace_instance):
        assert trace_instance._parse_prompts(42) == 42


# ── _parse_single_message ───────────────────────────────────────────────────


class TestParseSingleMessage:
    def test_basic_message(self, trace_instance):
        result = trace_instance._parse_single_message({"role": "user", "text": "hello"})
        assert result == {"role": "user", "content": "hello"}

    def test_default_role(self, trace_instance):
        result = trace_instance._parse_single_message({"text": "hello"})
        assert result["role"] == "user"

    def test_with_tool_calls(self, trace_instance):
        item = {
            "role": "assistant",
            "text": "",
            "tool_calls": [{"id": "tc1", "function": {"name": "fn"}}],
        }
        result = trace_instance._parse_single_message(item)
        assert "tool_calls" in result

    def test_tool_role_ignores_tool_calls(self, trace_instance):
        item = {
            "role": "tool",
            "text": "result",
            "tool_calls": [{"id": "tc1"}],
        }
        result = trace_instance._parse_single_message(item)
        assert "tool_calls" not in result

    def test_with_files(self, trace_instance):
        item = {"role": "user", "text": "look", "files": ["f1.png"]}
        result = trace_instance._parse_single_message(item)
        assert result["files"] == ["f1.png"]

    def test_no_files(self, trace_instance):
        result = trace_instance._parse_single_message({"role": "user", "text": "hi"})
        assert "files" not in result


# ── _resolve_tool_call_ids ───────────────────────────────────────────────────


class TestResolveToolCallIds:
    def test_resolves_tool_call_ids(self, trace_instance):
        messages = [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"id": "tc1"}, {"id": "tc2"}],
            },
            {"role": "tool", "content": "result1"},
            {"role": "tool", "content": "result2"},
        ]
        result = trace_instance._resolve_tool_call_ids(messages)
        assert result[1]["tool_call_id"] == "tc1"
        assert result[2]["tool_call_id"] == "tc2"

    def test_no_tool_calls(self, trace_instance):
        messages = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        result = trace_instance._resolve_tool_call_ids(messages)
        assert "tool_call_id" not in result[0]
        assert "tool_call_id" not in result[1]

    def test_tool_message_no_ids_available(self, trace_instance):
        """Tool message with no preceding tool_calls should not crash."""
        messages = [
            {"role": "tool", "content": "result"},
        ]
        result = trace_instance._resolve_tool_call_ids(messages)
        assert "tool_call_id" not in result[0]


# ── api_check ────────────────────────────────────────────────────────────────


class TestApiCheck:
    def test_success(self, trace_instance, mock_mlflow):
        mock_mlflow.search_experiments.return_value = []
        assert trace_instance.api_check() is True

    def test_failure(self, trace_instance, mock_mlflow):
        mock_mlflow.search_experiments.side_effect = ConnectionError("refused")
        with pytest.raises(ValueError, match="MLflow connection failed"):
            trace_instance.api_check()


# ── get_project_url ──────────────────────────────────────────────────────────


class TestGetProjectUrl:
    def test_returns_url(self, trace_instance):
        assert "experiments" in trace_instance.get_project_url()
