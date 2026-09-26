"""Internal workspace transport behavior and admission."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from inspect import unwrap
from unittest.mock import Mock

import pytest
from flask import Flask
from flask.typing import ResponseReturnValue
from flask_restx import Api, Resource
from werkzeug.exceptions import UnprocessableEntity

from controllers.inner_api.workspace import workspace as controller
from controllers.inner_api.wraps import InnerApiUnauthorizedError
from extensions.application_services.workspace import WorkspaceServices
from libs.external_api import register_external_error_handlers
from services.account_errors import AccountNotFoundError
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkspaceNotFoundError,
    WorkspaceOwnerNotFoundError,
    WorkspacesLimitExceededError,
)
from services.workspace.contracts import CreatedWorkspace, WorkspaceMembership
from services.workspace.provisioning_service import WorkspaceProvisioningService
from services.workspace.service import WorkspaceQueryService, WorkspaceService


@dataclass
class Services:
    workspaces: WorkspaceServices


@pytest.fixture
def provisioning(monkeypatch: pytest.MonkeyPatch) -> Mock:
    provisioning = Mock(spec=WorkspaceProvisioningService)
    services = WorkspaceServices(
        queries=Mock(spec=WorkspaceQueryService),
        management=Mock(spec=WorkspaceService),
        provisioning=provisioning,
        members=Mock(),
        member_queries=Mock(),
        owner_transfer=Mock(),
        invitations=Mock(),
        identity=Mock(),
    )
    monkeypatch.setattr(controller, "application_services", lambda: Services(services))
    return provisioning


@pytest.mark.parametrize(
    ("resource", "payload", "ownerless"),
    [
        (controller.EnterpriseWorkspace, {"name": "Test", "owner_email": "owner@example.com"}, False),
        (controller.EnterpriseWorkspaceNoOwnerEmail, {"name": "Test"}, True),
    ],
)
def test_create_serialization(
    app: Flask,
    provisioning: Mock,
    resource: type[
        controller.EnterpriseWorkspace
        | controller.EnterpriseWorkspaceNoOwnerEmail
        | controller.EnterpriseWorkspaceMember
    ],
    payload: dict[str, object],
    ownerless: bool,
) -> None:
    provisioning.create.return_value = CreatedWorkspace(
        "w1", "Test", "sandbox", "normal", datetime(2026, 1, 1), None, "public-key", {"remove_webapp_brand": True}
    )
    with app.test_request_context(method="POST", json=payload):
        body = unwrap(resource.post)(resource())
    assert body["message"] == "enterprise workspace created."
    assert body["tenant"]["created_at"] == "2026-01-01T00:00:00Z"
    assert body["tenant"]["updated_at"] is None
    if ownerless:
        provisioning.create.assert_called_once_with(name="Test")
        assert body["tenant"]["encrypt_public_key"] == "public-key"
        assert body["tenant"]["custom_config"] == {"remove_webapp_brand": True}
    else:
        provisioning.create.assert_called_once_with(name="Test", owner_email="owner@example.com")
        assert "encrypt_public_key" not in body["tenant"]
        assert "custom_config" not in body["tenant"]


def test_owner_missing(app: Flask, provisioning: Mock) -> None:
    provisioning.create.side_effect = WorkspaceOwnerNotFoundError()
    with app.test_request_context(method="POST", json={"name": "Test", "owner_email": "absent@example.com"}):
        result = unwrap(controller.EnterpriseWorkspace.post)(controller.EnterpriseWorkspace())
    assert result == ({"message": "owner account not found."}, 404)


def test_workspace_limit_remains_a_client_error(provisioning: Mock) -> None:
    provisioning.create.side_effect = WorkspacesLimitExceededError("Workspace limit reached")
    http_app = Flask(__name__)
    http_api = Api(http_app, doc=False)
    register_external_error_handlers(http_api)

    class Endpoint(Resource):
        def post(self) -> ResponseReturnValue:
            return unwrap(controller.EnterpriseWorkspace.post)(controller.EnterpriseWorkspace())

    http_api.add_resource(Endpoint, "/workspaces")
    response = http_app.test_client().post("/workspaces", json={"name": "Test", "owner_email": "owner@example.com"})
    assert response.status_code == 400
    assert response.json == {"code": "invalid_param", "message": "Workspace limit reached", "status": 400}


MEMBER = {"workspace_id": "w1", "account_id": "a1", "email": "member@example.com", "current": True}


def test_join_member(app: Flask, provisioning: Mock) -> None:
    provisioning.join_member.return_value = WorkspaceMembership("w1", "a1", "normal")
    with app.test_request_context(method="POST", json=MEMBER):
        body = unwrap(controller.EnterpriseWorkspaceMember.post)(controller.EnterpriseWorkspaceMember())
    assert body["member"] == {"workspace_id": "w1", "account_id": "a1", "role": "normal"}
    provisioning.join_member.assert_called_once_with(
        workspace_id="w1", account_id="a1", email="member@example.com", role="normal", operator_account_id=None
    )


@pytest.mark.parametrize(
    ("error", "message", "status"),
    [
        (AccountNotFoundError(), "account not found.", 404),
        (WorkspaceNotFoundError(), "workspace not found.", 404),
        (InvalidWorkspaceMemberRoleError("invalid workspace member role."), "invalid workspace member role.", 400),
        (InvalidWorkspaceMemberRoleError("cannot join workspace as owner."), "cannot join workspace as owner.", 400),
    ],
)
def test_join_errors(app: Flask, provisioning: Mock, error: Exception, message: str, status: int) -> None:
    provisioning.join_member.side_effect = error
    with app.test_request_context(method="POST", json=MEMBER):
        result = unwrap(controller.EnterpriseWorkspaceMember.post)(controller.EnterpriseWorkspaceMember())
    assert result == ({"message": message}, status)


@pytest.mark.parametrize(
    "resource",
    [controller.EnterpriseWorkspace, controller.EnterpriseWorkspaceNoOwnerEmail, controller.EnterpriseWorkspaceMember],
)
def test_invalid_payload_after_admission(
    app: Flask,
    provisioning: Mock,
    config_overrides: Callable[..., None],
    resource: type[
        controller.EnterpriseWorkspace
        | controller.EnterpriseWorkspaceNoOwnerEmail
        | controller.EnterpriseWorkspaceMember
    ],
) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="secret", DEPLOYMENT_EDITION="CLOUD")
    with app.test_request_context(method="POST", json={}, headers={"X-Inner-Api-Key": "secret"}):
        with pytest.raises(UnprocessableEntity):
            resource().post()
    provisioning.create.assert_not_called()
    provisioning.join_member.assert_not_called()


def test_inner_api_auth_precedes_payload_parsing(
    app: Flask, provisioning: Mock, config_overrides: Callable[..., None]
) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="secret", DEPLOYMENT_EDITION="CLOUD")
    with app.test_request_context(method="POST", json={}):
        with pytest.raises(InnerApiUnauthorizedError):
            controller.EnterpriseWorkspace().post()
    provisioning.create.assert_not_called()


def test_admitted_request_delegates_to_service(
    app: Flask, provisioning: Mock, config_overrides: Callable[..., None]
) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="secret", DEPLOYMENT_EDITION="CLOUD")
    provisioning.create.return_value = CreatedWorkspace("w", "Test", "sandbox", "normal", None, None, None, {})
    with app.test_request_context(method="POST", json={"name": "Test"}, headers={"X-Inner-Api-Key": "secret"}):
        controller.EnterpriseWorkspaceNoOwnerEmail().post()
    provisioning.create.assert_called_once_with(name="Test")
