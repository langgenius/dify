from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from models.enums import CreatorUserRole
from services import workflow_handoff_cancellation_service as module
from services.workflow_handoff_cancellation_service import (
    WORKFLOW_HANDOFF_CANCELLATION_RETENTION,
    WorkflowHandoffCancellationService,
)


def test_service_requests_cancel_by_task_id() -> None:
    repository = Mock()
    repository.request_cancel_by_task_id.return_value = 1
    requested_at = datetime(2026, 7, 28, 12, 0, 0)

    cancelled = WorkflowHandoffCancellationService(repository).request_by_task_id(
        task_id="task-1",
        requested_at=requested_at,
        reason="user requested stop",
        scope_tenant_id="tenant-1",
        scope_app_id="app-1",
    )

    assert cancelled == 1
    repository.request_cancel_by_task_id.assert_called_once_with(
        task_id="task-1",
        requested_at=requested_at,
        reason="user requested stop",
        scope_tenant_id="tenant-1",
        scope_app_id="app-1",
        scope_created_by_role=None,
        scope_created_by=None,
        expires_at=requested_at + WORKFLOW_HANDOFF_CANCELLATION_RETENTION,
    )


def test_controller_helper_drains_existing_handoffs_when_feature_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = Mock()
    repository.request_cancel_by_task_id.return_value = 1
    repository_type = Mock(return_value=repository)
    monkeypatch.setattr(module, "SQLAlchemyWorkflowRunHandoffRepository", repository_type)
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=Mock()))

    assert module.request_workflow_handoff_cancel_by_task_id("task-1") == 1
    repository_type.assert_called_once()
    repository.request_cancel_by_task_id.assert_called_once_with(
        task_id="task-1",
        requested_at=repository.request_cancel_by_task_id.call_args.kwargs["requested_at"],
        reason="workflow task cancellation requested",
        scope_tenant_id=None,
        scope_app_id=None,
        scope_created_by_role=None,
        scope_created_by=None,
        expires_at=repository.request_cancel_by_task_id.call_args.kwargs["requested_at"]
        + WORKFLOW_HANDOFF_CANCELLATION_RETENTION,
    )


def test_controller_helper_uses_explicit_timestamp(monkeypatch: pytest.MonkeyPatch) -> None:
    repository = Mock()
    repository.request_cancel_by_task_id.return_value = 1
    monkeypatch.setattr(module, "SQLAlchemyWorkflowRunHandoffRepository", Mock(return_value=repository))
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=Mock()))
    requested_at = datetime(2026, 7, 28, 12, 0, 0)

    cancelled = module.request_workflow_handoff_cancel_by_task_id(
        "task-1",
        reason="user requested stop",
        requested_at=requested_at,
        scope_tenant_id="tenant-1",
        scope_app_id="app-1",
    )

    assert cancelled == 1
    repository.request_cancel_by_task_id.assert_called_once_with(
        task_id="task-1",
        requested_at=requested_at,
        reason="user requested stop",
        scope_tenant_id="tenant-1",
        scope_app_id="app-1",
        scope_created_by_role=None,
        scope_created_by=None,
        expires_at=requested_at + WORKFLOW_HANDOFF_CANCELLATION_RETENTION,
    )


def test_public_owner_scope_rejects_app_without_tenant() -> None:
    service = WorkflowHandoffCancellationService(Mock())

    with pytest.raises(ValueError, match="scope_tenant_id"):
        service.request_by_task_id(
            task_id="task-1",
            requested_at=datetime(2026, 7, 28, 12, 0, 0),
            scope_app_id="app-1",
        )


def test_public_app_helper_forwards_mandatory_owner_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    scoped_cancel = Mock(return_value=1)
    monkeypatch.setattr(module, "request_workflow_handoff_cancel_by_task_id", scoped_cancel)
    requested_at = datetime(2026, 7, 28, 12, 0, 0)

    assert (
        module.request_workflow_handoff_cancel_for_app(
            "task-1",
            tenant_id="tenant-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
            reason="user requested stop",
            requested_at=requested_at,
        )
        == 1
    )
    scoped_cancel.assert_called_once_with(
        "task-1",
        reason="user requested stop",
        requested_at=requested_at,
        scope_tenant_id="tenant-1",
        scope_app_id="app-1",
        scope_created_by_role=CreatorUserRole.ACCOUNT,
        scope_created_by="account-1",
    )


@pytest.mark.parametrize(("tenant_id", "app_id"), [("", "app-1"), ("tenant-1", "")])
def test_public_app_helper_rejects_empty_owner_scope(tenant_id: str, app_id: str) -> None:
    with pytest.raises(ValueError, match="tenant_id and app_id"):
        module.request_workflow_handoff_cancel_for_app(
            "task-1",
            tenant_id=tenant_id,
            app_id=app_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )


def test_public_app_helper_rejects_empty_creator() -> None:
    with pytest.raises(ValueError, match="created_by must not be empty"):
        module.request_workflow_handoff_cancel_for_app(
            "task-1",
            tenant_id="tenant-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="",
        )
