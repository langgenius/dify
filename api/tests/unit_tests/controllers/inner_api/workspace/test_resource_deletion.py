from collections.abc import Callable
from inspect import unwrap
from unittest.mock import Mock
from uuid import UUID

import pytest
from flask import Flask

from controllers.inner_api.workspace import workspace as controller
from controllers.inner_api.wraps import InnerApiUnauthorizedError

WORKSPACE_ID = UUID("0dd1d570-cf7b-4bab-9c7f-84ebe6c36985")


def test_delete_calls_cleanup_with_the_workspace_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = Mock()
    monkeypatch.setattr(controller, "WorkspaceResourceCleanupService", service)
    with app.test_request_context(method="DELETE"):
        result = unwrap(controller.EnterpriseWorkspaceResourceDeletion.delete)(
            controller.EnterpriseWorkspaceResourceDeletion(), WORKSPACE_ID
        )
    assert result == ({"message": "workspace resource cleanup accepted."}, 202)
    service.cleanup.assert_called_once_with(str(WORKSPACE_ID))


def test_delete_requires_inner_api_key(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="secret", DEPLOYMENT_EDITION="CLOUD")
    service = Mock()
    monkeypatch.setattr(controller, "WorkspaceResourceCleanupService", service)
    with app.test_request_context(method="DELETE"):
        with pytest.raises(InnerApiUnauthorizedError):
            controller.EnterpriseWorkspaceResourceDeletion().delete(WORKSPACE_ID)
    service.cleanup.assert_not_called()


def test_cleanup_failure_does_not_return_accepted(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = Mock()
    service.cleanup.side_effect = RuntimeError("broker unavailable")
    monkeypatch.setattr(controller, "WorkspaceResourceCleanupService", service)
    with app.test_request_context(method="DELETE"), pytest.raises(RuntimeError, match="broker unavailable"):
        unwrap(controller.EnterpriseWorkspaceResourceDeletion.delete)(
            controller.EnterpriseWorkspaceResourceDeletion(), WORKSPACE_ID
        )
