from datetime import datetime
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, create_autospec

import pytest
from pydantic import TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    WORKFLOW_TOOL_ROOT_APP_ID_KEY,
)
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from machinery.context import RequestContext
from models import WorkflowRun, WorkflowRunTriggeredFrom
from models.enums import CreatorUserRole
from models.workflow import WorkflowPause
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    WorkflowRunMessageRef,
    WorkflowRunPauseRecord,
    _PrivateWorkflowPauseEntity,
)
from services import workflow_run_service as service_module
from services.workflow_node_execution_trace_service import WorkflowNodeExecutionTrace
from services.workflow_pause_service import WorkflowPauseSnapshot
from services.workflow_run_service import (
    WorkflowRunListArgs,
    WorkflowRunPauseDetails,
    WorkflowRunPausedNode,
    WorkflowRunService,
)

"""Unit tests for the Console workflow-run application service."""


def _workflow_run_service_service(dependencies: tuple[MagicMock, MagicMock]) -> WorkflowRunService:
    node_executions, workflow_runs = dependencies
    return WorkflowRunService(
        workflow_runs=workflow_runs,
        session_factory=sessionmaker(),
        node_executions=node_executions,
    )


def _workflow_run_service_request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


def _workflow_run(
    *, run_id: str = "run-1", status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED
) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=ModelWorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


