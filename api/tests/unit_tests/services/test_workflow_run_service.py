"""Unit tests for the Console workflow-run application service."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from graphon.enums import WorkflowExecutionStatus
from machinery.context import RequestContext
from models import WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from models.enums import CreatorUserRole
from repositories.sqlalchemy_api_workflow_run_repository import WorkflowRunMessageRef
from services import workflow_run_service as service_module
from services.workflow_run_service import WorkflowRunService


@pytest.fixture
def service_dependencies() -> tuple[MagicMock, MagicMock]:
    return MagicMock(), MagicMock()


def _service(dependencies: tuple[MagicMock, MagicMock]) -> WorkflowRunService:
    node_executions, workflow_runs = dependencies
    return WorkflowRunService(
        workflow_runs=workflow_runs,
        node_executions=node_executions,
    )


def _request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
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
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


def test_init_keeps_injected_dependencies(
    service_dependencies: tuple[MagicMock, MagicMock],
) -> None:
    node_executions, workflow_runs = service_dependencies

    service = _service(service_dependencies)

    assert service._workflow_runs is workflow_runs
    assert service._node_executions is node_executions


class TestWorkflowRunServiceQueries:
    def test_get_paginate_workflow_runs_should_forward_filters_and_parse_limit(
        self,
        service_dependencies: tuple[MagicMock, MagicMock],
    ) -> None:
        _, workflow_runs = service_dependencies
        service = _service(service_dependencies)
        expected = MagicMock(name="pagination")
        workflow_runs.get_paginated_workflow_runs.return_value = expected
        args = {"limit": "7", "last_id": "last-1", "status": "succeeded"}

        result = service.get_paginate_workflow_runs(
            _request_context(workspace_id="tenant-1"),
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
        service = _service(service_dependencies)
        run_with_message = _workflow_run(status=WorkflowExecutionStatus.RUNNING)
        run_without_message = _workflow_run(run_id="run-2")
        pagination = SimpleNamespace(data=[run_with_message, run_without_message])
        monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))
        workflow_runs.get_message_refs.return_value = {
            "run-1": WorkflowRunMessageRef(message_id="msg-1", conversation_id="conv-1")
        }

        result = service.get_paginate_advanced_chat_workflow_runs(
            _request_context(),
            app_id="app-1",
            args={"limit": "2"},
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
        service = _service(service_dependencies)
        expected = _workflow_run()
        workflow_runs.get_workflow_run_by_id.return_value = expected

        result = service.get_workflow_run(_request_context(), app_id="app-1", run_id="run-1")

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
        service = _service(service_dependencies)
        expected = {"total": 3, "succeeded": 2}
        workflow_runs.get_workflow_runs_count.return_value = expected

        result = service.get_workflow_runs_count(
            _request_context(),
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
        service = _service(service_dependencies)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=None))

        result = service.get_workflow_run_node_executions(
            _request_context(),
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
        service = _service(service_dependencies)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=_workflow_run()))
        expected_executions = [SimpleNamespace(id="exec-1"), SimpleNamespace(id="exec-2")]
        expected_traces = [SimpleNamespace(id="exec-1:retry:1"), SimpleNamespace(id="exec-1")]
        node_executions.get_executions_by_workflow_run.return_value = expected_executions
        mock_assemble = MagicMock(return_value=expected_traces)
        monkeypatch.setattr(service_module, "assemble_workflow_node_execution_traces", mock_assemble)

        result = service.get_workflow_run_node_executions(
            _request_context(workspace_id="tenant-context"),
            app_id="app-1",
            run_id="run-1",
        )

        assert result == expected_traces
        node_executions.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-context",
            app_id="app-1",
            workflow_run_id="run-1",
        )
        mock_assemble.assert_called_once_with(expected_executions, node_executions)
