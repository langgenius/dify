from datetime import datetime

from dify_graph.entities.workflow_execution import WorkflowExecution, WorkflowRunRerunMetadata, WorkflowRunRerunScope
from dify_graph.enums import WorkflowExecutionStatus, WorkflowType
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from tasks.workflow_execution_tasks import _create_workflow_run_from_execution


def _build_execution(*, with_rerun_metadata: bool) -> WorkflowExecution:
    rerun_metadata = None
    if with_rerun_metadata:
        rerun_metadata = WorkflowRunRerunMetadata(
            rerun_from_workflow_run_id="source-run-id",
            rerun_from_node_id="target-node-id",
            rerun_overrides=[{"selector": ["node_a", "output"], "value": "patched"}],
            rerun_scope=WorkflowRunRerunScope(
                target_node_id="target-node-id",
                ancestor_node_ids=["node_a"],
                rerun_node_ids=["target-node-id"],
                overrideable_node_ids=["node_a"],
            ),
            rerun_chain_root_workflow_run_id="chain-root-id",
            rerun_kind="manual-node-rerun",
        )

    return WorkflowExecution(
        id_="workflow-run-id",
        workflow_id="workflow-id",
        workflow_version="v1",
        workflow_type=WorkflowType.WORKFLOW,
        graph={"nodes": [], "edges": []},
        inputs={"query": "hello"},
        outputs={"answer": "world"},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message="",
        total_tokens=12,
        total_steps=3,
        exceptions_count=0,
        started_at=datetime(2026, 3, 1, 0, 0, 0),
        finished_at=datetime(2026, 3, 1, 0, 0, 1),
        rerun_metadata=rerun_metadata,
    )


def test_create_workflow_run_from_execution_with_rerun_metadata() -> None:
    execution = _build_execution(with_rerun_metadata=True)

    workflow_run = _create_workflow_run_from_execution(
        execution=execution,
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowRunTriggeredFrom.RERUN,
        creator_user_id="account-id",
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert workflow_run.triggered_from == WorkflowRunTriggeredFrom.RERUN.value
    assert workflow_run.rerun_from_workflow_run_id == "source-run-id"
    assert workflow_run.rerun_from_node_id == "target-node-id"
    assert workflow_run.rerun_chain_root_workflow_run_id == "chain-root-id"
    assert workflow_run.rerun_kind == "manual-node-rerun"
    assert workflow_run.rerun_overrides is not None
    assert workflow_run.rerun_scope is not None


def test_create_workflow_run_from_execution_without_rerun_metadata() -> None:
    execution = _build_execution(with_rerun_metadata=False)

    workflow_run = _create_workflow_run_from_execution(
        execution=execution,
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        creator_user_id="account-id",
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert workflow_run.triggered_from == WorkflowRunTriggeredFrom.DEBUGGING.value
    assert workflow_run.rerun_from_workflow_run_id is None
    assert workflow_run.rerun_from_node_id is None
    assert workflow_run.rerun_overrides is None
    assert workflow_run.rerun_scope is None
    assert workflow_run.rerun_chain_root_workflow_run_id is None
    assert workflow_run.rerun_kind is None