class TestWorkflowRunServiceCases:
    @staticmethod
    @pytest.fixture
    def service_dependencies() -> tuple[MagicMock, MagicMock]:
        return MagicMock(), MagicMock()

    class TestWorkflowRunServiceQueries:
        def test_workflow_tool_details_require_the_root_app_run_and_hide_internal_correlation(
            self, service_dependencies: tuple[MagicMock, MagicMock], monkeypatch: pytest.MonkeyPatch
        ) -> None:
            node_executions, workflow_runs = service_dependencies
            service = _workflow_run_service_service(service_dependencies)
            workflow_runs.get_workflow_run_by_id.return_value = None
            context = _workflow_run_service_request_context()
            assert (
                service.get_workflow_tool_node_executions(
                    context, app_id="app-1", run_id="run-1", node_execution_id="parent-1"
                )
                is None
            )
            node_executions.get_workflow_tool_executions.assert_not_called()

            workflow_runs.get_workflow_run_by_id.return_value = _workflow_run()
            trace = WorkflowNodeExecutionTrace(
                id="execution-1",
                tenant_id="tenant-1",
                app_id="source-app",
                workflow_id="source-workflow",
                triggered_from="workflow-tool",
                created_by="account-1",
                process_data={
                    "answer": "approved",
                    WORKFLOW_TOOL_INVOCATION_ID_KEY: "invocation-1",
                    WORKFLOW_TOOL_ROOT_APP_ID_KEY: "app-1",
                },
            )
            assemble = create_autospec(service_module.assemble_workflow_node_execution_traces, return_value=[trace])
            monkeypatch.setattr(service_module, "assemble_workflow_node_execution_traces", assemble)
            result = service.get_workflow_tool_node_executions(
                context, app_id="app-1", run_id="run-1", node_execution_id="parent-1"
            )
            workflow_runs.get_workflow_run_by_id.assert_called_with(
                tenant_id="tenant-1", app_id="app-1", run_id="run-1"
            )
            node_executions.get_workflow_tool_executions.assert_called_once_with(
                tenant_id="tenant-1", workflow_run_id="run-1", parent_node_execution_id="parent-1"
            )
            assemble.assert_called_once_with(
                node_executions.get_workflow_tool_executions.return_value, node_executions, session=ANY
            )
            assert result == [trace]
            assert trace.process_data == {"answer": "approved"}

        def test_get_paginate_workflow_runs_should_forward_filters_and_parse_limit(
            self,
            service_dependencies: tuple[MagicMock, MagicMock],
        ) -> None:
            _, workflow_runs = service_dependencies
            service = _workflow_run_service_service(service_dependencies)
            expected = MagicMock(name="pagination")
            workflow_runs.get_paginated_workflow_runs.return_value = expected
            args = TypeAdapter(WorkflowRunListArgs).validate_python(
                {"limit": "7", "last_id": "last-1", "status": "succeeded"}
            )

            result = service.get_paginate_workflow_runs(
                _workflow_run_service_request_context(workspace_id="tenant-1"),
                app_id="app-1",
                args=args,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

            assert result is expected
            workflow_runs.get_paginated_workflow_runs.assert_called_once_with(
                tenant_id="tenant-1",
                app_id="app-1",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                limit=7,
                last_id="last-1",
                status="succeeded",
            )

        def test_get_paginate_advanced_chat_workflow_runs_should_attach_message_fields_when_message_exists(
            self,
            service_dependencies: tuple[MagicMock, MagicMock],
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            _, workflow_runs = service_dependencies
            service = _workflow_run_service_service(service_dependencies)
            run_with_message = _workflow_run(status=WorkflowExecutionStatus.RUNNING)
            run_without_message = _workflow_run(run_id="run-2")
            pagination = SimpleNamespace(data=[run_with_message, run_without_message])
            monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))
            workflow_runs.get_message_refs.return_value = {
                "run-1": WorkflowRunMessageRef(message_id="msg-1", conversation_id="conv-1")
            }

            result = service.get_paginate_advanced_chat_workflow_runs(
                _workflow_run_service_request_context(),
                app_id="app-1",
                args={"limit": 2},
            )

            assert result is pagination
            assert len(result.data) == 2
            assert result.data[0].message_id == "msg-1"
            assert result.data[0].conversation_id == "conv-1"
            assert result.data[0].status == "running"
            assert not hasattr(result.data[1], "message_id")
            assert result.data[1].id == "run-2"
            workflow_runs.get_message_refs.assert_called_once_with(
                app_id="app-1",
                workflow_run_ids=["run-1", "run-2"],
            )

        def test_get_workflow_run_should_delegate_to_repository_by_tenant_and_app(
            self,
            service_dependencies: tuple[MagicMock, MagicMock],
        ) -> None:
            _, workflow_runs = service_dependencies
            service = _workflow_run_service_service(service_dependencies)
            expected = _workflow_run()
            workflow_runs.get_workflow_run_by_id.return_value = expected

            result = service.get_workflow_run(_workflow_run_service_request_context(), app_id="app-1", run_id="run-1")

            assert result is expected
            workflow_runs.get_workflow_run_by_id.assert_called_once_with(
                tenant_id="tenant-1",
                app_id="app-1",
                run_id="run-1",
            )

        def test_get_workflow_runs_count_should_forward_optional_filters(
            self,
            service_dependencies: tuple[MagicMock, MagicMock],
        ) -> None:
            _, workflow_runs = service_dependencies
            service = _workflow_run_service_service(service_dependencies)
            expected = {"total": 3, "succeeded": 2}
            workflow_runs.get_workflow_runs_count.return_value = expected

            result = service.get_workflow_runs_count(
                _workflow_run_service_request_context(),
                app_id="app-1",
                status="succeeded",
                time_range="7d",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

            assert result == expected
            workflow_runs.get_workflow_runs_count.assert_called_once_with(
                tenant_id="tenant-1",
                app_id="app-1",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                status="succeeded",
                time_range="7d",
            )

        def test_get_workflow_run_node_executions_should_return_empty_list_when_run_not_found(
            self,
            service_dependencies: tuple[MagicMock, MagicMock],
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            service = _workflow_run_service_service(service_dependencies)
            monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=None))

            result = service.get_workflow_run_node_executions(
                _workflow_run_service_request_context(),
                app_id="app-1",
                run_id="run-1",
            )

            assert result == []

        def test_get_workflow_run_node_executions_should_use_request_workspace(
            self,
            service_dependencies: tuple[MagicMock, MagicMock],
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            node_executions, _ = service_dependencies
            service = _workflow_run_service_service(service_dependencies)
            monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=_workflow_run()))
            expected_executions = [SimpleNamespace(id="exec-1"), SimpleNamespace(id="exec-2")]
            expected_traces = [SimpleNamespace(id="exec-1:retry:1"), SimpleNamespace(id="exec-1")]
            node_executions.get_executions_by_workflow_run.return_value = expected_executions
            mock_assemble = MagicMock(return_value=expected_traces)
            monkeypatch.setattr(service_module, "assemble_workflow_node_execution_traces", mock_assemble)

            result = service.get_workflow_run_node_executions(
                _workflow_run_service_request_context(workspace_id="tenant-context"),
                app_id="app-1",
                run_id="run-1",
            )

            assert result == expected_traces
            node_executions.get_executions_by_workflow_run.assert_called_once_with(
                tenant_id="tenant-context",
                app_id="app-1",
                workflow_run_id="run-1",
            )
            mock_assemble.assert_called_once_with(expected_executions, node_executions, session=ANY)


"""Tests for Console workflow pause details."""


