"""Workspace admission composes existing checks before controller execution."""

from collections.abc import Callable
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.console import flask_admission, wraps
from controllers.console.error import NotInitValidateError, NotSetupError
from controllers.console.notification import NotificationApi
from controllers.console.workspace.error import AccountNotInitializedError
from controllers.console.workspace.workspace import WorkspacePermissionApi
from enums import DeploymentEdition
from libs import login as login_adapter
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus
from services.entities.feature_entities import FeatureModel


def test_admin_key_admits_without_account_login(app: Flask, config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, ADMIN_API_KEY="admin")

    class Handler:
        @flask_admission.console_admin_admission
        def get(self, *, page: int) -> int:
            return page

    with app.test_request_context(headers={"Authorization": "Bearer admin"}):
        assert Handler().get(page=2) == 2
    with app.test_request_context(), pytest.raises(Unauthorized):
        Handler().get(page=2)


@pytest.mark.parametrize(
    ("edition", "enabled", "allowed"),
    [
        (DeploymentEdition.CLOUD, True, True),
        (DeploymentEdition.CLOUD, False, False),
        (DeploymentEdition.COMMUNITY, False, True),
    ],
)
def test_custom_brand_billing_admission(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    enabled: bool,
    allowed: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    monkeypatch.setattr(flask_admission, "setup_required", lambda view: view)
    monkeypatch.setattr(flask_admission, "login_required", lambda view: view)
    monkeypatch.setattr(flask_admission, "account_initialization_required", lambda view: view)
    account = Account(name="User", email="user@example.com")
    identity = AccountWithTenant(account, "workspace")
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    features = Mock(return_value=FeatureModel(can_replace_logo=enabled))
    monkeypatch.setattr(wraps.FeatureService, "get_features", features)
    reached = []

    class Handler:
        @flask_admission.console_account_admission(billing_resource="workspace_custom")
        def post(self, context: RequestContext) -> RequestContext:
            reached.append(context)
            return context

    with app.test_request_context():
        if allowed:
            context = Handler().post()
            assert isinstance(context, RequestContext)
            assert context.active_workspace_id == "workspace"
        else:
            with pytest.raises(Forbidden):
                Handler().post()
    assert bool(reached) is allowed
    assert features.call_count == int(edition == DeploymentEdition.CLOUD)


@pytest.mark.parametrize("controller_type", [WorkspacePermissionApi, NotificationApi])
@pytest.mark.parametrize(
    ("setup_complete", "init_password", "status", "error"),
    [
        (False, "", None, NotSetupError),
        (False, "initial-password", None, NotInitValidateError),
        (True, "", None, Unauthorized),
        (True, "", AccountStatus.UNINITIALIZED, AccountNotInitializedError),
        (True, "", AccountStatus.ACTIVE, NotFound),
    ],
)
def test_account_admission_checks_identity_before_edition(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    controller_type: type[WorkspacePermissionApi] | type[NotificationApi],
    setup_complete: bool,
    init_password: str,
    status: AccountStatus | None,
    error: type[Exception],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD=init_password, LOGIN_DISABLED=False)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: setup_complete)
    account = Account(name="User", email="user@example.com", status=status or AccountStatus.ACTIVE)
    identity = Mock(return_value=account, side_effect=Unauthorized() if status is None else None)
    monkeypatch.setattr(login_adapter, "_resolve_current_user", identity)
    monkeypatch.setattr(login_adapter, "check_csrf_token", Mock())
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))

    with app.test_request_context(), pytest.raises(error):
        controller_type().get()

    assert identity.call_count == int(setup_complete)
