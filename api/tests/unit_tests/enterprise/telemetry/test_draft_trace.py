"""Unit tests for enterprise/telemetry/draft_trace.py."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from graphon.enums import WorkflowNodeExecutionMetadataKey

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_execution(**overrides) -> MagicMock:
    """Return a minimal WorkflowNodeExecutionModel mock."""
    execution = MagicMock()
    execution.tenant_id = overrides.get("tenant_id", "tenant-1")
    execution.app_id = overrides.get("app_id", "app-1")
    execution.workflow_id = overrides.get("workflow_id", "wf-1")
    execution.id = overrides.get("id", "exec-1")
    execution.node_id = overrides.get("node_id", "node-1")
    execution.node_type = overrides.get("node_type", "llm")
    execution.title = overrides.get("title", "My LLM Node")
    execution.status = overrides.get("status", "succeeded")
    execution.error = overrides.get("error")
    execution.elapsed_time = overrides.get("elapsed_time", 1.5)
    execution.index = overrides.get("index", 1)
    execution.predecessor_node_id = overrides.get("predecessor_node_id")
    execution.created_at = overrides.get("created_at", datetime(2024, 1, 1, tzinfo=UTC))
    execution.finished_at = overrides.get("finished_at", datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC))
    execution.workflow_run_id = overrides.get("workflow_run_id", "run-1")
    execution.inputs_dict = overrides.get("inputs_dict", {"prompt": "hello"})
    execution.outputs_dict = overrides.get("outputs_dict", {"answer": "world"})
    execution.process_data_dict = overrides.get("process_data_dict", {})
    execution.execution_metadata_dict = overrides.get("execution_metadata_dict", {})
    return execution


# ---------------------------------------------------------------------------
# _build_node_execution_data
# ---------------------------------------------------------------------------


class TestBuildNodeExecutionData:
    def test_basic_fields_populated(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution()
        result = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id="run-override",
        )

        assert result["workflow_id"] == "wf-1"
        assert result["tenant_id"] == "tenant-1"
        assert result["app_id"] == "app-1"
        assert result["node_execution_id"] == "exec-1"
        assert result["node_id"] == "node-1"
        assert result["node_type"] == "llm"
        assert result["title"] == "My LLM Node"
        assert result["status"] == "succeeded"
        assert result["error"] is None
        assert result["elapsed_time"] == 1.5
        assert result["index"] == 1

    def test_workflow_execution_id_prefers_parameter(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(workflow_run_id="run-from-model")
        result = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id="explicit-run",
        )
        assert result["workflow_execution_id"] == "explicit-run"

    def test_workflow_execution_id_falls_back_to_run_id(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(workflow_run_id="run-from-model")
        result = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id=None,
        )
        assert result["workflow_execution_id"] == "run-from-model"

    def test_workflow_execution_id_falls_back_to_execution_id(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(workflow_run_id=None, id="exec-fallback")
        result = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id=None,
        )
        assert result["workflow_execution_id"] == "exec-fallback"

    def test_outputs_param_overrides_execution_outputs(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(outputs_dict={"from_model": True})
        result = _build_node_execution_data(
            execution=execution,
            outputs={"from_param": True},
            workflow_execution_id=None,
        )
        assert result["node_outputs"] == {"from_param": True}

    def test_outputs_none_uses_execution_outputs_dict(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(outputs_dict={"from_model": True})
        result = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id=None,
        )
        assert result["node_outputs"] == {"from_model": True}

    def test_metadata_token_fields_default_to_zero(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(execution_metadata_dict={})
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["total_tokens"] == 0
        assert result["total_price"] == 0.0
        assert result["currency"] is None

    def test_metadata_token_fields_populated_from_metadata(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        metadata = {
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 200,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.05,
            WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
        }
        execution = _make_execution(execution_metadata_dict=metadata)
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["total_tokens"] == 200
        assert result["total_price"] == 0.05
        assert result["currency"] == "USD"

    def test_tool_name_extracted_from_tool_info_dict(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        metadata = {
            WorkflowNodeExecutionMetadataKey.TOOL_INFO: {"tool_name": "web_search"},
        }
        execution = _make_execution(execution_metadata_dict=metadata)
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["tool_name"] == "web_search"

    def test_tool_name_is_none_when_tool_info_not_dict(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        metadata = {WorkflowNodeExecutionMetadataKey.TOOL_INFO: "not-a-dict"}
        execution = _make_execution(execution_metadata_dict=metadata)
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["tool_name"] is None

    def test_tool_name_is_none_when_tool_info_absent(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(execution_metadata_dict={})
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["tool_name"] is None

    def test_iteration_and_loop_fields(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        metadata = {
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: "iter-1",
            WorkflowNodeExecutionMetadataKey.ITERATION_INDEX: 3,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: "loop-1",
            WorkflowNodeExecutionMetadataKey.LOOP_INDEX: 2,
            WorkflowNodeExecutionMetadataKey.PARALLEL_ID: "par-1",
        }
        execution = _make_execution(execution_metadata_dict=metadata)
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["iteration_id"] == "iter-1"
        assert result["iteration_index"] == 3
        assert result["loop_id"] == "loop-1"
        assert result["loop_index"] == 2
        assert result["parallel_id"] == "par-1"

    def test_node_inputs_and_process_data_included(self) -> None:
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(
            inputs_dict={"q": "test"},
            process_data_dict={"step": 1},
        )
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["node_inputs"] == {"q": "test"}
        assert result["process_data"] == {"step": 1}


# ---------------------------------------------------------------------------
# enqueue_draft_node_execution_trace
# ---------------------------------------------------------------------------


class TestEnqueueDraftNodeExecutionTrace:
    @patch("enterprise.telemetry.draft_trace.telemetry_emit")
    def test_emits_telemetry_event(self, mock_emit: MagicMock) -> None:
        from core.telemetry import TelemetryEvent, TraceTaskName
        from enterprise.telemetry.draft_trace import enqueue_draft_node_execution_trace

        execution = _make_execution()
        enqueue_draft_node_execution_trace(
            execution=execution,
            outputs={"result": "ok"},
            workflow_execution_id="run-x",
            user_id="user-1",
        )

        mock_emit.assert_called_once()
        event: TelemetryEvent = mock_emit.call_args[0][0]
        assert event.name == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE
        assert event.context.tenant_id == "tenant-1"
        assert event.context.user_id == "user-1"
        assert event.context.app_id == "app-1"

    @patch("enterprise.telemetry.draft_trace.telemetry_emit")
    def test_payload_contains_node_execution_data(self, mock_emit: MagicMock) -> None:
        from core.telemetry import TelemetryEvent
        from enterprise.telemetry.draft_trace import enqueue_draft_node_execution_trace

        execution = _make_execution()
        enqueue_draft_node_execution_trace(
            execution=execution,
            outputs=None,
            workflow_execution_id=None,
            user_id="user-2",
        )

        event: TelemetryEvent = mock_emit.call_args[0][0]
        node_data = event.payload["node_execution_data"]
        assert node_data["workflow_id"] == "wf-1"
        assert node_data["node_type"] == "llm"
        assert node_data["status"] == "succeeded"

    @patch("enterprise.telemetry.draft_trace.telemetry_emit")
    def test_outputs_forwarded_to_build(self, mock_emit: MagicMock) -> None:
        from core.telemetry import TelemetryEvent
        from enterprise.telemetry.draft_trace import enqueue_draft_node_execution_trace

        execution = _make_execution(outputs_dict={"default": True})
        enqueue_draft_node_execution_trace(
            execution=execution,
            outputs={"explicit": True},
            workflow_execution_id=None,
            user_id="user-3",
        )

        event: TelemetryEvent = mock_emit.call_args[0][0]
        assert event.payload["node_execution_data"]["node_outputs"] == {"explicit": True}

    @patch("enterprise.telemetry.draft_trace.telemetry_emit")
    def test_none_outputs_uses_execution_outputs(self, mock_emit: MagicMock) -> None:
        from core.telemetry import TelemetryEvent
        from enterprise.telemetry.draft_trace import enqueue_draft_node_execution_trace

        execution = _make_execution(outputs_dict={"from_model": "yes"})
        enqueue_draft_node_execution_trace(
            execution=execution,
            outputs=None,
            workflow_execution_id=None,
            user_id="user-4",
        )

        event: TelemetryEvent = mock_emit.call_args[0][0]
        assert event.payload["node_execution_data"]["node_outputs"] == {"from_model": "yes"}
