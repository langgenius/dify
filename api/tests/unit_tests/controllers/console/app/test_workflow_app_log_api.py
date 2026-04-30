from __future__ import annotations

from datetime import UTC, datetime

from controllers.console.app import workflow_app_log as workflow_app_log_module
from graphon.enums import WorkflowExecutionStatus


def test_workflow_app_log_query_parses_bool_and_datetime():
    query = workflow_app_log_module.WorkflowAppLogQuery.model_validate(
        {
            "detail": "true",
            "created_at__before": "2026-01-02T03:04:05Z",
            "page": "2",
            "limit": "10",
        }
    )

    assert query.detail is True
    assert query.created_at__before == datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    assert query.page == 2
    assert query.limit == 10


def test_workflow_app_log_pagination_response_normalizes_nested_fields():
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    response = workflow_app_log_module.WorkflowAppLogPaginationResponse.model_validate(
        {
            "page": 1,
            "limit": 20,
            "total": 1,
            "has_more": False,
            "data": [
                {
                    "id": "log-1",
                    "workflow_run": {
                        "id": "run-1",
                        "status": WorkflowExecutionStatus.SUCCEEDED,
                        "created_at": created_at,
                        "finished_at": created_at,
                    },
                    "details": {"trigger_metadata": {}},
                    "evaluation": [
                        {
                            "name": "answer_correctness",
                            "value": 0.91,
                            "node_info": {
                                "node_id": "node-1",
                                "type": "llm",
                                "title": "Judge Node",
                            },
                        }
                    ],
                    "created_by_account": {"id": "acc-1", "name": "acc", "email": "acc@example.com"},
                    "created_at": created_at,
                }
            ],
        }
    ).model_dump(mode="json")

    assert response["data"][0]["workflow_run"]["status"] == "succeeded"
    assert response["data"][0]["workflow_run"]["created_at"] == int(created_at.timestamp())
    assert response["data"][0]["created_at"] == int(created_at.timestamp())
    assert response["data"][0]["evaluation"][0]["name"] == "answer_correctness"
    assert response["data"][0]["evaluation"][0]["nodeInfo"]["node_id"] == "node-1"


def test_workflow_app_log_pagination_response_normalizes_null_evaluation_to_empty_list():
    response = workflow_app_log_module.WorkflowAppLogPaginationResponse.model_validate(
        {
            "page": 1,
            "limit": 20,
            "total": 1,
            "has_more": False,
            "data": [
                {
                    "id": "log-1",
                    "evaluation": None,
                }
            ],
        }
    ).model_dump(mode="json")

    assert response["data"][0]["evaluation"] == []


def test_workflow_archived_log_pagination_response_normalizes_nested_fields():
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    response = workflow_app_log_module.WorkflowArchivedLogPaginationResponse.model_validate(
        {
            "page": 1,
            "limit": 20,
            "total": 1,
            "has_more": False,
            "data": [
                {
                    "id": "archived-1",
                    "workflow_run": {
                        "id": "run-1",
                        "status": WorkflowExecutionStatus.FAILED,
                    },
                    "trigger_metadata": {"type": "trigger-plugin"},
                    "created_by_end_user": {
                        "id": "eu-1",
                        "type": "anonymous",
                        "is_anonymous": True,
                        "session_id": "session-1",
                    },
                    "created_at": created_at,
                }
            ],
        }
    ).model_dump(mode="json")

    assert response["data"][0]["workflow_run"]["status"] == "failed"
    assert response["data"][0]["created_at"] == int(created_at.timestamp())
