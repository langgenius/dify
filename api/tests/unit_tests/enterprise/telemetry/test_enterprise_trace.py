"""Unit tests for EnterpriseOtelTrace."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    DraftNodeExecutionTrace,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    PromptGenerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowNodeTraceInfo,
    WorkflowTraceInfo,
)
from enterprise.telemetry.entities import (
    EnterpriseTelemetryCounter,
    EnterpriseTelemetryEvent,
    EnterpriseTelemetryHistogram,
    EnterpriseTelemetrySpan,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_exporter():
    exporter = MagicMock()
    exporter.include_content = True
    return exporter


@pytest.fixture
def trace_handler(mock_exporter):
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=mock_exporter):
        from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace

        handler = EnterpriseOtelTrace()
    return handler


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

_T0 = datetime(2024, 1, 10, 12, 0, 0, tzinfo=UTC)
_T1 = datetime(2024, 1, 10, 12, 0, 5, tzinfo=UTC)


def make_workflow_info(**overrides) -> WorkflowTraceInfo:
    defaults: dict = {
        "workflow_id": "wf-001",
        "tenant_id": "tenant-abc",
        "workflow_run_id": "run-001",
        "workflow_run_elapsed_time": 5.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {"query": "hello"},
        "workflow_run_outputs": {"answer": "world"},
        "workflow_run_version": "1",
        "total_tokens": 100,
        "prompt_tokens": 60,
        "completion_tokens": 40,
        "file_list": [],
        "query": "hello",
        "start_time": _T0,
        "end_time": _T1,
        "metadata": {
            "app_id": "app-001",
            "tenant_id": "tenant-abc",
            "app_name": "MyApp",
            "workspace_name": "WS",
            "triggered_from": "api",
        },
    }
    defaults.update(overrides)
    return WorkflowTraceInfo(**defaults)


def make_node_info(**overrides) -> WorkflowNodeTraceInfo:
    defaults: dict = {
        "workflow_id": "wf-001",
        "workflow_run_id": "run-001",
        "tenant_id": "tenant-abc",
        "node_execution_id": "ne-001",
        "node_id": "node-001",
        "node_type": "llm",
        "title": "LLM Node",
        "status": "succeeded",
        "elapsed_time": 2.5,
        "index": 1,
        "total_tokens": 80,
        "prompt_tokens": 50,
        "completion_tokens": 30,
        "model_provider": "openai",
        "model_name": "gpt-4",
        "start_time": _T0,
        "end_time": _T1,
        "metadata": {
            "app_id": "app-001",
            "tenant_id": "tenant-abc",
            "app_name": "MyApp",
        },
    }
    defaults.update(overrides)
    return WorkflowNodeTraceInfo(**defaults)


def make_draft_node_info(**overrides) -> DraftNodeExecutionTrace:
    defaults: dict = {
        "workflow_id": "wf-001",
        "workflow_run_id": "run-draft-001",
        "tenant_id": "tenant-abc",
        "node_execution_id": "ne-draft-001",
        "node_id": "node-001",
        "node_type": "llm",
        "title": "Draft LLM",
        "status": "succeeded",
        "elapsed_time": 1.2,
        "index": 0,
        "total_tokens": 50,
        "start_time": _T0,
        "end_time": _T1,
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return DraftNodeExecutionTrace(**defaults)


def make_message_info(**overrides) -> MessageTraceInfo:
    defaults: dict = {
        "message_id": "msg-001",
        "conversation_model": "gpt-4",
        "message_tokens": 40,
        "answer_tokens": 60,
        "total_tokens": 100,
        "conversation_mode": "chat",
        "start_time": _T0,
        "end_time": _T1,
        "inputs": "user input",
        "outputs": "assistant output",
        "metadata": {
            "app_id": "app-001",
            "tenant_id": "tenant-abc",
            "from_source": "api",
            "ls_provider": "openai",
            "ls_model_name": "gpt-4",
            "status": "succeeded",
        },
    }
    defaults.update(overrides)
    return MessageTraceInfo(**defaults)


def make_tool_info(**overrides) -> ToolTraceInfo:
    defaults: dict = {
        "message_id": "msg-001",
        "tool_name": "web_search",
        "tool_inputs": {"query": "test"},
        "tool_outputs": "search results",
        "tool_config": {"max_results": 5},
        "tool_parameters": {"verbose": True},
        "time_cost": 1.5,
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return ToolTraceInfo(**defaults)


def make_moderation_info(**overrides) -> ModerationTraceInfo:
    defaults: dict = {
        "message_id": "msg-001",
        "flagged": False,
        "action": "pass",
        "preset_response": "",
        "query": "is this ok?",
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return ModerationTraceInfo(**defaults)


def make_suggested_question_info(**overrides) -> SuggestedQuestionTraceInfo:
    defaults: dict = {
        "message_id": "msg-001",
        "total_tokens": 30,
        "suggested_question": ["Question A?", "Question B?"],
        "level": "info",
        "status": "succeeded",
        "model_provider": "openai",
        "model_id": "gpt-3.5-turbo",
        "start_time": _T0,
        "end_time": _T1,
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return SuggestedQuestionTraceInfo(**defaults)


def make_dataset_retrieval_info(**overrides) -> DatasetRetrievalTraceInfo:
    defaults: dict = {
        "message_id": "msg-001",
        "documents": [
            {
                "metadata": {
                    "dataset_id": "ds-001",
                    "dataset_name": "MyDataset",
                    "document_id": "doc-001",
                    "segment_id": "seg-001",
                    "score": 0.95,
                }
            }
        ],
        "inputs": "search query",
        "metadata": {
            "app_id": "app-001",
            "tenant_id": "tenant-abc",
            "embedding_models": {
                "ds-001": {
                    "embedding_model_provider": "openai",
                    "embedding_model": "text-embedding-3-small",
                }
            },
        },
    }
    defaults.update(overrides)
    return DatasetRetrievalTraceInfo(**defaults)


def make_generate_name_info(**overrides) -> GenerateNameTraceInfo:
    defaults: dict = {
        "message_id": "msg-001",
        "tenant_id": "tenant-abc",
        "conversation_id": "conv-001",
        "inputs": "some content",
        "outputs": "My Conversation",
        "start_time": _T0,
        "end_time": _T1,
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return GenerateNameTraceInfo(**defaults)


def make_prompt_generation_info(**overrides) -> PromptGenerationTraceInfo:
    defaults: dict = {
        "tenant_id": "tenant-abc",
        "user_id": "user-001",
        "app_id": "app-001",
        "operation_type": "rule_generate",
        "instruction": "Generate a helpful prompt",
        "prompt_tokens": 50,
        "completion_tokens": 100,
        "total_tokens": 150,
        "model_provider": "openai",
        "model_name": "gpt-4",
        "latency": 3.2,
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return PromptGenerationTraceInfo(**defaults)


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


def test_init_raises_when_exporter_is_none():
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=None):
        from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace

        with pytest.raises(RuntimeError, match="exporter is not initialized"):
            EnterpriseOtelTrace()


def test_init_succeeds_with_valid_exporter(mock_exporter):
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=mock_exporter):
        from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace

        handler = EnterpriseOtelTrace()
    assert handler._exporter is mock_exporter


# ---------------------------------------------------------------------------
# Helper methods
# ---------------------------------------------------------------------------


class TestSafePayloadValue:
    def test_string_passthrough(self, trace_handler):
        assert trace_handler._safe_payload_value("hello") == "hello"

    def test_dict_passthrough(self, trace_handler):
        d = {"key": "val"}
        assert trace_handler._safe_payload_value(d) == d

    def test_list_passthrough(self, trace_handler):
        lst = [1, 2, 3]
        assert trace_handler._safe_payload_value(lst) == lst

    def test_none_returns_none(self, trace_handler):
        assert trace_handler._safe_payload_value(None) is None

    def test_int_returns_none(self, trace_handler):
        assert trace_handler._safe_payload_value(42) is None

    def test_bool_returns_none(self, trace_handler):
        assert trace_handler._safe_payload_value(True) is None


class TestMaybeJson:
    def test_none_returns_none(self, trace_handler):
        assert trace_handler._maybe_json(None) is None

    def test_string_passthrough(self, trace_handler):
        assert trace_handler._maybe_json("hello") == "hello"

    def test_dict_serialised(self, trace_handler):
        result = trace_handler._maybe_json({"a": 1})
        assert result == json.dumps({"a": 1})

    def test_list_serialised(self, trace_handler):
        result = trace_handler._maybe_json([1, 2])
        assert result == "[1, 2]"

    def test_non_serialisable_falls_back_to_str(self, trace_handler):
        class Unserializable:
            def __repr__(self):
                return "Unserializable()"

        obj = Unserializable()
        result = trace_handler._maybe_json(obj)
        assert isinstance(result, str)


class TestContentOrRef:
    def test_returns_content_when_include_content_true(self, trace_handler, mock_exporter):
        mock_exporter.include_content = True
        result = trace_handler._content_or_ref("actual content", "ref:x=1")
        assert result == "actual content"

    def test_returns_ref_when_include_content_false(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        result = trace_handler._content_or_ref("actual content", "ref:x=1")
        assert result == "ref:x=1"

    def test_dict_serialised_when_include_content_true(self, trace_handler, mock_exporter):
        mock_exporter.include_content = True
        result = trace_handler._content_or_ref({"key": "val"}, "ref:x=1")
        assert result == json.dumps({"key": "val"})

    def test_none_returns_none_when_include_content_true(self, trace_handler, mock_exporter):
        mock_exporter.include_content = True
        result = trace_handler._content_or_ref(None, "ref:x=1")
        assert result is None


# ---------------------------------------------------------------------------
# trace() dispatcher
# ---------------------------------------------------------------------------


class TestTraceDispatcher:
    def test_dispatches_workflow_trace(self, trace_handler):
        with patch.object(trace_handler, "_workflow_trace") as mock_method:
            info = make_workflow_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_message_trace(self, trace_handler):
        with patch.object(trace_handler, "_message_trace") as mock_method:
            info = make_message_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_tool_trace(self, trace_handler):
        with patch.object(trace_handler, "_tool_trace") as mock_method:
            info = make_tool_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_draft_node_execution_trace(self, trace_handler):
        with patch.object(trace_handler, "_draft_node_execution_trace") as mock_method:
            info = make_draft_node_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_node_execution_trace(self, trace_handler):
        with patch.object(trace_handler, "_node_execution_trace") as mock_method:
            info = make_node_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_moderation_trace(self, trace_handler):
        with patch.object(trace_handler, "_moderation_trace") as mock_method:
            info = make_moderation_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_suggested_question_trace(self, trace_handler):
        with patch.object(trace_handler, "_suggested_question_trace") as mock_method:
            info = make_suggested_question_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_dataset_retrieval_trace(self, trace_handler):
        with patch.object(trace_handler, "_dataset_retrieval_trace") as mock_method:
            info = make_dataset_retrieval_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_generate_name_trace(self, trace_handler):
        with patch.object(trace_handler, "_generate_name_trace") as mock_method:
            info = make_generate_name_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_dispatches_prompt_generation_trace(self, trace_handler):
        with patch.object(trace_handler, "_prompt_generation_trace") as mock_method:
            info = make_prompt_generation_info()
            trace_handler.trace(info)
            mock_method.assert_called_once_with(info)

    def test_draft_node_dispatched_before_node(self, trace_handler):
        """DraftNodeExecutionTrace is a subclass of WorkflowNodeTraceInfo;
        it must be dispatched to _draft_node_execution_trace, not _node_execution_trace."""
        with (
            patch.object(trace_handler, "_draft_node_execution_trace") as mock_draft,
            patch.object(trace_handler, "_node_execution_trace") as mock_node,
        ):
            info = make_draft_node_info()
            trace_handler.trace(info)
            mock_draft.assert_called_once_with(info)
            mock_node.assert_not_called()


# ---------------------------------------------------------------------------
# _workflow_trace
# ---------------------------------------------------------------------------


class TestWorkflowTrace:
    def test_emits_correct_span_attributes(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            info = make_workflow_info()
            trace_handler._workflow_trace(info)

        mock_exporter.export_span.assert_called_once()
        span_call = mock_exporter.export_span.call_args
        assert span_call[0][0] == EnterpriseTelemetrySpan.WORKFLOW_RUN
        attrs = span_call[0][1]
        assert attrs["dify.workflow.run_id"] == "run-001"
        assert attrs["dify.workflow.id"] == "wf-001"
        assert attrs["dify.tenant_id"] == "tenant-abc"
        assert attrs["dify.workflow.status"] == "succeeded"
        assert attrs["gen_ai.usage.total_tokens"] == 100

    def test_span_timing_passed_correctly(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_workflow_info()
            trace_handler._workflow_trace(info)

        span_call = mock_exporter.export_span.call_args
        assert span_call[1]["start_time"] == _T0
        assert span_call[1]["end_time"] == _T1

    def test_emits_companion_log_with_event_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            trace_handler._workflow_trace(make_workflow_info())

        mock_log.assert_called_once()
        assert mock_log.call_args[1]["event_name"] == EnterpriseTelemetryEvent.WORKFLOW_RUN
        assert mock_log.call_args[1]["tenant_id"] == "tenant-abc"

    def test_companion_log_includes_content_when_enabled(self, trace_handler, mock_exporter):
        mock_exporter.include_content = True
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            trace_handler._workflow_trace(make_workflow_info())

        log_attrs = mock_log.call_args[1]["attributes"]
        assert log_attrs["dify.workflow.inputs"] == json.dumps({"query": "hello"})
        assert log_attrs["dify.workflow.outputs"] == json.dumps({"answer": "world"})

    def test_companion_log_uses_ref_when_content_disabled(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            trace_handler._workflow_trace(make_workflow_info())

        log_attrs = mock_log.call_args[1]["attributes"]
        assert log_attrs["dify.workflow.inputs"].startswith("ref:workflow_run_id=")
        assert log_attrs["dify.workflow.outputs"].startswith("ref:workflow_run_id=")

    def test_increments_token_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._workflow_trace(make_workflow_info())

        token_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.TOKENS
        ]
        assert len(token_calls) == 1
        assert token_calls[0][0][1] == 100

    def test_increments_input_and_output_token_counters(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._workflow_trace(make_workflow_info())

        all_calls = mock_exporter.increment_counter.call_args_list
        counter_names = [c[0][0] for c in all_calls]
        assert EnterpriseTelemetryCounter.INPUT_TOKENS in counter_names
        assert EnterpriseTelemetryCounter.OUTPUT_TOKENS in counter_names

    def test_no_input_token_counter_when_prompt_tokens_zero(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_workflow_info(prompt_tokens=0)
            trace_handler._workflow_trace(info)

        all_calls = mock_exporter.increment_counter.call_args_list
        counter_names = [c[0][0] for c in all_calls]
        assert EnterpriseTelemetryCounter.INPUT_TOKENS not in counter_names

    def test_records_workflow_duration_histogram(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._workflow_trace(make_workflow_info())

        mock_exporter.record_histogram.assert_called_once()
        hist_call = mock_exporter.record_histogram.call_args
        assert hist_call[0][0] == EnterpriseTelemetryHistogram.WORKFLOW_DURATION
        assert hist_call[0][1] == pytest.approx(5.0)

    def test_duration_falls_back_to_elapsed_time_when_timestamps_missing(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_workflow_info(start_time=None, end_time=None, workflow_run_elapsed_time=7.3)
            trace_handler._workflow_trace(info)

        hist_call = mock_exporter.record_histogram.call_args
        assert hist_call[0][1] == pytest.approx(7.3)

    def test_duration_defaults_to_zero_when_no_timing(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_workflow_info(start_time=None, end_time=None, workflow_run_elapsed_time=0)
            trace_handler._workflow_trace(info)

        hist_call = mock_exporter.record_histogram.call_args
        assert hist_call[0][1] == pytest.approx(0.0)

    def test_error_path_increments_error_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_workflow_info(error="Something went wrong", workflow_run_status="failed")
            trace_handler._workflow_trace(info)

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 1

    def test_no_error_counter_on_success(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._workflow_trace(make_workflow_info())

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 0

    def test_parent_trace_context_injected_into_span_attrs(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_workflow_info(
                metadata={
                    "app_id": "app-001",
                    "tenant_id": "tenant-abc",
                    "parent_trace_context": {
                        "trace_id": "outer-trace",
                        "parent_node_execution_id": "outer-ne-001",
                        "parent_workflow_run_id": "outer-run-001",
                        "parent_app_id": "outer-app-001",
                    },
                }
            )
            trace_handler._workflow_trace(info)

        attrs = mock_exporter.export_span.call_args[0][1]
        assert attrs["dify.parent.trace_id"] == "outer-trace"
        assert attrs["dify.parent.node.execution_id"] == "outer-ne-001"
        assert attrs["dify.parent.workflow.run_id"] == "outer-run-001"
        assert attrs["dify.parent.app.id"] == "outer-app-001"


# ---------------------------------------------------------------------------
# _node_execution_trace / _emit_node_execution_trace
# ---------------------------------------------------------------------------


class TestNodeExecutionTrace:
    def test_emits_span_with_node_execution_span_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._node_execution_trace(make_node_info())

        span_call = mock_exporter.export_span.call_args
        assert span_call[0][0] == EnterpriseTelemetrySpan.NODE_EXECUTION

    def test_span_contains_core_node_attributes(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._node_execution_trace(make_node_info())

        attrs = mock_exporter.export_span.call_args[0][1]
        assert attrs["dify.node.execution_id"] == "ne-001"
        assert attrs["dify.node.id"] == "node-001"
        assert attrs["dify.node.type"] == "llm"
        assert attrs["dify.node.status"] == "succeeded"
        assert attrs["gen_ai.request.model"] == "gpt-4"
        assert attrs["gen_ai.provider.name"] == "openai"

    def test_increments_token_counters_when_tokens_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._node_execution_trace(make_node_info())

        counter_names = [c[0][0] for c in mock_exporter.increment_counter.call_args_list]
        assert EnterpriseTelemetryCounter.TOKENS in counter_names
        assert EnterpriseTelemetryCounter.INPUT_TOKENS in counter_names
        assert EnterpriseTelemetryCounter.OUTPUT_TOKENS in counter_names

    def test_no_token_counters_when_total_tokens_zero(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._node_execution_trace(make_node_info(total_tokens=0))

        counter_names = [c[0][0] for c in mock_exporter.increment_counter.call_args_list]
        assert EnterpriseTelemetryCounter.TOKENS not in counter_names
        assert EnterpriseTelemetryCounter.INPUT_TOKENS not in counter_names

    def test_records_node_duration_histogram(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._node_execution_trace(make_node_info())

        hist_call = mock_exporter.record_histogram.call_args
        assert hist_call[0][0] == EnterpriseTelemetryHistogram.NODE_DURATION
        assert hist_call[0][1] == pytest.approx(2.5)

    def test_error_path_increments_error_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._node_execution_trace(make_node_info(error="Node failed", status="failed"))

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 1

    def test_emits_companion_log_with_span_name_as_event(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            trace_handler._node_execution_trace(make_node_info())

        mock_log.assert_called_once()
        assert mock_log.call_args[1]["event_name"] == EnterpriseTelemetrySpan.NODE_EXECUTION.value

    def test_plugin_name_added_to_duration_labels_for_tool_node(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_node_info(
                node_type="tool",
                metadata={
                    "app_id": "app-001",
                    "tenant_id": "tenant-abc",
                    "plugin_name": "my-plugin",
                },
            )
            trace_handler._node_execution_trace(info)

        hist_call = mock_exporter.record_histogram.call_args
        duration_labels = hist_call[0][2]
        assert duration_labels.get("plugin_name") == "my-plugin"

    def test_plugin_name_not_added_for_non_tool_node(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_node_info(
                node_type="llm",
                metadata={
                    "app_id": "app-001",
                    "tenant_id": "tenant-abc",
                    "plugin_name": "my-plugin",
                },
            )
            trace_handler._node_execution_trace(info)

        hist_call = mock_exporter.record_histogram.call_args
        duration_labels = hist_call[0][2]
        assert "plugin_name" not in duration_labels

    def test_companion_log_inputs_use_ref_when_content_disabled(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            trace_handler._node_execution_trace(
                make_node_info(node_inputs={"prompt": "hello"}, node_outputs={"text": "world"})
            )

        log_attrs = mock_log.call_args[1]["attributes"]
        assert log_attrs["dify.node.inputs"].startswith("ref:node_execution_id=")
        assert log_attrs["dify.node.outputs"].startswith("ref:node_execution_id=")


# ---------------------------------------------------------------------------
# _draft_node_execution_trace
# ---------------------------------------------------------------------------


class TestDraftNodeExecutionTrace:
    def test_uses_draft_span_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            trace_handler._draft_node_execution_trace(make_draft_node_info())

        span_call = mock_exporter.export_span.call_args
        assert span_call[0][0] == EnterpriseTelemetrySpan.DRAFT_NODE_EXECUTION

    def test_correlation_id_is_node_execution_id(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_draft_node_info()
            trace_handler._draft_node_execution_trace(info)

        span_call = mock_exporter.export_span.call_args
        assert span_call[1]["correlation_id"] == "ne-draft-001"

    def test_trace_correlation_override_is_workflow_run_id(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log"):
            info = make_draft_node_info()
            trace_handler._draft_node_execution_trace(info)

        span_call = mock_exporter.export_span.call_args
        assert span_call[1]["trace_correlation_override"] == "run-draft-001"

    def test_companion_log_uses_draft_span_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_telemetry_log") as mock_log:
            trace_handler._draft_node_execution_trace(make_draft_node_info())

        assert mock_log.call_args[1]["event_name"] == EnterpriseTelemetrySpan.DRAFT_NODE_EXECUTION.value


# ---------------------------------------------------------------------------
# _message_trace
# ---------------------------------------------------------------------------


class TestMessageTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._message_trace(make_message_info())

        mock_emit.assert_called_once()
        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.MESSAGE_RUN

    def test_emits_correct_tenant_and_user(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._message_trace(make_message_info())

        assert mock_emit.call_args[1]["tenant_id"] == "tenant-abc"

    def test_duration_computed_from_timestamps(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._message_trace(make_message_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.message.duration"] == pytest.approx(5.0)

    def test_no_duration_when_timestamps_missing(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._message_trace(make_message_info(start_time=None, end_time=None))

        attrs = mock_emit.call_args[1]["attributes"]
        assert "dify.message.duration" not in attrs

    def test_records_duration_histogram_when_timestamps_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._message_trace(make_message_info())

        hist_calls = [
            c
            for c in mock_exporter.record_histogram.call_args_list
            if c[0][0] == EnterpriseTelemetryHistogram.MESSAGE_DURATION
        ]
        assert len(hist_calls) == 1
        assert hist_calls[0][0][1] == pytest.approx(5.0)

    def test_no_duration_histogram_when_timestamps_missing(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._message_trace(make_message_info(start_time=None, end_time=None))

        hist_names = [c[0][0] for c in mock_exporter.record_histogram.call_args_list]
        assert EnterpriseTelemetryHistogram.MESSAGE_DURATION not in hist_names

    def test_records_ttft_histogram_when_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._message_trace(make_message_info(gen_ai_server_time_to_first_token=0.42))

        ttft_calls = [
            c
            for c in mock_exporter.record_histogram.call_args_list
            if c[0][0] == EnterpriseTelemetryHistogram.MESSAGE_TTFT
        ]
        assert len(ttft_calls) == 1
        assert ttft_calls[0][0][1] == pytest.approx(0.42)

    def test_no_ttft_histogram_when_not_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._message_trace(make_message_info(gen_ai_server_time_to_first_token=None))

        hist_names = [c[0][0] for c in mock_exporter.record_histogram.call_args_list]
        assert EnterpriseTelemetryHistogram.MESSAGE_TTFT not in hist_names

    def test_increments_token_counters(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._message_trace(make_message_info())

        counter_names = [c[0][0] for c in mock_exporter.increment_counter.call_args_list]
        assert EnterpriseTelemetryCounter.TOKENS in counter_names
        assert EnterpriseTelemetryCounter.INPUT_TOKENS in counter_names
        assert EnterpriseTelemetryCounter.OUTPUT_TOKENS in counter_names

    def test_error_path_increments_error_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._message_trace(make_message_info(error="LLM failed"))

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 1

    def test_inputs_and_outputs_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._message_trace(make_message_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.message.inputs"].startswith("ref:message_id=")
        assert attrs["dify.message.outputs"].startswith("ref:message_id=")


# ---------------------------------------------------------------------------
# _tool_trace
# ---------------------------------------------------------------------------


class TestToolTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._tool_trace(make_tool_info())

        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.TOOL_EXECUTION

    def test_status_is_succeeded_on_success(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._tool_trace(make_tool_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.tool.status"] == "succeeded"

    def test_status_is_failed_on_error(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._tool_trace(make_tool_info(error="Tool error"))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.tool.status"] == "failed"

    def test_records_tool_duration_histogram(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._tool_trace(make_tool_info())

        hist_call = mock_exporter.record_histogram.call_args
        assert hist_call[0][0] == EnterpriseTelemetryHistogram.TOOL_DURATION
        assert hist_call[0][1] == pytest.approx(1.5)

    def test_error_increments_error_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._tool_trace(make_tool_info(error="Tool crashed"))

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 1

    def test_inputs_and_outputs_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._tool_trace(make_tool_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.tool.inputs"].startswith("ref:message_id=")
        assert attrs["dify.tool.outputs"].startswith("ref:message_id=")

    def test_inputs_present_when_include_content_true(self, trace_handler, mock_exporter):
        mock_exporter.include_content = True
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._tool_trace(make_tool_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.tool.inputs"] == json.dumps({"query": "test"})
        assert attrs["dify.tool.outputs"] == "search results"

    def test_increments_requests_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._tool_trace(make_tool_info())

        request_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.REQUESTS
        ]
        assert len(request_calls) == 1
        assert request_calls[0][0][2]["type"] == "tool"


# ---------------------------------------------------------------------------
# _moderation_trace
# ---------------------------------------------------------------------------


class TestModerationTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._moderation_trace(make_moderation_info())

        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.MODERATION_CHECK

    def test_flagged_true_sets_attribute(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._moderation_trace(make_moderation_info(flagged=True))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.moderation.flagged"] is True

    def test_flagged_false_sets_attribute(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._moderation_trace(make_moderation_info(flagged=False))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.moderation.flagged"] is False

    def test_query_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._moderation_trace(make_moderation_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.moderation.query"].startswith("ref:message_id=")

    def test_query_present_when_include_content_true(self, trace_handler, mock_exporter):
        mock_exporter.include_content = True
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._moderation_trace(make_moderation_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.moderation.query"] == "is this ok?"

    def test_increments_requests_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._moderation_trace(make_moderation_info())

        request_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.REQUESTS
        ]
        assert len(request_calls) == 1
        assert request_calls[0][0][2]["type"] == "moderation"


# ---------------------------------------------------------------------------
# _suggested_question_trace
# ---------------------------------------------------------------------------


class TestSuggestedQuestionTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info())

        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.SUGGESTED_QUESTION_GENERATION

    def test_duration_computed_from_timestamps(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.suggested_question.duration"] == pytest.approx(5.0)

    def test_duration_is_none_when_timestamps_missing(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info(start_time=None, end_time=None))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.suggested_question.duration"] is None

    def test_status_is_failed_when_error_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info(error="Generation failed"))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.suggested_question.status"] == "failed"

    def test_status_falls_back_to_succeeded_when_no_error(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info(status=None, error=None))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.suggested_question.status"] == "succeeded"

    def test_question_count_attribute(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.suggested_question.count"] == 2

    def test_questions_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._suggested_question_trace(make_suggested_question_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.suggested_question.questions"].startswith("ref:message_id=")

    def test_increments_requests_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._suggested_question_trace(make_suggested_question_info())

        request_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.REQUESTS
        ]
        assert len(request_calls) == 1
        assert request_calls[0][0][2]["type"] == "suggested_question"


# ---------------------------------------------------------------------------
# _dataset_retrieval_trace
# ---------------------------------------------------------------------------


class TestDatasetRetrievalTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.DATASET_RETRIEVAL

    def test_document_count_attribute(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.retrieval.document_count"] == 1

    def test_dataset_ids_extracted(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert "ds-001" in attrs["dify.dataset.id"]

    def test_empty_documents_has_zero_count(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info(documents=[]))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.retrieval.document_count"] == 0

    def test_status_succeeded_when_no_error(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.retrieval.status"] == "succeeded"

    def test_status_failed_when_error_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info(error="DB error"))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.retrieval.status"] == "failed"

    def test_embedding_model_attributes_set_when_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert "dify.dataset.embedding_providers" in attrs
        assert "dify.dataset.embedding_models" in attrs

    def test_no_embedding_model_attributes_when_not_provided(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(
                make_dataset_retrieval_info(metadata={"app_id": "app-001", "tenant_id": "tenant-abc"})
            )

        attrs = mock_emit.call_args[1]["attributes"]
        assert "dify.dataset.embedding_providers" not in attrs
        assert "dify.dataset.embedding_models" not in attrs

    def test_rerank_attributes_set_when_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(
                make_dataset_retrieval_info(
                    metadata={
                        "app_id": "app-001",
                        "tenant_id": "tenant-abc",
                        "rerank_model_provider": "cohere",
                        "rerank_model_name": "rerank-english",
                    }
                )
            )

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.retrieval.rerank_provider"] == "cohere"
        assert attrs["dify.retrieval.rerank_model"] == "rerank-english"

    def test_no_rerank_attributes_when_not_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(
                make_dataset_retrieval_info(metadata={"app_id": "app-001", "tenant_id": "tenant-abc"})
            )

        attrs = mock_emit.call_args[1]["attributes"]
        assert "dify.retrieval.rerank_provider" not in attrs
        assert "dify.retrieval.rerank_model" not in attrs

    def test_dataset_retrieval_counter_incremented_per_dataset(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        ds_calls = [
            c
            for c in mock_exporter.increment_counter.call_args_list
            if c[0][0] == EnterpriseTelemetryCounter.DATASET_RETRIEVALS
        ]
        assert len(ds_calls) == 1
        assert ds_calls[0][0][2]["dataset_id"] == "ds-001"

    def test_no_dataset_retrieval_counter_when_no_documents(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info(documents=[]))

        ds_calls = [
            c
            for c in mock_exporter.increment_counter.call_args_list
            if c[0][0] == EnterpriseTelemetryCounter.DATASET_RETRIEVALS
        ]
        assert len(ds_calls) == 0

    def test_query_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._dataset_retrieval_trace(make_dataset_retrieval_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.retrieval.query"].startswith("ref:message_id=")


# ---------------------------------------------------------------------------
# _generate_name_trace
# ---------------------------------------------------------------------------


class TestGenerateNameTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._generate_name_trace(make_generate_name_info())

        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.GENERATE_NAME_EXECUTION

    def test_duration_computed_from_timestamps(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._generate_name_trace(make_generate_name_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.generate_name.duration"] == pytest.approx(5.0)

    def test_no_duration_when_timestamps_missing(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._generate_name_trace(make_generate_name_info(start_time=None, end_time=None))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.generate_name.duration"] is None

    def test_status_succeeded_on_success(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._generate_name_trace(make_generate_name_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.generate_name.status"] == "succeeded"

    def test_status_failed_when_metadata_has_error(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._generate_name_trace(
                make_generate_name_info(
                    metadata={
                        "app_id": "app-001",
                        "tenant_id": "tenant-abc",
                        "error": "Name generation failed",
                    }
                )
            )

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.generate_name.status"] == "failed"

    def test_inputs_and_outputs_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._generate_name_trace(make_generate_name_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.generate_name.inputs"].startswith("ref:conversation_id=")
        assert attrs["dify.generate_name.outputs"].startswith("ref:conversation_id=")

    def test_increments_requests_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._generate_name_trace(make_generate_name_info())

        request_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.REQUESTS
        ]
        assert len(request_calls) == 1
        assert request_calls[0][0][2]["type"] == "generate_name"


# ---------------------------------------------------------------------------
# _prompt_generation_trace
# ---------------------------------------------------------------------------


class TestPromptGenerationTrace:
    def test_emits_event_with_correct_name(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        assert mock_emit.call_args[1]["event_name"] == EnterpriseTelemetryEvent.PROMPT_GENERATION_EXECUTION

    def test_status_succeeded_on_success(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.prompt_generation.status"] == "succeeded"

    def test_status_failed_when_error_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info(error="Generation error"))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.prompt_generation.status"] == "failed"

    def test_token_counters_incremented(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        counter_names = [c[0][0] for c in mock_exporter.increment_counter.call_args_list]
        assert EnterpriseTelemetryCounter.TOKENS in counter_names
        assert EnterpriseTelemetryCounter.INPUT_TOKENS in counter_names
        assert EnterpriseTelemetryCounter.OUTPUT_TOKENS in counter_names

    def test_records_duration_histogram(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        hist_calls = [
            c
            for c in mock_exporter.record_histogram.call_args_list
            if c[0][0] == EnterpriseTelemetryHistogram.PROMPT_GENERATION_DURATION
        ]
        assert len(hist_calls) == 1
        assert hist_calls[0][0][1] == pytest.approx(3.2)

    def test_total_price_attribute_set_when_present(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info(total_price=0.05, currency="USD"))

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.prompt_generation.total_price"] == pytest.approx(0.05)
        assert attrs["dify.prompt_generation.currency"] == "USD"

    def test_no_total_price_attribute_when_none(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info(total_price=None))

        attrs = mock_emit.call_args[1]["attributes"]
        assert "dify.prompt_generation.total_price" not in attrs

    def test_error_increments_error_counter(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._prompt_generation_trace(make_prompt_generation_info(error="Prompt failed"))

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 1

    def test_no_error_counter_on_success(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        error_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.ERRORS
        ]
        assert len(error_calls) == 0

    def test_instruction_gated_by_include_content(self, trace_handler, mock_exporter):
        mock_exporter.include_content = False
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        attrs = mock_emit.call_args[1]["attributes"]
        assert attrs["dify.prompt_generation.instruction"].startswith("ref:trace_id=")

    def test_operation_type_label_used_in_token_counters(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event"):
            trace_handler._prompt_generation_trace(make_prompt_generation_info(operation_type="code_generate"))

        token_calls = [
            c for c in mock_exporter.increment_counter.call_args_list if c[0][0] == EnterpriseTelemetryCounter.TOKENS
        ]
        assert len(token_calls) == 1
        assert token_calls[0][0][2]["operation_type"] == "code_generate"

    def test_emits_correct_tenant_id(self, trace_handler, mock_exporter):
        with patch("enterprise.telemetry.enterprise_trace.emit_metric_only_event") as mock_emit:
            trace_handler._prompt_generation_trace(make_prompt_generation_info())

        assert mock_emit.call_args[1]["tenant_id"] == "tenant-abc"
