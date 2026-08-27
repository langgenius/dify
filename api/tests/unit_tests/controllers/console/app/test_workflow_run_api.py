from __future__ import annotations

import json
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest
from flask import Flask
from flask_restx import marshal
from sqlalchemy.orm import Session

from controllers.common.errors import NotFoundError
from controllers.console.app import workflow_run as workflow_run_module
from extensions.ext_database import db
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from machinery.context import RequestContext
from models import Account, App, AppMode
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import IconType
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)


def _serialize_200_response(handler, payload: Any) -> Any:
    response_doc = getattr(handler, "__apidoc__", {}).get("responses", {}).get("200")
    if response_doc is None:
        return payload

    response_model = response_doc[1]
    if isinstance(response_model, dict):
        return marshal(payload, response_model)
    return payload


def _account(session: Session) -> Account:
    account = Account(name="Alice", email="alice@example.com")
    account.id = "account-1"
    session.add(account)
    session.commit()
    return account


def _app() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Workflow run app",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
    )


def _request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


def _mock_application_services(monkeypatch: pytest.MonkeyPatch, workflow_runs: Mock) -> None:
    monkeypatch.setattr(
        workflow_run_module,
        "application_services",
        lambda: SimpleNamespace(workflow_runs=workflow_runs),
    )


def _workflow_run_summary(session: Session, **overrides: object) -> WorkflowRun:
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    workflow_run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="v1",
        graph='{"nodes": []}',
        inputs='{"query": "hello"}',
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs='{"answer": "world"}',
        error=None,
        elapsed_time=1.5,
        total_tokens=10,
        total_steps=2,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=created_at,
        finished_at=created_at,
        exceptions_count=0,
    )
    for name, value in overrides.items():
        setattr(workflow_run, name, value)
    workflow_run.retry_index = 0
    session.add(workflow_run)
    session.commit()
    return workflow_run


def _workflow_run_node_execution(session: Session) -> WorkflowNodeExecutionModel:
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    execution = WorkflowNodeExecutionModel(
        id="node-exec-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="start",
        title="Start",
        agent_workspace_binding_id=None,
        inputs=json.dumps({"query": "hello"}),
        process_data=json.dumps({"step": "prepared"}),
        outputs=json.dumps({"answer": "world"}),
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=1.0,
        execution_metadata=json.dumps({"total_tokens": 3}),
        created_at=created_at,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        finished_at=created_at,
    )
    execution.offload_data = []
    session.add(execution)
    session.commit()
    return execution


def test_workflow_run_list_returns_frontend_history_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _account(sqlite_session)
    workflow_run = _workflow_run_summary(sqlite_session)
    workflow_runs = Mock()
    workflow_runs.get_paginate_workflow_runs.return_value = {
        "limit": 10,
        "has_more": False,
        "data": [workflow_run],
    }
    _mock_application_services(monkeypatch, workflow_runs)
    monkeypatch.setattr(db, "session", sqlite_session)
    request_context = _request_context()

    api = workflow_run_module.WorkflowRunListApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs?limit=10", method="GET"):
        payload = handler(
            api,
            workflow_run_module.WorkflowRunListQuery(limit=10),
            request_context,
            app_model=_app(),
        )

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
    workflow_runs.get_paginate_workflow_runs.assert_called_once_with(
        request_context,
        app_id="app-1",
        args={"limit": 10},
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )


