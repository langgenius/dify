from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from dify_graph.entities.workflow_execution import (
    WorkflowExecution,
    WorkflowRunRerunMetadata,
    WorkflowRunRerunScope,
)
from dify_graph.enums import WorkflowExecutionStatus, WorkflowType
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from extensions.logstore.repositories.logstore_workflow_execution_repository import LogstoreWorkflowExecutionRepository
from models.enums import WorkflowRunTriggeredFrom
from models.model import EndUser


def test_to_logstore_model_includes_rerun_metadata_fields() -> None:
    user = EndUser()
    user.id = "user_1"
    user.tenant_id = "tenant_1"
    module_path = "extensions.logstore.repositories.logstore_workflow_execution_repository"

    with (
        patch(f"{module_path}.AliyunLogStore"),
        patch(f"{module_path}.SQLAlchemyWorkflowExecutionRepository"),
    ):
        repository = LogstoreWorkflowExecutionRepository(
            session_factory=MagicMock(),
            user=user,
            app_id="app_1",
            triggered_from=WorkflowRunTriggeredFrom.RERUN,
        )

    execution = WorkflowExecution(
        id_="run_2",
        workflow_id="wf_1",
        workflow_version="v1",
        workflow_type=WorkflowType.WORKFLOW,
        graph={"nodes": [], "edges": []},
        inputs={},
        outputs={},
        status=WorkflowExecutionStatus.SUCCEEDED,
        started_at=datetime(2026, 3, 1, tzinfo=UTC),
        finished_at=datetime(2026, 3, 1, 0, 0, 1, tzinfo=UTC),
        rerun_metadata=WorkflowRunRerunMetadata(
            rerun_from_workflow_run_id="run_1",
            rerun_from_node_id="node_1",
            rerun_overrides=[{"selector": ["n1", "o1"], "value": "patched"}],
            rerun_scope=WorkflowRunRerunScope(
                target_node_id="node_1",
                ancestor_node_ids=["n1"],
                rerun_node_ids=["node_1", "node_2"],
                overrideable_node_ids=["n1"],
            ),
            rerun_chain_root_workflow_run_id="root_1",
            rerun_kind="manual-node-rerun",
        ),
    )

    model_dict = dict(repository._to_logstore_model(execution))
    assert model_dict["rerun_from_workflow_run_id"] == "run_1"
    assert model_dict["rerun_from_node_id"] == "node_1"
    assert json.loads(model_dict["rerun_overrides"])[0]["selector"] == ["n1", "o1"]
    assert json.loads(model_dict["rerun_scope"])["target_node_id"] == "node_1"
    assert model_dict["rerun_chain_root_workflow_run_id"] == "root_1"
    assert model_dict["rerun_kind"] == "manual-node-rerun"


def test_logstore_rerun_metadata_round_trip_keeps_chain_root() -> None:
    user = EndUser()
    user.id = "user_1"
    user.tenant_id = "tenant_1"
    module_path = "extensions.logstore.repositories.logstore_workflow_execution_repository"

    with (
        patch(f"{module_path}.AliyunLogStore"),
        patch(f"{module_path}.SQLAlchemyWorkflowExecutionRepository"),
    ):
        repository = LogstoreWorkflowExecutionRepository(
            session_factory=MagicMock(),
            user=user,
            app_id="app_1",
            triggered_from=WorkflowRunTriggeredFrom.RERUN,
        )

    execution = WorkflowExecution(
        id_="run_3",
        workflow_id="wf_1",
        workflow_version="v1",
        workflow_type=WorkflowType.WORKFLOW,
        graph={"nodes": [], "edges": []},
        inputs={},
        outputs={},
        status=WorkflowExecutionStatus.SUCCEEDED,
        started_at=datetime(2026, 3, 1, tzinfo=UTC),
        finished_at=datetime(2026, 3, 1, 0, 0, 1, tzinfo=UTC),
        rerun_metadata=WorkflowRunRerunMetadata(
            rerun_from_workflow_run_id="run_2",
            rerun_from_node_id="node_2",
            rerun_overrides=[],
            rerun_scope=WorkflowRunRerunScope(
                target_node_id="node_2",
                ancestor_node_ids=["node_1"],
                rerun_node_ids=["node_2", "node_3"],
                overrideable_node_ids=["node_1"],
            ),
            rerun_chain_root_workflow_run_id="root_1",
            rerun_kind="manual-node-rerun",
        ),
    )

    log_dict = dict(repository._to_logstore_model(execution))
    workflow_run = _dict_to_workflow_run(log_dict)

    assert workflow_run.rerun_from_workflow_run_id == "run_2"
    assert workflow_run.rerun_chain_root_workflow_run_id == "root_1"
    assert workflow_run.rerun_kind == "manual-node-rerun"
