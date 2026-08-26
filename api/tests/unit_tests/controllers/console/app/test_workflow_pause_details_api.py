"""Controller tests for Console workflow pause details."""

from __future__ import annotations

from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.common.errors import NotFoundError
from controllers.console.app import workflow_run as workflow_run_module
from machinery.context import RequestContext
from services.workflow_run_service import WorkflowRunPauseDetails, WorkflowRunPausedNode


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


def test_pause_details_returns_backstage_input_url(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com/")
    workflow_runs = Mock()
    workflow_runs.get_pause_details.return_value = WorkflowRunPauseDetails(
        paused_at=datetime(2024, 1, 1, 12, 0, 0),
        paused_nodes=(
            WorkflowRunPausedNode(
                node_id="node-1",
                node_title="Ask Name",
                form_id="form-1",
                form_token="backstage-token",
            ),
        ),
    )
    _mock_application_services(monkeypatch, workflow_runs)
    request_context = _request_context()

    api = workflow_run_module.ConsoleWorkflowPauseDetailsApi()
    handler = unwrap(api.get)
    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        response, status = handler(api, request_context, workflow_run_id="run-1")

    assert status == 200
    assert response == {
        "paused_at": "2024-01-01T12:00:00Z",
        "paused_nodes": [
            {
                "node_id": "node-1",
                "node_title": "Ask Name",
                "pause_type": {
                    "type": "human_input",
                    "form_id": "form-1",
                    "backstage_input_url": "https://web.example.com/form/backstage-token",
                },
            }
        ],
    }
    workflow_runs.get_pause_details.assert_called_once_with(
        request_context,
        workflow_run_id="run-1",
    )


def test_pause_details_maps_missing_or_inaccessible_run_to_not_found(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workflow_runs = Mock()
    workflow_runs.get_pause_details.return_value = None
    _mock_application_services(monkeypatch, workflow_runs)
    request_context = _request_context(workspace_id="other-tenant")
    api = workflow_run_module.ConsoleWorkflowPauseDetailsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        with pytest.raises(NotFoundError, match="Workflow run not found"):
            handler(api, request_context, workflow_run_id="run-1")

    workflow_runs.get_pause_details.assert_called_once_with(
        request_context,
        workflow_run_id="run-1",
    )


def test_pause_details_returns_empty_response_for_non_paused_run(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_runs = Mock()
    workflow_runs.get_pause_details.return_value = WorkflowRunPauseDetails(paused_at=None, paused_nodes=())
    _mock_application_services(monkeypatch, workflow_runs)

    api = workflow_run_module.ConsoleWorkflowPauseDetailsApi()
    handler = unwrap(api.get)
    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        response, status = handler(api, _request_context(), workflow_run_id="run-1")

    assert status == 200
    assert response == {"paused_at": None, "paused_nodes": []}


def test_pause_details_response_schema_is_registered() -> None:
    assert workflow_run_module.WorkflowPauseDetailsResponse.__name__ in workflow_run_module.console_ns.models