def test_advanced_chat_workflow_run_list_keeps_message_fields(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _account(sqlite_session)
    workflow_run = _workflow_run_summary(
        sqlite_session,
        conversation_id="conversation-1",
        message_id="message-1",
    )
    workflow_runs = Mock()
    workflow_runs.get_paginate_advanced_chat_workflow_runs.return_value = {
        "limit": 1,
        "has_more": True,
        "data": [workflow_run],
    }
    _mock_application_services(monkeypatch, workflow_runs)
    monkeypatch.setattr(db, "session", sqlite_session)
    request_context = _request_context()

    api = workflow_run_module.AdvancedChatAppWorkflowRunListApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/advanced-chat/workflow-runs?limit=1", method="GET"):
        payload = handler(
            api,
            workflow_run_module.WorkflowRunListQuery(limit=1),
            request_context,
            app_model=_app(),
        )

    response = _serialize_200_response(api.get, payload)

    assert response["data"][0]["conversation_id"] == "conversation-1"
    assert response["data"][0]["message_id"] == "message-1"
    workflow_runs.get_paginate_advanced_chat_workflow_runs.assert_called_once_with(
        request_context,
        app_id="app-1",
        args={"limit": 1},
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )


def test_workflow_run_count_passes_filters_to_application_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_runs = Mock()
    workflow_runs.get_workflow_runs_count.return_value = {
        "total": 2,
        "running": 0,
        "succeeded": 2,
        "failed": 0,
        "stopped": 0,
        "partial-succeeded": 0,
    }
    _mock_application_services(monkeypatch, workflow_runs)
    request_context = _request_context()
    query = workflow_run_module.WorkflowRunCountQuery(
        status="succeeded",
        time_range="7d",
        triggered_from="app-run",
    )

    api = workflow_run_module.WorkflowRunCountApi()
    handler = unwrap(api.get)
    with app.test_request_context("/apps/app-1/workflow-runs/count", method="GET"):
        payload = handler(api, query, request_context, app_model=_app())

    assert payload == {
        "total": 2,
        "running": 0,
        "succeeded": 2,
        "failed": 0,
        "stopped": 0,
        "partial_succeeded": 0,
    }
    workflow_runs.get_workflow_runs_count.assert_called_once_with(
        request_context,
        app_id="app-1",
        status="succeeded",
        time_range="7d",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )


def test_workflow_run_detail_returns_frontend_detail_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _account(sqlite_session)
    workflow_run = _workflow_run_summary(sqlite_session)
    workflow_runs = Mock()
    workflow_runs.get_workflow_run.return_value = workflow_run
    _mock_application_services(monkeypatch, workflow_runs)
    monkeypatch.setattr(db, "session", sqlite_session)
    request_context = _request_context()

    api = workflow_run_module.WorkflowRunDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs/run-1", method="GET"):
        payload = handler(api, request_context, app_model=_app(), run_id="run-1")

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
    workflow_runs.get_workflow_run.assert_called_once_with(
        request_context,
        app_id="app-1",
        run_id="run-1",
    )


def test_workflow_run_detail_maps_missing_run_to_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_runs = Mock()
    workflow_runs.get_workflow_run.return_value = None
    _mock_application_services(monkeypatch, workflow_runs)
    request_context = _request_context(workspace_id="tenant-2")
    api = workflow_run_module.WorkflowRunDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs/run-1", method="GET"):
        with pytest.raises(NotFoundError, match="Workflow run not found"):
            handler(api, request_context, app_model=_app(), run_id="run-1")

    workflow_runs.get_workflow_run.assert_called_once_with(
        request_context,
        app_id="app-1",
        run_id="run-1",
    )


def test_workflow_run_node_executions_return_frontend_trace_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _account(sqlite_session)
    execution = _workflow_run_node_execution(sqlite_session)
    workflow_runs = Mock()
    workflow_runs.get_workflow_run_node_executions.return_value = [execution]
    _mock_application_services(monkeypatch, workflow_runs)
    monkeypatch.setattr(db, "session", sqlite_session)
    request_context = _request_context()

    api = workflow_run_module.WorkflowRunNodeExecutionListApi()
    handler = unwrap(api.get)

    with app.test_request_context("/apps/app-1/workflow-runs/run-1/node-executions", method="GET"):
        payload = handler(api, request_context, app_model=_app(), run_id="run-1")

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
    workflow_runs.get_workflow_run_node_executions.assert_called_once_with(
        request_context,
        app_id="app-1",
        run_id="run-1",
    )
