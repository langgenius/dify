"""Tests for OpikDataTrace workflow_trace changes.

Covers:
- _seed_to_uuid4 helper: produces valid UUID4 strings deterministically
- prepare_opik_uuid helper: basic contract
- workflow_trace without message_id now creates a root span parented to None
- workflow_trace without message_id: node spans parent to root_span_id (not workflow_app_log_id)
- workflow_trace with message_id still creates root span keyed on workflow_run_id (unchanged path)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

from core.ops.entities.trace_entity import TraceTaskName, WorkflowTraceInfo
from core.ops.opik_trace.opik_trace import OpikDataTrace, _seed_to_uuid4, prepare_opik_uuid

# A stable UUID4 used as the workflow_run_id throughout all tests.
_WORKFLOW_RUN_ID = "a3f1b2c4-d5e6-4f78-9a0b-c1d2e3f4a5b6"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_workflow_trace_info(
    *,
    message_id: str | None = None,
    workflow_app_log_id: str | None = None,
    workflow_run_id: str = _WORKFLOW_RUN_ID,
) -> WorkflowTraceInfo:
    """Return a minimal WorkflowTraceInfo suitable for unit testing."""
    return WorkflowTraceInfo(
        message_id=message_id,
        workflow_id="wf-id",
        tenant_id="tenant-id",
        workflow_run_id=workflow_run_id,
        workflow_app_log_id=workflow_app_log_id,
        workflow_run_elapsed_time=1.5,
        workflow_run_status="succeeded",
        workflow_run_inputs={"query": "hello"},
        workflow_run_outputs={"result": "world"},
        workflow_run_version="1",
        total_tokens=42,
        file_list=[],
        query="hello",
        start_time=datetime(2025, 1, 1, 12, 0, 0),
        end_time=datetime(2025, 1, 1, 12, 0, 1),
        metadata={"app_id": "app-abc"},
        conversation_id=None,
    )


def _make_opik_trace_instance() -> OpikDataTrace:
    """Construct an OpikDataTrace with the Opik SDK client mocked out."""
    with patch("core.ops.opik_trace.opik_trace.Opik"):
        from core.ops.entities.config_entity import OpikConfig

        config = OpikConfig(api_key="key", project="test-project", url="https://www.comet.com/opik/api/")
        instance = OpikDataTrace(config)

    instance.add_trace = MagicMock(return_value=MagicMock(id="mock-trace-id"))
    instance.add_span = MagicMock()
    instance.get_service_account_with_tenant = MagicMock(return_value=MagicMock())
    return instance


# ---------------------------------------------------------------------------
# _seed_to_uuid4
# ---------------------------------------------------------------------------


class TestSeedToUuid4:
    def test_returns_valid_uuid4_string(self):
        result = _seed_to_uuid4("some-arbitrary-seed")
        parsed = uuid.UUID(result)
        assert parsed.version == 4

    def test_is_deterministic(self):
        assert _seed_to_uuid4("seed-abc") == _seed_to_uuid4("seed-abc")

    def test_different_seeds_give_different_results(self):
        assert _seed_to_uuid4("seed-1") != _seed_to_uuid4("seed-2")

    def test_workflow_run_id_with_root_suffix_is_valid_uuid4(self):
        """The primary use-case: deriving a root-span UUID from workflow_run_id + '-root'."""
        seed = _WORKFLOW_RUN_ID + "-root"
        result = _seed_to_uuid4(seed)
        parsed = uuid.UUID(result)
        assert parsed.version == 4

    def test_seed_and_seed_root_produce_different_uuids(self):
        """Root span UUID must differ from the base workflow UUID to avoid ID collisions."""
        base = _seed_to_uuid4(_WORKFLOW_RUN_ID)
        with_root = _seed_to_uuid4(_WORKFLOW_RUN_ID + "-root")
        assert base != with_root


# ---------------------------------------------------------------------------
# prepare_opik_uuid
# ---------------------------------------------------------------------------


class TestPrepareOpikUuid:
    def test_is_deterministic(self):
        dt = datetime(2025, 6, 15, 10, 30, 0)
        uid = str(uuid.uuid4())
        assert prepare_opik_uuid(dt, uid) == prepare_opik_uuid(dt, uid)

    def test_different_uuids_give_different_results(self):
        dt = datetime(2025, 6, 15, 10, 30, 0)
        assert prepare_opik_uuid(dt, str(uuid.uuid4())) != prepare_opik_uuid(dt, str(uuid.uuid4()))

    def test_none_datetime_does_not_raise(self):
        assert prepare_opik_uuid(None, str(uuid.uuid4())) is not None

    def test_none_uuid_does_not_raise(self):
        assert prepare_opik_uuid(datetime(2025, 1, 1), None) is not None


# ---------------------------------------------------------------------------
# workflow_trace — no message_id (new code path)
# ---------------------------------------------------------------------------


class TestWorkflowTraceWithoutMessageId:
    def _run(self, trace_info: WorkflowTraceInfo, node_executions: list | None = None):
        instance = _make_opik_trace_instance()
        fake_repo = MagicMock()
        fake_repo.get_by_workflow_execution.return_value = node_executions or []

        with (
            patch("core.ops.opik_trace.opik_trace.db") as mock_db,
            patch("core.ops.opik_trace.opik_trace.sessionmaker"),
            patch(
                "core.ops.opik_trace.opik_trace.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
                return_value=fake_repo,
            ),
        ):
            mock_db.engine = MagicMock()
            instance.workflow_trace(trace_info)

        return instance

    def _expected_root_span_id(self, trace_info: WorkflowTraceInfo):
        return prepare_opik_uuid(
            trace_info.start_time,
            _seed_to_uuid4(trace_info.workflow_run_id + "-root"),
        )

    def test_root_span_is_created(self):
        trace_info = _make_workflow_trace_info(message_id=None)
        instance = self._run(trace_info)
        assert instance.add_span.called

    def test_root_span_id_matches_expected(self):
        trace_info = _make_workflow_trace_info(message_id=None)
        instance = self._run(trace_info)

        expected = self._expected_root_span_id(trace_info)
        root_span_kwargs = instance.add_span.call_args_list[0][0][0]
        assert root_span_kwargs["id"] == expected

    def test_root_span_has_no_parent(self):
        trace_info = _make_workflow_trace_info(message_id=None)
        instance = self._run(trace_info)

        root_span_kwargs = instance.add_span.call_args_list[0][0][0]
        assert root_span_kwargs["parent_span_id"] is None

    def test_trace_name_is_workflow_trace(self):
        """Without message_id, the Opik trace itself should be named WORKFLOW_TRACE."""
        trace_info = _make_workflow_trace_info(message_id=None)
        instance = self._run(trace_info)

        trace_kwargs = instance.add_trace.call_args_list[0][0][0]
        assert trace_kwargs["name"] == TraceTaskName.WORKFLOW_TRACE

    def test_root_span_name_is_workflow_trace(self):
        trace_info = _make_workflow_trace_info(message_id=None)
        instance = self._run(trace_info)

        root_span_kwargs = instance.add_span.call_args_list[0][0][0]
        assert root_span_kwargs["name"] == TraceTaskName.WORKFLOW_TRACE

    def test_root_span_has_workflow_tag(self):
        trace_info = _make_workflow_trace_info(message_id=None)
        instance = self._run(trace_info)

        root_span_kwargs = instance.add_span.call_args_list[0][0][0]
        assert "workflow" in root_span_kwargs["tags"]

    def test_node_execution_spans_are_parented_to_root(self):
        """Node spans must use root_span_id as parent, not any other ID."""
        trace_info = _make_workflow_trace_info(message_id=None)
        expected_root_span_id = self._expected_root_span_id(trace_info)

        node_exec = MagicMock()
        node_exec.id = str(uuid.uuid4())
        node_exec.title = "LLM Node"
        node_exec.node_type = "llm"
        node_exec.status = "succeeded"
        node_exec.process_data = {}
        node_exec.inputs = {"prompt": "hi"}
        node_exec.outputs = {"text": "hello"}
        node_exec.created_at = datetime(2025, 1, 1, 12, 0, 0)
        node_exec.elapsed_time = 0.5
        node_exec.metadata = {}

        instance = self._run(trace_info, node_executions=[node_exec])

        # call_args_list[0] = root span, [1] = node execution span
        assert instance.add_span.call_count == 2
        node_span_kwargs = instance.add_span.call_args_list[1][0][0]
        assert node_span_kwargs["parent_span_id"] == expected_root_span_id

    def test_node_span_not_parented_to_workflow_app_log_id(self):
        """Old behaviour derived parent from workflow_app_log_id; that must no longer apply."""
        trace_info = _make_workflow_trace_info(
            message_id=None,
            workflow_app_log_id=str(uuid.uuid4()),
        )

        node_exec = MagicMock()
        node_exec.id = str(uuid.uuid4())
        node_exec.title = "Tool Node"
        node_exec.node_type = "tool"
        node_exec.status = "succeeded"
        node_exec.process_data = {}
        node_exec.inputs = {}
        node_exec.outputs = {}
        node_exec.created_at = datetime(2025, 1, 1, 12, 0, 0)
        node_exec.elapsed_time = 0.2
        node_exec.metadata = {}

        instance = self._run(trace_info, node_executions=[node_exec])

        old_parent_id = prepare_opik_uuid(trace_info.start_time, trace_info.workflow_app_log_id)
        node_span_kwargs = instance.add_span.call_args_list[1][0][0]
        assert node_span_kwargs["parent_span_id"] != old_parent_id

    def test_root_span_id_differs_from_trace_id(self):
        """The root span must have a different ID from the Opik trace to maintain correct hierarchy."""
        trace_info = _make_workflow_trace_info(message_id=None)
        dify_trace_id = trace_info.trace_id or trace_info.workflow_run_id
        opik_trace_id = prepare_opik_uuid(trace_info.start_time, dify_trace_id)
        root_span_id = self._expected_root_span_id(trace_info)
        assert root_span_id != opik_trace_id


# ---------------------------------------------------------------------------
# workflow_trace — with message_id (unchanged path, guard against regression)
# ---------------------------------------------------------------------------


class TestWorkflowTraceWithMessageId:
    _MESSAGE_ID = str(uuid.uuid4())

    def _run(self, trace_info: WorkflowTraceInfo, node_executions: list | None = None):
        instance = _make_opik_trace_instance()
        fake_repo = MagicMock()
        fake_repo.get_by_workflow_execution.return_value = node_executions or []

        with (
            patch("core.ops.opik_trace.opik_trace.db") as mock_db,
            patch("core.ops.opik_trace.opik_trace.sessionmaker"),
            patch(
                "core.ops.opik_trace.opik_trace.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
                return_value=fake_repo,
            ),
        ):
            mock_db.engine = MagicMock()
            instance.workflow_trace(trace_info)

        return instance

    def test_trace_name_is_message_trace(self):
        """With message_id, the Opik trace should be named MESSAGE_TRACE."""
        trace_info = _make_workflow_trace_info(message_id=self._MESSAGE_ID)
        instance = self._run(trace_info)

        trace_kwargs = instance.add_trace.call_args_list[0][0][0]
        assert trace_kwargs["name"] == TraceTaskName.MESSAGE_TRACE

    def test_root_span_uses_workflow_run_id_directly(self):
        """When message_id is set, root_span_id = prepare_opik_uuid(start_time, workflow_run_id)."""
        trace_info = _make_workflow_trace_info(message_id=self._MESSAGE_ID)
        instance = self._run(trace_info)

        expected_root_span_id = prepare_opik_uuid(trace_info.start_time, trace_info.workflow_run_id)
        root_span_kwargs = instance.add_span.call_args_list[0][0][0]
        assert root_span_kwargs["id"] == expected_root_span_id

    def test_root_span_id_differs_from_no_message_id_case(self):
        """The two branches must produce different root span IDs for the same workflow_run_id."""
        id_with_message = prepare_opik_uuid(
            datetime(2025, 1, 1, 12, 0, 0),
            _WORKFLOW_RUN_ID,
        )
        id_without_message = prepare_opik_uuid(
            datetime(2025, 1, 1, 12, 0, 0),
            _seed_to_uuid4(_WORKFLOW_RUN_ID + "-root"),
        )
        assert id_with_message != id_without_message

    def test_node_spans_parented_to_workflow_run_root_span(self):
        """Node spans must still parent to root_span_id derived from workflow_run_id."""
        trace_info = _make_workflow_trace_info(message_id=self._MESSAGE_ID)
        expected_root_span_id = prepare_opik_uuid(trace_info.start_time, trace_info.workflow_run_id)

        node_exec = MagicMock()
        node_exec.id = str(uuid.uuid4())
        node_exec.title = "LLM"
        node_exec.node_type = "llm"
        node_exec.status = "succeeded"
        node_exec.process_data = {}
        node_exec.inputs = {}
        node_exec.outputs = {}
        node_exec.created_at = datetime(2025, 1, 1, 12, 0, 0)
        node_exec.elapsed_time = 0.3
        node_exec.metadata = {}

        instance = self._run(trace_info, node_executions=[node_exec])

        node_span_kwargs = instance.add_span.call_args_list[1][0][0]
        assert node_span_kwargs["parent_span_id"] == expected_root_span_id
