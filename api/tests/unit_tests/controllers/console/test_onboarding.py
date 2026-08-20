from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from pydantic import ValidationError

from controllers.console.onboarding import StepByStepTourStateApi, StepByStepTourStatePatchPayload
from machinery.context import RequestContext
from services.entities.onboarding_entities import StepByStepTourPatch, StepByStepTourResult


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _state_result() -> StepByStepTourResult:
    return StepByStepTourResult(
        first_workspace_id="workspace-1",
        completed_task_ids=("home",),
        updated_at=datetime(2026, 6, 28, tzinfo=UTC),
    )


def test_get_step_by_step_tour_state_delegates_with_request_context() -> None:
    service = Mock()
    service.get_state.return_value = _state_result()
    services = SimpleNamespace(step_by_step_tour=service)
    api = StepByStepTourStateApi()
    method = unwrap(api.get)
    context = _request_context()

    with patch("controllers.console.onboarding.application_services", return_value=services):
        result = method(api, context)

    assert result == {
        "first_workspace_id": "workspace-1",
        "skipped": False,
        "completed_task_ids": ["home"],
        "manually_enabled_workspace_ids": [],
        "manually_disabled_workspace_ids": [],
        "updated_at": "2026-06-28T00:00:00Z",
    }
    service.get_state.assert_called_once_with(context)


def test_patch_step_by_step_tour_state_maps_transport_payload_to_command() -> None:
    service = Mock()
    service.patch_state.return_value = _state_result()
    services = SimpleNamespace(step_by_step_tour=service)
    api = StepByStepTourStateApi()
    method = unwrap(api.patch)
    context = _request_context()
    payload = StepByStepTourStatePatchPayload.model_validate({"action": "complete_task", "task_id": "studio"})

    with patch("controllers.console.onboarding.application_services", return_value=services):
        result = method(api, payload, context)

    assert result["completed_task_ids"] == ["home"]
    service.patch_state.assert_called_once_with(
        context,
        StepByStepTourPatch(action="complete_task", task_id="studio"),
    )


def test_patch_payload_rejects_non_action_fields() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        StepByStepTourStatePatchPayload.model_validate({"action": "skip", "skipped": True})


def test_patch_payload_rejects_task_id_without_task_action() -> None:
    with pytest.raises(ValidationError, match="task_id is only supported for task actions"):
        StepByStepTourStatePatchPayload.model_validate({"action": "skip", "task_id": "home"})


def test_patch_payload_requires_action() -> None:
    with pytest.raises(ValidationError):
        StepByStepTourStatePatchPayload.model_validate({"task_id": "home"})
