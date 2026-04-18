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


# ---------------------------------------------------------------------------
# End-to-end token/model data flow: _build_node_execution_data →
# ops_trace_manager.draft_node_execution_trace → DraftNodeExecutionTrace
# ---------------------------------------------------------------------------


def _make_llm_execution() -> MagicMock:
    """Return a WorkflowNodeExecutionModel mock that mimics a real LLM node.

    The field values match what graphon/nodes/llm/node.py produces:
    - process_data_dict contains model_provider, model_name, and usage
    - outputs_dict contains usage with prompt/completion breakdown
    - execution_metadata_dict contains total_tokens/total_price/currency
    """
    return _make_execution(
        tenant_id="tenant-flow",
        app_id="app-flow",
        workflow_id="wf-flow",
        id="exec-flow",
        node_id="node-llm",
        node_type="llm",
        title="GPT-4o Node",
        status="succeeded",
        elapsed_time=2.3,
        workflow_run_id=None,
        process_data_dict={
            "model_mode": "chat",
            "model_provider": "openai",
            "model_name": "gpt-4o",
            "prompts": [{"role": "user", "text": "hello"}],
            "usage": {
                "prompt_tokens": 50,
                "prompt_unit_price": 0.00001,
                "prompt_price_unit": 0.001,
                "prompt_price": 0.0005,
                "completion_tokens": 30,
                "completion_unit_price": 0.00003,
                "completion_price_unit": 0.001,
                "completion_price": 0.0009,
                "total_tokens": 80,
                "total_price": 0.0014,
                "currency": "USD",
                "latency": 2.3,
            },
            "finish_reason": "stop",
        },
        outputs_dict={
            "text": "world",
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 30,
                "total_tokens": 80,
                "total_price": 0.0014,
                "currency": "USD",
            },
            "finish_reason": "stop",
        },
        execution_metadata_dict={
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 80,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.0014,
            WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
        },
    )


