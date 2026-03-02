import json
from datetime import datetime

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from dify_graph.entities.workflow_execution import WorkflowExecution, WorkflowRunRerunMetadata, WorkflowRunRerunScope
from dify_graph.enums import WorkflowExecutionStatus, WorkflowType
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun


def _new_repo() -> SQLAlchemyWorkflowExecutionRepository:
    repo = SQLAlchemyWorkflowExecutionRepository.__new__(SQLAlchemyWorkflowExecutionRepository)
    repo._tenant_id = "tenant-id"  # type: ignore[attr-defined]
    repo._app_id = "app-id"  # type: ignore[attr-defined]
    repo._triggered_from = WorkflowRunTriggeredFrom.RERUN  # type: ignore[attr-defined]
    repo._creator_user_id = "account-id"  # type: ignore[attr-defined]
    repo._creator_user_role = CreatorUserRole.ACCOUNT  # type: ignore[attr-defined]
    return repo


def _build_execution_with_rerun_metadata() -> WorkflowExecution:
    return WorkflowExecution(
        id_="workflow-run-id",
        workflow_id="workflow-id",
        workflow_version="v1",
        workflow_type=WorkflowType.WORKFLOW,
        graph={"nodes": [], "edges": []},
        inputs={"input": "value"},
        outputs={"answer": "value"},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message="",
        total_tokens=1,
        total_steps=1,
        exceptions_count=0,
        started_at=datetime(2026, 3, 1, 0, 0, 0),
        finished_at=datetime(2026, 3, 1, 0, 0, 1),
        rerun_metadata=WorkflowRunRerunMetadata(
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
        ),
    )


def test_to_db_model_sets_rerun_fields() -> None:
    repo = _new_repo()
    execution = _build_execution_with_rerun_metadata()

    db_model = repo._to_db_model(execution)

    assert db_model.rerun_from_workflow_run_id == "source-run-id"
    assert db_model.rerun_from_node_id == "target-node-id"
    assert db_model.rerun_chain_root_workflow_run_id == "chain-root-id"
    assert db_model.rerun_kind == "manual-node-rerun"
    assert json.loads(db_model.rerun_scope or "{}")["target_node_id"] == "target-node-id"
    assert json.loads(db_model.rerun_overrides or "[]")[0]["selector"] == ["node_a", "output"]


def test_to_rerun_metadata_reads_rerun_fields() -> None:
    repo = _new_repo()
    db_model = WorkflowRun()
    db_model.id = "workflow-run-id"
    db_model.rerun_from_workflow_run_id = "source-run-id"
    db_model.rerun_from_node_id = "target-node-id"
    db_model.rerun_chain_root_workflow_run_id = "chain-root-id"
    db_model.rerun_kind = "manual-node-rerun"
    db_model.rerun_overrides = json.dumps([{"selector": ["node_a", "output"], "value": "patched"}])
    db_model.rerun_scope = json.dumps(
        {
            "target_node_id": "target-node-id",
            "ancestor_node_ids": ["node_a"],
            "rerun_node_ids": ["target-node-id"],
            "overrideable_node_ids": ["node_a"],
        }
    )

    metadata = repo._to_rerun_metadata(db_model)

    assert metadata is not None
    assert metadata.rerun_from_workflow_run_id == "source-run-id"
    assert metadata.rerun_scope.target_node_id == "target-node-id"
    assert metadata.rerun_overrides[0]["value"] == "patched"
