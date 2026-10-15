"""Agent preview callers are committed before execution and retain their identity."""

import json
from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph_events import NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.workflow_service import WorkflowService
from tests.unit_tests.services.test_workflow_service import TestWorkflowAssociatedDataFactory as Factory


class PreviewCancelled(BaseException):
    """Cancellation can bypass Exception handlers, like a stopped greenlet."""


@pytest.mark.parametrize("outcome", ["success", "failure", "exception", "cancel"])
def test_agent_preview_commits_runtime_identity_and_updates_same_row(sqlite_engine: Engine, outcome: str) -> None:
    tenant_id, app_id, workflow_id, account_id, execution_id = (str(uuid4()) for _ in range(5))
    node_id = "agent-preview"
    app = Factory.create_app(app_id=app_id, tenant_id=tenant_id)
    account = Factory.create_account(account_id=account_id)
    workflow = Factory.create_workflow(
        workflow_id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        graph={
            "nodes": [
                {
                    "id": node_id,
                    "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Agent"},
                }
            ],
            "edges": [],
        },
    )
    sessions = sessionmaker(sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        session.add_all([app, account, workflow])
    repository = SQLAlchemyWorkflowNodeExecutionRepository(
        sessions, tenant_id, account, app_id, WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
    )
    node = SimpleNamespace(execution_id=execution_id, node_type="agent", title="Agent", error_strategy=None)
    observed_created_at = []

    def events() -> Generator[NodeRunSucceededEvent | NodeRunFailedEvent]:
        # This is the real scoped lookup that failed in dev: a separate transaction
        # must see the committed caller before any runtime request is dispatched.
        variable_pool = single_step.call_args.kwargs["variable_pool"]
        workflow_run_id = get_system_text(variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
        assert workflow_run_id is None
        with sessions.begin() as session:
            caller = WorkflowAgentWorkspaceStore._load_execution_by_identity(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                node_execution_id=execution_id,
            )
            assert caller.id == caller.node_execution_id == execution_id
            assert caller.status == WorkflowNodeExecutionStatus.RUNNING
            assert caller.finished_at is None
            observed_created_at.append(caller.created_at)
            # Session materialization writes these independently; final persistence
            # must not discard either piece of caller ownership.
            caller.agent_workspace_binding_id = "workspace-binding"
            caller.process_data = json.dumps({"workflow_agent_binding_id": "workflow-binding"})
        if outcome == "exception":
            raise RuntimeError("private runtime error details")
        if outcome == "cancel":
            raise PreviewCancelled()
        status = WorkflowNodeExecutionStatus.SUCCEEDED if outcome == "success" else WorkflowNodeExecutionStatus.FAILED
        result = NodeRunResult(
            status=status, outputs={"answer": "done"}, error="" if outcome == "success" else "failed"
        )
        if outcome == "success":
            yield NodeRunSucceededEvent(
                id=execution_id, node_id=node_id, node_type="agent", node_run_result=result, start_at=naive_utc_now()
            )
        else:
            yield NodeRunFailedEvent(
                id=execution_id,
                node_id=node_id,
                node_type="agent",
                node_run_result=result,
                start_at=naive_utc_now(),
                error="failed",
            )

    service = WorkflowService(sessions)
    with (
        patch("services.workflow_service.db", SimpleNamespace(engine=sqlite_engine)),
        patch("services.workflow_service.WorkflowDraftVariableService"),
        patch("services.workflow_service.DraftVarLoader"),
        patch("services.workflow_service.WorkflowEntry.single_step_run", return_value=(node, events())) as single_step,
        patch(
            "services.workflow_service.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            return_value=repository,
        ),
        patch("services.workflow_service.DraftVariableSaver"),
        patch("services.workflow_service.enqueue_draft_node_execution_trace"),
    ):
        if outcome in {"exception", "cancel"}:
            with pytest.raises(RuntimeError if outcome == "exception" else PreviewCancelled):
                service.run_draft_workflow_node(app, workflow, node_id, {}, account)
        else:
            response = service.run_draft_workflow_node(app, workflow, node_id, {}, account)
            assert response.id == response.node_execution_id == execution_id

    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(WorkflowNodeExecutionModel)) == 1
        row = session.get(WorkflowNodeExecutionModel, execution_id)
        assert row is not None
        assert row.id == row.node_execution_id == execution_id
        assert row.workflow_run_id is None
        assert row.workflow_id == workflow_id
        assert row.tenant_id == tenant_id
        assert row.app_id == app_id
        assert row.created_at == observed_created_at[0]
        assert row.finished_at is not None
        assert row.elapsed_time >= 0
        assert row.agent_workspace_binding_id == "workspace-binding"
        assert row.process_data_dict is not None
        assert row.process_data_dict["workflow_agent_binding_id"] == "workflow-binding"
        assert row.status == (
            WorkflowNodeExecutionStatus.SUCCEEDED if outcome == "success" else WorkflowNodeExecutionStatus.FAILED
        )
        if outcome in {"exception", "cancel"}:
            assert row.error == "Agent preview execution interrupted"


def test_agent_preview_rejects_mismatched_workflow_before_creating_caller(sqlite_engine: Engine) -> None:
    app = Factory.create_app(app_id="app", tenant_id="tenant")
    account = Factory.create_account()
    workflow = Factory.create_workflow(
        app_id="another-app",
        tenant_id="another-tenant",
        graph={
            "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
            "edges": [],
        },
    )
    sessions = sessionmaker(sqlite_engine, expire_on_commit=False)
    repository = SQLAlchemyWorkflowNodeExecutionRepository(
        sessions, app.tenant_id, account, app.id, WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
    )
    with (
        patch("services.workflow_service.db", SimpleNamespace(engine=sqlite_engine)),
        patch("services.workflow_service.WorkflowDraftVariableService") as draft_variables,
        patch("services.workflow_service.DraftVarLoader"),
        patch("services.workflow_service.WorkflowEntry.single_step_run", return_value=(SimpleNamespace(), iter(()))),
        patch(
            "services.workflow_service.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            return_value=repository,
        ),
        pytest.raises(ValueError, match="does not belong"),
    ):
        WorkflowService(sessions).run_draft_workflow_node(app, workflow, "agent", {}, account)
    draft_variables.assert_not_called()
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(WorkflowNodeExecutionModel)) == 0
