"""App MCP Server routes retain their role and RBAC policy under unified admission."""

from collections.abc import Callable, Sequence
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.console import flask_admission
from controllers.console.app import mcp_server
from controllers.console.app.mcp_server import AppMCPServerController, AppMCPServerRefreshController
from controllers.console.wraps import RBACPermission
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app.mcp_server_service import AppMCPServerRecord, AppMCPServerStatus
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account

APP_ID = UUID("11111111-1111-1111-1111-111111111111")
RECORD = AppMCPServerRecord(
    id="server",
    name="name",
    server_code="code",
    description="description",
    status=AppMCPServerStatus.ACTIVE,
    parameters="{}",
    created_at=datetime(2024, 1, 1),
    updated_at=datetime(2024, 1, 1),
)
MUTATIONS = [
    AppMCPServerController.post,
    AppMCPServerController.put,
    AppMCPServerRefreshController.post,
]


def admission(method: Callable[..., object]) -> Callable[..., object]:
    return unwrap(method, stop=lambda view: "inject_request_context" in view.__code__.co_qualname)


@pytest.mark.parametrize("method", MUTATIONS)
@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_readonly_roles_cannot_mutate(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], role: TenantAccountRole
) -> None:
    account = make_account(role=role)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(method)(None, app_id=APP_ID)


@pytest.mark.parametrize(
    ("method", "permission"),
    [
        (AppMCPServerController.get, RBACPermission.APP_VIEW_LAYOUT),
        (AppMCPServerController.post, RBACPermission.APP_EDIT),
        (AppMCPServerController.put, RBACPermission.APP_EDIT),
        (AppMCPServerRefreshController.post, RBACPermission.APP_EDIT),
    ],
)
def test_rbac_checks_keep_app_scope(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], permission: RBACPermission
) -> None:
    account = make_account(role=TenantAccountRole.NORMAL)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    called = []

    def denied(*, tenant_id: str, account_id: str, checks: Sequence[RBACCheck], path_args: dict[str, object]) -> None:
        assert (tenant_id, account_id) == ("workspace", account.id)
        assert path_args == {"app_id": APP_ID}
        assert len(checks) == 1
        assert checks[0].scene == permission
        assert isinstance(checks[0].locator, PlainApp)
        called.append(True)
        raise Forbidden

    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(method)(None, app_id=APP_ID)
    assert called == [True]


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_edit_roles_reach_service_with_request_context(
    app: Flask, monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole
) -> None:
    account = make_account(role=role)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: None)
    contexts: list[RequestContext] = []

    def refresh(context: RequestContext, _app_id: str) -> AppMCPServerRecord:
        contexts.append(context)
        return RECORD

    monkeypatch.setattr(
        mcp_server, "application_services", lambda: SimpleNamespace(app_mcp_servers=SimpleNamespace(refresh=refresh))
    )
    with app.test_request_context(method="POST", headers={"X-Trace-Id": "trace"}):
        response = admission(AppMCPServerRefreshController.post)(None, app_id=APP_ID)
    assert isinstance(response, dict)
    assert response["id"] == RECORD.id
    assert [(c.account_id, c.active_workspace_id, c.trace_id) for c in contexts] == [(account.id, "workspace", "trace")]


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_readonly_roles_can_read(app: Flask, monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole) -> None:
    account = make_account(role=role)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
    monkeypatch.setattr(
        mcp_server,
        "application_services",
        lambda: SimpleNamespace(app_mcp_servers=SimpleNamespace(get=lambda _context, _app_id: None)),
    )
    with app.test_request_context():
        assert admission(AppMCPServerController.get)(None, app_id=APP_ID) == {}
