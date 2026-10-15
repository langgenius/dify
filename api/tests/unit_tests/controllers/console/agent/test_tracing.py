"""Agent tracing Console contracts and authorization stay separate from PlainApp."""

import inspect
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.rbac import AgentId
from controllers.console import flask_admission
from controllers.console.agent import tracing
from controllers.console.app.app import AppTracePayload
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, TenantAccountRole
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.entities.app_entities import AppTraceSettings
from tests.unit_tests.config_override import apply_config_overrides

AGENT_ID = UUID("1fbc2f02-f7e0-4910-9032-cbe5bf6c65d5")
CONTEXT = RequestContext("request", None, "account", "tenant")


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    service = MagicMock()
    monkeypatch.setattr(tracing, "application_services", lambda: SimpleNamespace(agent_tracing_configs=service))
    return service


def test_status_round_trips_content_policy(app: Flask, service: MagicMock) -> None:
    with app.test_request_context(
        json={"enabled": True, "tracing_provider": "langfuse", "capture_content": True, "capture_agent": False}
    ):
        result = inspect.unwrap(tracing.AgentTraceApi.post)(tracing.AgentTraceApi(), CONTEXT, AGENT_ID)
    assert result == {"enabled": True, "tracing_provider": "langfuse", "capture_content": True, "capture_agent": False}
    service.set_trace.assert_called_once_with(CONTEXT, str(AGENT_ID), AppTraceSettings(True, "langfuse", True, False))


def test_enable_requires_provider_even_when_field_omitted() -> None:
    with pytest.raises(ValidationError, match="tracing_provider is required"):
        AppTracePayload.model_validate({"enabled": True})
    payload = AppTracePayload.model_validate({"enabled": False})
    assert payload.capture_content is False
    assert payload.capture_agent is True


@pytest.mark.parametrize("enabled", [False, True])
def test_capabilities_reports_current_api_gate_without_claiming_runtime_delivery(
    app: Flask, service: MagicMock, monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=enabled)
    with app.test_request_context("/?tracing_provider=langfuse"):
        result = inspect.unwrap(tracing.AgentTraceCapabilitiesApi.get)(
            tracing.AgentTraceCapabilitiesApi(), CONTEXT, AGENT_ID
        )
    service.get_trace.assert_called_once_with(CONTEXT, str(AGENT_ID))
    assert result["api_collection_enabled"] is enabled
    assert result["agent_spans"] is True
    assert result["export_ack"] == "accepted"
    assert "runtime_enabled" not in result
    assert "queryable" not in result


@pytest.mark.parametrize("enabled", [False, True])
def test_app_capabilities_reports_api_gate(app: Flask, monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    console_apps = MagicMock()
    monkeypatch.setattr(
        tracing, "application_services", lambda: SimpleNamespace(apps=SimpleNamespace(console=console_apps))
    )
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=enabled)
    with app.test_request_context("/?tracing_provider=mlflow"):
        result = inspect.unwrap(tracing.AppTraceCapabilitiesApi.get)(
            tracing.AppTraceCapabilitiesApi(), CONTEXT, AGENT_ID
        )
    assert result["api_collection_enabled"] is enabled
    assert result["provider"] == "mlflow"
    console_apps.get_trace.assert_called_once_with(CONTEXT, str(AGENT_ID))


def test_get_config_absent_and_delete_has_no_body(app: Flask, service: MagicMock) -> None:
    service.get.return_value = None
    with app.test_request_context("/?tracing_provider=langfuse"):
        assert inspect.unwrap(tracing.AgentTraceConfigApi.get)(tracing.AgentTraceConfigApi(), CONTEXT, AGENT_ID) == {
            "has_not_configured": True
        }
        assert inspect.unwrap(tracing.AgentTraceConfigApi.delete)(tracing.AgentTraceConfigApi(), CONTEXT, AGENT_ID) == (
            "",
            204,
        )
    service.get.assert_called_once_with(CONTEXT, str(AGENT_ID), "langfuse")
    service.delete.assert_called_once_with(CONTEXT, str(AGENT_ID), "langfuse")


def test_invalid_agent_returns_not_found(app: Flask, service: MagicMock) -> None:
    service.get_trace.side_effect = AgentAppNotFoundError
    with app.test_request_context(), pytest.raises(NotFound):
        inspect.unwrap(tracing.AgentTraceApi.get)(tracing.AgentTraceApi(), CONTEXT, AGENT_ID)


@pytest.mark.parametrize(
    "method",
    [
        tracing.AgentTraceApi.post,
        tracing.AgentTraceConfigApi.get,
        tracing.AgentTraceConfigApi.post,
        tracing.AgentTraceConfigApi.patch,
        tracing.AgentTraceConfigApi.delete,
    ],
)
@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_config_requires_editor_role_or_agent_edit_permission(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], rbac_enabled: bool
) -> None:
    account = Account(name="Reader", email="reader@example.com", status=AccountStatus.ACTIVE)
    account.id, account.role = "account", TenantAccountRole.NORMAL
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account=account, tenant_id="tenant")
    )
    denied = MagicMock(side_effect=Forbidden())
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
    admission = inspect.unwrap(
        method, stop=lambda candidate: "allowed_roles" in inspect.getclosurevars(candidate).nonlocals
    )
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(None, agent_id=AGENT_ID)
    if rbac_enabled:
        (check,) = denied.call_args.kwargs["checks"]
        assert check.scene == tracing.RBACPermission.AGENT_EDIT
        assert isinstance(check.locator, AgentId)
        assert denied.call_args.kwargs["path_args"] == {"agent_id": AGENT_ID}
    else:
        denied.assert_not_called()
