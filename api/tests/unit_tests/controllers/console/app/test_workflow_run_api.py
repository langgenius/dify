from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from flask import Flask
from flask_restx import marshal

from controllers.console.app import workflow_run as workflow_run_module


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _serialize_200_response(handler, payload: Any) -> Any:
    response_doc = getattr(handler, "__apidoc__", {}).get("responses", {}).get("200")
    if response_doc is None:
        return payload

    response_model = response_doc[1]
    if isinstance(response_model, dict):
        return marshal(payload, response_model)
    return payload


def _account() -> SimpleNamespace:
    return SimpleNamespace(id="account-1", name="Alice", email="alice@example.com")


def _workflow_run_summary(**overrides) -> SimpleNamespace:
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    payload = {
        "id": "run-1",
        "version": "v1",
        "status": "succeeded",
        "elapsed_time": 1.5,
        "total_tokens": 10,
        "total_steps": 2,
        "created_by_account": _account(),
        "created_at": created_at,
        "finished_at": created_at,
        "exceptions_count": 0,
        "retry_index": 0,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def _workflow_run_node_execution(**overrides) -> SimpleNamespace:
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    payload = {
        "id": "node-exec-1",
        "index": 1,
        "predecessor_node_id": None,
        "node_id": "node-1",
        "node_type": "start",
        "title": "Start",
        "inputs_dict": {"query": "hello"},
        "process_data_dict": {"step": "prepared"},
        "outputs_dict": {"answer": "world"},
        "status": "succeeded",
        "error": None,
        "elapsed_time": 1.0,
        "execution_metadata_dict": {"total_tokens": 3},
        "extras": {},
        "created_at": created_at,
        "created_by_role": "account",
        "created_by_account": _account(),
        "created_by_end_user": None,
        "finished_at": created_at,
        "inputs_truncated": False,
        "outputs_truncated": False,
        "process_data_truncated": False,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def test_workflow_run_list_returns_frontend_history_contract(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    class WorkflowRunService:
        def get_paginate_workflow_runs(self, **_kwargs):
            return {
                "limit": 10,
                "has_more": False,
                "data": [_workflow_run_summary()],
            }

    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", WorkflowRunService)

    api = workflow_run_module.WorkflowRunListApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs?limit=10", method="GET"):
        payload = handler(api, app_model=SimpleNamespace(id="app-1", tenant_id="tenant-1"))

    response = _serialize_200_response(api.get, payload)

    assert response["limit"] == 10
    assert response["has_more"] is False
    assert response["data"][0] == {
        "id": "run-1",
        "version": "v1",
        "status": "succeeded",
        "elapsed_time": 1.5,
        "total_tokens": 10,
        "total_steps": 2,
        "created_by_account": {"id": "account-1", "name": "Alice", "email": "alice@example.com"},
        "created_at": 1767323045,
        "finished_at": 1767323045,
        "exceptions_count": 0,
        "retry_index": 0,
    }


def test_advanced_chat_workflow_run_list_keeps_message_fields(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    class WorkflowRunService:
        def get_paginate_advanced_chat_workflow_runs(self, **_kwargs):
            return {
                "limit": 1,
                "has_more": True,
                "data": [
                    _workflow_run_summary(
                        conversation_id="conversation-1",
                        message_id="message-1",
                    )
                ],
            }

    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", WorkflowRunService)

    api = workflow_run_module.AdvancedChatAppWorkflowRunListApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/apps/app-1/advanced-chat/workflow-runs?limit=1", method="GET"):
        payload = handler(api, app_model=SimpleNamespace(id="app-1", tenant_id="tenant-1"))

    response = _serialize_200_response(api.get, payload)

    assert response["data"][0]["conversation_id"] == "conversation-1"
    assert response["data"][0]["message_id"] == "message-1"


def test_workflow_run_detail_returns_frontend_detail_contract(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    workflow_run = SimpleNamespace(
        id="run-1",
        version="v1",
        graph_dict={"nodes": []},
        inputs_dict={"query": "hello"},
        status="succeeded",
        outputs_dict={"answer": "world"},
        error=None,
        elapsed_time=1.5,
        total_tokens=10,
        total_steps=2,
        created_by_role="account",
        created_by_account=_account(),
        created_by_end_user=None,
        created_at=created_at,
        finished_at=created_at,
        exceptions_count=0,
    )

    class WorkflowRunService:
        def get_workflow_run(self, **_kwargs):
            return workflow_run

    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", WorkflowRunService)

    api = workflow_run_module.WorkflowRunDetailApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs/run-1", method="GET"):
        payload = handler(api, app_model=SimpleNamespace(id="app-1", tenant_id="tenant-1"), run_id="run-1")

    response = _serialize_200_response(api.get, payload)

    assert response == {
        "id": "run-1",
        "version": "v1",
        "graph": {"nodes": []},
        "inputs": {"query": "hello"},
        "status": "succeeded",
        "outputs": {"answer": "world"},
        "error": None,
        "elapsed_time": 1.5,
        "total_tokens": 10,
        "total_steps": 2,
        "created_by_role": "account",
        "created_by_account": {"id": "account-1", "name": "Alice", "email": "alice@example.com"},
        "created_by_end_user": None,
        "created_at": 1767323045,
        "finished_at": 1767323045,
        "exceptions_count": 0,
    }


def test_workflow_run_node_executions_return_frontend_trace_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    class WorkflowRunService:
        def get_workflow_run_node_executions(self, **_kwargs):
            return [_workflow_run_node_execution()]

    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", WorkflowRunService)
    monkeypatch.setattr(workflow_run_module, "current_user", SimpleNamespace(id="account-1"))

    api = workflow_run_module.WorkflowRunNodeExecutionListApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs/run-1/node-executions", method="GET"):
        payload = handler(api, app_model=SimpleNamespace(id="app-1", tenant_id="tenant-1"), run_id="run-1")

    response = _serialize_200_response(api.get, payload)

    assert response == {
        "data": [
            {
                "id": "node-exec-1",
                "index": 1,
                "predecessor_node_id": None,
                "node_id": "node-1",
                "node_type": "start",
                "title": "Start",
                "inputs": {"query": "hello"},
                "process_data": {"step": "prepared"},
                "outputs": {"answer": "world"},
                "status": "succeeded",
                "error": None,
                "elapsed_time": 1.0,
                "execution_metadata": {"total_tokens": 3},
                "extras": {},
                "created_at": 1767323045,
                "created_by_role": "account",
                "created_by_account": {"id": "account-1", "name": "Alice", "email": "alice@example.com"},
                "created_by_end_user": None,
                "finished_at": 1767323045,
                "inputs_truncated": False,
                "outputs_truncated": False,
                "process_data_truncated": False,
            }
        ]
    }
