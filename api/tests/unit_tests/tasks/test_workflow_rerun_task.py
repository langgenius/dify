from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App as AppModel
from models.model import AppMode, EndUser
from models.workflow import Workflow
from tasks.app_generate.workflow_rerun_task import _resolve_invoke_from, workflow_run_rerun_task


def _build_payload(*, user_role: str = "account") -> dict:
    return {
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_role": user_role,
        "task_id": "task-1",
        "workflow_run_id": "workflow-run-1",
        "target_node_id": "node-1",
        "user_inputs": {},
        "execution_graph_config": {"nodes": [], "edges": []},
        "rerun_metadata": {
            "rerun_from_workflow_run_id": "source-run-1",
            "rerun_from_node_id": "node-1",
            "rerun_overrides": [],
            "rerun_scope": {
                "target_node_id": "node-1",
                "ancestor_node_ids": [],
                "rerun_node_ids": ["node-1"],
                "overrideable_node_ids": [],
            },
            "rerun_chain_root_workflow_run_id": "source-run-1",
            "rerun_kind": "manual-node-rerun",
        },
        "graph_runtime_state_snapshot": "{}",
    }


def _setup_session_get(
    *,
    workflow: object | None,
    app: object | None,
    end_user: object | None,
) -> MagicMock:
    session = MagicMock()

    def _get(model, _id):
        if model is Workflow:
            return workflow
        if model is AppModel:
            return app
        if model is EndUser:
            return end_user
        return None

    session.get.side_effect = _get
    return session


def _extract_published_event(topic: MagicMock) -> dict:
    payload = topic.publish.call_args.args[0]
    assert isinstance(payload, bytes)
    return json.loads(payload.decode())


def test_rerun_task_publishes_terminal_event_when_workflow_missing() -> None:
    payload = _build_payload()
    mock_session = _setup_session_get(workflow=None, app=None, end_user=None)
    topic = MagicMock()

    with (
        patch("tasks.app_generate.workflow_rerun_task.db", SimpleNamespace(engine=object())),
        patch("tasks.app_generate.workflow_rerun_task.Session") as mock_session_cls,
        patch(
            "tasks.app_generate.workflow_rerun_task.MessageBasedAppGenerator.get_response_topic",
            return_value=topic,
        ),
    ):
        mock_session_cls.return_value.__enter__.return_value = mock_session
        workflow_run_rerun_task(json.dumps(payload))

    event = _extract_published_event(topic)
    assert event["event"] == "workflow_finished"
    assert event["workflow_run_id"] == payload["workflow_run_id"]
    assert event["data"]["status"] == "failed"
    assert event["data"]["error"] == "Workflow not found for rerun task."


def test_rerun_task_rejects_workflow_ownership_mismatch_with_terminal_event() -> None:
    payload = _build_payload()
    workflow = SimpleNamespace(
        id=payload["workflow_id"],
        app_id="another-app",
        tenant_id=payload["tenant_id"],
        created_by="owner-1",
        features_dict={},
    )
    mock_session = _setup_session_get(workflow=workflow, app=None, end_user=None)
    topic = MagicMock()

    with (
        patch("tasks.app_generate.workflow_rerun_task.db", SimpleNamespace(engine=object())),
        patch("tasks.app_generate.workflow_rerun_task.Session") as mock_session_cls,
        patch(
            "tasks.app_generate.workflow_rerun_task.MessageBasedAppGenerator.get_response_topic",
            return_value=topic,
        ),
        patch("tasks.app_generate.workflow_rerun_task.WorkflowAppGenerator.rerun") as mock_rerun,
    ):
        mock_session_cls.return_value.__enter__.return_value = mock_session
        workflow_run_rerun_task(json.dumps(payload))

    mock_rerun.assert_not_called()
    event = _extract_published_event(topic)
    assert event["event"] == "workflow_finished"
    assert event["data"]["status"] == "failed"
    assert event["data"]["error"] == "Workflow ownership mismatch for rerun task."


def test_rerun_task_publishes_terminal_event_on_runtime_exception() -> None:
    payload = _build_payload(user_role="end_user")
    workflow = SimpleNamespace(
        id=payload["workflow_id"],
        app_id=payload["app_id"],
        tenant_id=payload["tenant_id"],
        created_by="owner-1",
        features_dict={},
    )
    app_model = SimpleNamespace(
        id=payload["app_id"],
        tenant_id=payload["tenant_id"],
    )
    end_user = SimpleNamespace(
        id=payload["user_id"],
        tenant_id=payload["tenant_id"],
        session_id="session-1",
    )
    mock_session = _setup_session_get(workflow=workflow, app=app_model, end_user=end_user)
    topic = MagicMock()

    with (
        patch("tasks.app_generate.workflow_rerun_task.db", SimpleNamespace(engine=object())),
        patch("tasks.app_generate.workflow_rerun_task.Session") as mock_session_cls,
        patch(
            "tasks.app_generate.workflow_rerun_task.MessageBasedAppGenerator.get_response_topic",
            return_value=topic,
        ),
        patch(
            "tasks.app_generate.workflow_rerun_task.WorkflowAppConfigManager.get_app_config",
            side_effect=RuntimeError("boom"),
        ),
    ):
        mock_session_cls.return_value.__enter__.return_value = mock_session
        with pytest.raises(RuntimeError):
            workflow_run_rerun_task(json.dumps(payload))

    event = _extract_published_event(topic)
    assert event["event"] == "workflow_finished"
    assert event["task_id"] == payload["task_id"]
    assert event["workflow_run_id"] == payload["workflow_run_id"]
    assert event["data"]["status"] == "failed"
    assert event["data"]["error"] == "Rerun execution failed."


def test_failed_terminal_event_targets_workflow_topic() -> None:
    payload = _build_payload()
    mock_session = _setup_session_get(workflow=None, app=None, end_user=None)
    topic = MagicMock()

    with (
        patch("tasks.app_generate.workflow_rerun_task.db", SimpleNamespace(engine=object())),
        patch("tasks.app_generate.workflow_rerun_task.Session") as mock_session_cls,
        patch(
            "tasks.app_generate.workflow_rerun_task.MessageBasedAppGenerator.get_response_topic",
            return_value=topic,
        ) as mock_get_topic,
    ):
        mock_session_cls.return_value.__enter__.return_value = mock_session
        workflow_run_rerun_task(json.dumps(payload))

    mock_get_topic.assert_called_once_with(AppMode.WORKFLOW, payload["workflow_run_id"])


def test_rerun_task_publishes_terminal_event_for_invalid_payload_with_identifiers() -> None:
    payload = json.dumps(
        {
            "task_id": "task-1",
            "workflow_run_id": "workflow-run-1",
            "workflow_id": "workflow-1",
            # Missing required fields for WorkflowRunRerunTaskPayload validation.
        }
    )
    topic = MagicMock()

    with patch(
        "tasks.app_generate.workflow_rerun_task.MessageBasedAppGenerator.get_response_topic",
        return_value=topic,
    ):
        workflow_run_rerun_task(payload)

    event = _extract_published_event(topic)
    assert event["event"] == "workflow_finished"
    assert event["task_id"] == "task-1"
    assert event["workflow_run_id"] == "workflow-run-1"
    assert event["data"]["status"] == "failed"
    assert event["data"]["error"] == "Invalid rerun task payload."


def test_resolve_invoke_from_supports_end_user() -> None:
    assert _resolve_invoke_from("account") == InvokeFrom.DEBUGGER
    assert _resolve_invoke_from("end_user") == InvokeFrom.SERVICE_API
