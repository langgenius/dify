from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import Mock, PropertyMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console import console_ns
from controllers.console.onboarding import (
    StepByStepTourStateApi,
    StepByStepTourStatePatchPayload,
)
from extensions.ext_database import db
from models.account import Account, AccountStatus
from services.step_by_step_tour_service import StepByStepTourService


def _account() -> Account:
    account = Account(name="User", email="user@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    return account


def _state_response() -> dict[str, object]:
    return {
        "first_workspace_id": "workspace-1",
        "skipped": False,
        "completed_task_ids": ["home"],
        "manually_enabled_workspace_ids": [],
        "manually_disabled_workspace_ids": [],
        "updated_at": datetime(2026, 6, 28, tzinfo=UTC),
    }


def test_get_step_by_step_tour_state(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    get_state = Mock(return_value=_state_response())
    monkeypatch.setattr(StepByStepTourService, "get_state", get_state)

    api = StepByStepTourStateApi()
    method = unwrap(api.get)

    with app.test_request_context("/console/api/onboarding/step-by-step-tour/state", method="GET"):
        result = method(api, "workspace-1", _account())

    assert result == {
        "first_workspace_id": "workspace-1",
        "skipped": False,
        "completed_task_ids": ["home"],
        "manually_enabled_workspace_ids": [],
        "manually_disabled_workspace_ids": [],
        "updated_at": "2026-06-28T00:00:00Z",
    }
    get_state.assert_called_once()
    assert get_state.call_args.kwargs["current_tenant_id"] == "workspace-1"
    assert get_state.call_args.kwargs["session"] is db.session


def test_patch_step_by_step_tour_state_passes_action_payload(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_state = Mock(return_value=_state_response())
    monkeypatch.setattr(StepByStepTourService, "patch_state", patch_state)

    api = StepByStepTourStateApi()
    method = unwrap(api.patch)
    payload = {"action": "complete_task", "task_id": "studio"}

    with app.test_request_context(
        "/console/api/onboarding/step-by-step-tour/state",
        method="PATCH",
        json=payload,
    ):
        with patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload):
            result = method(api, "workspace-1", _account())

    assert result["completed_task_ids"] == ["home"]
    patch_state.assert_called_once()
    assert patch_state.call_args.kwargs["current_tenant_id"] == "workspace-1"
    assert patch_state.call_args.kwargs["patch"] == payload
    assert patch_state.call_args.kwargs["session"] is db.session


def test_patch_payload_rejects_non_action_fields() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        StepByStepTourStatePatchPayload.model_validate({"action": "skip", "skipped": True})


def test_patch_payload_rejects_task_id_without_task_action() -> None:
    with pytest.raises(ValidationError, match="task_id is only supported for task actions"):
        StepByStepTourStatePatchPayload.model_validate({"action": "skip", "task_id": "home"})


def test_patch_payload_requires_action() -> None:
    with pytest.raises(ValidationError):
        StepByStepTourStatePatchPayload.model_validate({"task_id": "home"})