def _workflow_run_service_pause_service(workflow_runs: MagicMock) -> WorkflowRunService:
    return WorkflowRunService(
        workflow_runs=workflow_runs,
        node_executions=MagicMock(),
        session_factory=sessionmaker(),
    )


def _workflow_run_service_pause_request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


"""Tests for Console workflow pause details."""


@pytest.fixture
def workflow_runs() -> DifyAPISQLAlchemyWorkflowRunRepository:
    return DifyAPISQLAlchemyWorkflowRunRepository(sessionmaker())


def _service(workflow_runs: DifyAPISQLAlchemyWorkflowRunRepository) -> WorkflowRunService:
    return WorkflowRunService(
        workflow_runs=workflow_runs,
        node_executions=DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sessionmaker()),
        session_factory=sessionmaker(),
    )


def _request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


def test_get_pause_details_returns_none_when_run_is_not_found(
    workflow_runs: DifyAPISQLAlchemyWorkflowRunRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    lookups: list[tuple[str, str]] = []

    def missing(_session: Session, *, workspace_id: str, workflow_run_id: str) -> None:
        lookups.append((workspace_id, workflow_run_id))

    monkeypatch.setattr(workflow_runs, "get_pause_record", missing)

    result = _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result is None
    assert lookups == [("tenant-1", "run-1")]


@pytest.mark.parametrize("status", [WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.PAUSED])
def test_get_pause_details_returns_empty_details_without_an_active_pause(
    workflow_runs: DifyAPISQLAlchemyWorkflowRunRepository,
    status: WorkflowExecutionStatus,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = WorkflowRunPauseRecord(
        status=status,
        pause=None,
    )
    monkeypatch.setattr(workflow_runs, "get_pause_record", lambda *_args, **_kwargs: record)

    result = _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result == WorkflowRunPauseDetails(paused_at=None, paused_nodes=())


def test_get_pause_details_maps_human_input_and_token(
    workflow_runs: DifyAPISQLAlchemyWorkflowRunRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Approve?",
        node_id="node-1",
        node_title="Approval",
    )
    paused_at = datetime(2026, 1, 2, 3, 4, 5)
    pause_model = WorkflowPause(workflow_id="workflow-1", workflow_run_id="run-1", state_object_key="state")
    pause_model.created_at = paused_at
    pause = _PrivateWorkflowPauseEntity(pause_model=pause_model)
    record = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.PAUSED,
        pause=pause,
    )

    lookups: list[tuple[str, str]] = []

    def pause_record(_session: Session, *, workspace_id: str, workflow_run_id: str) -> WorkflowRunPauseRecord:
        lookups.append((workspace_id, workflow_run_id))
        return record

    monkeypatch.setattr(workflow_runs, "get_pause_record", pause_record)
    monkeypatch.setattr(workflow_runs, "get_legacy_form_tokens", lambda *_args, **_kwargs: {"form-1": "form-token"})
    monkeypatch.setattr(
        "services.workflow_run_service.load_workflow_pause_snapshot",
        lambda *_args, **_kwargs: WorkflowPauseSnapshot(
            runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
            reasons=(reason,),
            v2_forms={},
        ),
    )

    result = _service(workflow_runs).get_pause_details(
        _request_context(workspace_id="tenant-context"),
        workflow_run_id="run-1",
    )

    assert result == WorkflowRunPauseDetails(
        paused_at=paused_at,
        paused_nodes=(
            WorkflowRunPausedNode(
                node_id="node-1",
                node_title="Approval",
                form_id="form-1",
                form_version="1",
                form_token="form-token",
            ),
        ),
    )

    assert lookups == [("tenant-context", "run-1")]


def test_get_pause_details_rejects_unsupported_pause_reason(
    workflow_runs: DifyAPISQLAlchemyWorkflowRunRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    record = WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.PAUSED,
        pause=_PrivateWorkflowPauseEntity(
            pause_model=WorkflowPause(workflow_id="workflow-1", workflow_run_id="run-1", state_object_key="state")
        ),
    )
    monkeypatch.setattr(workflow_runs, "get_pause_record", lambda *_args, **_kwargs: record)
    monkeypatch.setattr(
        "services.workflow_run_service.load_workflow_pause_snapshot",
        lambda *_args, **_kwargs: WorkflowPauseSnapshot(
            runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
            reasons=(SchedulingPause(message="Waiting for external input"),),
            v2_forms={},
        ),
    )

    with pytest.raises(NotImplementedError, match="Pause details do not support SchedulingPause"):
        _service(workflow_runs).get_pause_details(_request_context(), workflow_run_id="run-1")
