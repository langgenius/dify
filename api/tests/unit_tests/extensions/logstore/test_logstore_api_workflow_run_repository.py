from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from extensions.logstore.repositories.logstore_api_workflow_run_repository import (
    LogstoreAPIWorkflowRunRepository,
    _dict_to_workflow_run,
)
from models.enums import WorkflowRunTriggeredFrom


def _new_repository() -> tuple[LogstoreAPIWorkflowRunRepository, MagicMock]:
    with patch("extensions.logstore.repositories.logstore_api_workflow_run_repository.AliyunLogStore") as mock_logstore:
        client = MagicMock()
        mock_logstore.return_value = client
        return LogstoreAPIWorkflowRunRepository(), client


def test_get_workflow_runs_count_supports_multiple_triggered_from_values() -> None:
    repository, logstore_client = _new_repository()
    logstore_client.execute_sql.side_effect = [
        [
            {"status": "succeeded", "count": 3},
            {"status": "failed", "count": 1},
        ],
        [{"count": 2}],
    ]

    result = repository.get_workflow_runs_count(
        tenant_id="tenant_1",
        app_id="app_1",
        triggered_from=[WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.RERUN],
    )

    assert result == {
        "total": 6,
        "running": 2,
        "succeeded": 3,
        "failed": 1,
        "stopped": 0,
        "partial-succeeded": 0,
    }
    assert logstore_client.execute_sql.call_count == 2

    sql_statements = [call.kwargs["sql"] for call in logstore_client.execute_sql.call_args_list]
    expected_filter = "(triggered_from='debugging' OR triggered_from='rerun')"
    assert all(expected_filter in sql for sql in sql_statements)


def test_get_workflow_runs_count_supports_single_triggered_from_value() -> None:
    repository, logstore_client = _new_repository()
    logstore_client.execute_sql.return_value = [{"count": 5}]

    result = repository.get_workflow_runs_count(
        tenant_id="tenant_1",
        app_id="app_1",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        status="succeeded",
    )

    assert result == {
        "total": 5,
        "running": 0,
        "succeeded": 5,
        "failed": 0,
        "stopped": 0,
        "partial-succeeded": 0,
    }
    sql_statement = logstore_client.execute_sql.call_args.kwargs["sql"]
    assert "AND (triggered_from='debugging')" in sql_statement


def test_get_workflow_runs_by_ids_batches_lookup() -> None:
    repository, logstore_client = _new_repository()
    logstore_client.execute_sql.return_value = [
        {
            "id": "run_1",
            "tenant_id": "tenant_1",
            "app_id": "app_1",
            "workflow_id": "wf_1",
            "type": "workflow",
            "triggered_from": "rerun",
            "version": "v1",
            "status": "succeeded",
            "created_by_role": "account",
            "created_by": "user_1",
        },
        {
            "id": "run_2",
            "tenant_id": "tenant_1",
            "app_id": "app_1",
            "workflow_id": "wf_1",
            "type": "workflow",
            "triggered_from": "rerun",
            "version": "v1",
            "status": "failed",
            "created_by_role": "account",
            "created_by": "user_1",
        },
    ]

    result = repository.get_workflow_runs_by_ids(
        tenant_id="tenant_1",
        app_id="app_1",
        run_ids=["run_1", "run_2", "run_1"],
    )

    assert [run.id for run in result] == ["run_1", "run_2"]
    sql_statement = logstore_client.execute_sql.call_args.kwargs["sql"]
    assert "ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC)" in sql_statement
    assert "id = 'run_1'" in sql_statement
    assert "id = 'run_2'" in sql_statement


def test_dict_to_workflow_run_maps_rerun_fields() -> None:
    workflow_run = _dict_to_workflow_run(
        {
            "id": "run_2",
            "tenant_id": "tenant_1",
            "app_id": "app_1",
            "workflow_id": "wf_1",
            "type": "workflow",
            "triggered_from": "rerun",
            "version": "2026-03-01",
            "status": "succeeded",
            "created_by_role": "account",
            "created_by": "user_1",
            "started_at": "2026-03-01T00:00:00",
            "finished_at": "2026-03-01T00:00:01",
            "rerun_from_workflow_run_id": "run_1",
            "rerun_from_node_id": "node_1",
            "rerun_overrides": [{"selector": ["n1", "o1"], "value": "v1"}],
            "rerun_scope": {
                "target_node_id": "node_1",
                "ancestor_node_ids": ["n1"],
                "rerun_node_ids": ["node_1", "node_2"],
                "overrideable_node_ids": ["n1"],
            },
            "rerun_chain_root_workflow_run_id": "root_1",
            "rerun_kind": "manual-node-rerun",
        }
    )

    assert workflow_run.rerun_from_workflow_run_id == "run_1"
    assert workflow_run.rerun_from_node_id == "node_1"
    assert json.loads(workflow_run.rerun_overrides or "[]")[0]["selector"] == ["n1", "o1"]
    assert json.loads(workflow_run.rerun_scope or "{}")["target_node_id"] == "node_1"
    assert workflow_run.rerun_chain_root_workflow_run_id == "root_1"
    assert workflow_run.rerun_kind == "manual-node-rerun"
