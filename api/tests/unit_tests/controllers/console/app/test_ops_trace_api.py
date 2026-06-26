from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.common import wraps as common_wraps
from controllers.console import console_ns
from controllers.console import wraps as console_wraps
from controllers.console.app import ops_trace as ops_trace_module
from controllers.console.app import wraps as app_wraps
from libs import login as login_lib
from models.account import Account, AccountStatus, TenantAccountRole


def _make_account(role: TenantAccountRole) -> Account:
    account = Account(name="tester", email="tester@example.com")
    account.id = "account-123"  # type: ignore[assignment]
    account.status = AccountStatus.ACTIVE
    account.role = role
    account._current_tenant = SimpleNamespace(id="tenant-123")  # type: ignore[assignment]
    account._get_current_object = lambda: account  # type: ignore[attr-defined]
    return account


def _make_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-123", tenant_id="tenant-123", status="normal", mode="chat")


def _patch_console_guards(
    monkeypatch: pytest.MonkeyPatch,
    account: Account,
    app_model: SimpleNamespace,
    *,
    rbac_enabled: bool = False,
) -> None:
    monkeypatch.setattr(login_lib.dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(login_lib.dify_config, "RBAC_ENABLED", rbac_enabled)
    monkeypatch.setattr(console_wraps.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr(login_lib, "current_user", account)
    monkeypatch.setattr(login_lib, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(common_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(app_wraps, "_load_app_model_from_scoped_session", lambda _app_id: app_model)


def _patch_payload(payload: dict[str, object] | None):
    if payload is None:
        return nullcontext()
    return patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload)


@pytest.mark.parametrize(
    ("method_name", "path", "payload", "service_method_name", "service_result"),
    [
        (
            "post",
            "/console/api/apps/app-123/trace-config",
            {"tracing_provider": "mlflow", "tracing_config": {"endpoint": "https://trace.example.com"}},
            "create_tracing_app_config",
            {"id": "trace-config-1"},
        ),
        (
            "patch",
            "/console/api/apps/app-123/trace-config",
            {"tracing_provider": "mlflow", "tracing_config": {"endpoint": "https://trace.example.com"}},
            "update_tracing_app_config",
            True,
        ),
        (
            "delete",
            "/console/api/apps/app-123/trace-config?tracing_provider=mlflow",
            None,
            "delete_tracing_app_config",
            True,
        ),
    ],
)
def test_trace_config_mutations_require_edit_permission(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    path: str,
    payload: dict[str, object] | None,
    service_method_name: str,
    service_result: object,
) -> None:
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    account = _make_account(TenantAccountRole.NORMAL)
    _patch_console_guards(monkeypatch, account, _make_app())
    service_mock = MagicMock(return_value=service_result)
    monkeypatch.setattr(ops_trace_module.OpsService, service_method_name, service_mock)

    with app.test_request_context(path, method=method_name.upper(), json=payload):
        with _patch_payload(payload):
            with pytest.raises(Forbidden):
                getattr(ops_trace_module.TraceAppConfigApi(), method_name)(app_id="app-123")

    service_mock.assert_not_called()


@pytest.mark.parametrize(
    ("method_name", "path", "payload", "service_method_name", "service_result"),
    [
        (
            "post",
            "/console/api/apps/app-123/trace-config",
            {"tracing_provider": "mlflow", "tracing_config": {"endpoint": "https://trace.example.com"}},
            "create_tracing_app_config",
            {"id": "trace-config-1"},
        ),
        (
            "patch",
            "/console/api/apps/app-123/trace-config",
            {"tracing_provider": "mlflow", "tracing_config": {"endpoint": "https://trace.example.com"}},
            "update_tracing_app_config",
            True,
        ),
        (
            "delete",
            "/console/api/apps/app-123/trace-config?tracing_provider=mlflow",
            None,
            "delete_tracing_app_config",
            True,
        ),
    ],
)
def test_trace_config_mutations_require_rbac_permission(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    path: str,
    payload: dict[str, object] | None,
    service_method_name: str,
    service_result: object,
) -> None:
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    account = _make_account(TenantAccountRole.NORMAL)
    _patch_console_guards(monkeypatch, account, _make_app(), rbac_enabled=True)
    monkeypatch.setattr(common_wraps.db, "session", SimpleNamespace(scalar=lambda _stmt: "other-account"))
    monkeypatch.setattr(common_wraps.RBACService.CheckAccess, "check", MagicMock(return_value=False))
    service_mock = MagicMock(return_value=service_result)
    monkeypatch.setattr(ops_trace_module.OpsService, service_method_name, service_mock)

    with app.test_request_context(path, method=method_name.upper(), json=payload):
        with _patch_payload(payload):
            with pytest.raises(Forbidden):
                getattr(ops_trace_module.TraceAppConfigApi(), method_name)(app_id="app-123")

    service_mock.assert_not_called()