class TestDraftTraceTokenDataFlow:
    """End-to-end test: verify all token and model fields survive from
    _build_node_execution_data through ops_trace_manager.draft_node_execution_trace
    to the DraftNodeExecutionTrace that enterprise_trace.py consumes.
    """

    def test_all_token_and_model_fields_reach_trace_info(self) -> None:
        """Simulate the full draft trace data flow for an LLM node and
        assert every token/model field that enterprise_trace._emit_node_execution_trace
        reads is populated correctly on the resulting DraftNodeExecutionTrace."""
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_llm_execution()
        node_data = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id="run-flow",
        )

        # Simulate what ops_trace_manager.draft_node_execution_trace does:
        # it calls node_execution_trace(node_execution_data=node_data) which
        # reads top-level keys from node_data. Verify all expected keys exist.
        expected_keys = {
            # Token fields — read by enterprise_trace._emit_node_execution_trace
            "total_tokens",
            "total_price",
            "currency",
            "prompt_tokens",
            "completion_tokens",
            # Model fields — read for span attrs and metric labels
            "model_provider",
            "model_name",
            # Node identity — read for span attrs
            "node_type",
            "node_execution_id",
            "node_id",
            "title",
            "status",
            "error",
            "elapsed_time",
            # Workflow context
            "workflow_id",
            "workflow_execution_id",
            "tenant_id",
            "app_id",
            # Structure fields
            "index",
            "predecessor_node_id",
            "iteration_id",
            "iteration_index",
            "loop_id",
            "loop_index",
            "parallel_id",
            # Tool field
            "tool_name",
            # Content fields
            "node_inputs",
            "node_outputs",
            "process_data",
            # Timestamps
            "created_at",
            "finished_at",
        }
        assert set(node_data.keys()) == expected_keys

        # Verify token/model values are correct (not None/zero when data exists)
        assert node_data["total_tokens"] == 80
        assert node_data["total_price"] == 0.0014
        assert node_data["currency"] == "USD"
        assert node_data["prompt_tokens"] == 50
        assert node_data["completion_tokens"] == 30
        assert node_data["model_provider"] == "openai"
        assert node_data["model_name"] == "gpt-4o"
        assert node_data["node_type"] == "llm"

    def test_non_llm_node_has_none_for_model_and_token_breakdown(self) -> None:
        """For non-LLM nodes (e.g. code, IF), model and token breakdown
        should be None, but total_tokens from metadata should still work."""
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(
            node_type="code",
            process_data_dict={"code": "print('hi')"},
            outputs_dict={"result": "hi"},
            execution_metadata_dict={},
        )
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["model_provider"] is None
        assert result["model_name"] is None
        assert result["prompt_tokens"] is None
        assert result["completion_tokens"] is None
        assert result["total_tokens"] == 0

    def test_none_process_data_and_none_outputs(self) -> None:
        """Both process_data_dict and outputs_dict are None — exercises
        the `or {}` fallback and isinstance guard together."""
        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_execution(process_data_dict=None, outputs_dict=None)
        result = _build_node_execution_data(execution=execution, outputs=None, workflow_execution_id=None)

        assert result["model_provider"] is None
        assert result["model_name"] is None
        assert result["prompt_tokens"] is None
        assert result["completion_tokens"] is None

    def test_node_data_feeds_into_draft_node_execution_trace(self) -> None:
        """Verify the node_data dict can be consumed by
        ops_trace_manager.draft_node_execution_trace without error and
        produces a DraftNodeExecutionTrace with correct token/model fields."""

        from enterprise.telemetry.draft_trace import _build_node_execution_data

        execution = _make_llm_execution()
        node_data = _build_node_execution_data(
            execution=execution,
            outputs=None,
            workflow_execution_id="run-e2e",
        )

        # Directly construct DraftNodeExecutionTrace the way
        # ops_trace_manager.node_execution_trace does (lines 1315-1350),
        # skipping DB lookups by providing minimal metadata.
        from core.ops.entities.trace_entity import DraftNodeExecutionTrace

        trace_info = DraftNodeExecutionTrace(
            workflow_id=node_data.get("workflow_id", ""),
            workflow_run_id=node_data.get("workflow_execution_id", ""),
            tenant_id=node_data.get("tenant_id", ""),
            node_execution_id=node_data.get("node_execution_id", ""),
            node_id=node_data.get("node_id", ""),
            node_type=node_data.get("node_type", ""),
            title=node_data.get("title", ""),
            status=node_data.get("status", ""),
            error=node_data.get("error"),
            elapsed_time=node_data.get("elapsed_time", 0.0),
            index=node_data.get("index", 0),
            predecessor_node_id=node_data.get("predecessor_node_id"),
            total_tokens=node_data.get("total_tokens", 0),
            total_price=node_data.get("total_price", 0.0),
            currency=node_data.get("currency"),
            model_provider=node_data.get("model_provider"),
            model_name=node_data.get("model_name"),
            prompt_tokens=node_data.get("prompt_tokens"),
            completion_tokens=node_data.get("completion_tokens"),
            tool_name=node_data.get("tool_name"),
            iteration_id=node_data.get("iteration_id"),
            iteration_index=node_data.get("iteration_index"),
            loop_id=node_data.get("loop_id"),
            loop_index=node_data.get("loop_index"),
            parallel_id=node_data.get("parallel_id"),
            node_inputs=node_data.get("node_inputs"),
            node_outputs=node_data.get("node_outputs"),
            process_data=node_data.get("process_data"),
            start_time=node_data.get("created_at"),
            end_time=node_data.get("finished_at"),
            metadata={},
        )

        # These are the fields enterprise_trace._emit_node_execution_trace reads
        assert trace_info.total_tokens == 80
        assert trace_info.prompt_tokens == 50
        assert trace_info.completion_tokens == 30
        assert trace_info.model_provider == "openai"
        assert trace_info.model_name == "gpt-4o"
        assert trace_info.node_type == "llm"
        assert trace_info.total_price == 0.0014
        assert trace_info.currency == "USD"
