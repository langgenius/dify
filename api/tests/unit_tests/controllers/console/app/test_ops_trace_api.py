from __future__ import annotations

import inspect
from collections.abc import Callable
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console import flask_admission
from controllers.console.app import ops_trace as ops_trace_module
from controllers.console.app.error import (
    AppNotFoundError,
    InvalidTracingConfigError,
    TracingConfigAlreadyExistsError,
    TracingConfigNotFoundError,
    TracingConfigProcessingError,
    TracingConfigVerificationFailedError,
    UnsupportedTracingProviderError,
)
from libs.exception import BaseHTTPException
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, TenantAccountRole
from services.app_tracing_config_service import (
    AppTracingConfigAlreadyExistsError,
    AppTracingConfigAppNotFoundError,
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigNotFoundError,
    AppTracingConfigProcessingError,
    AppTracingConfigRecord,
    AppTracingConfigVerificationFailedError,
)
from tests.unit_tests.config_override import apply_config_overrides

APP_ID = "11111111-1111-1111-1111-111111111111"
WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
PROVIDER = "langfuse"
_MUTATION_METHODS = (
    ops_trace_module.TraceAppConfigApi.post,
    ops_trace_module.TraceAppConfigApi.patch,
    ops_trace_module.TraceAppConfigApi.delete,
)
_SERVICE_METHOD_NAMES = {
    "get": "get",
    "post": "create",
    "patch": "update",
    "delete": "delete",
}


def _account(role: TenantAccountRole) -> Account:
    account = Account(
        name="Trace User",
        email=f"{role.value}@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = ACCOUNT_ID
    account.role = role
    return account


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id=ACCOUNT_ID,
        active_workspace_id=WORKSPACE_ID,
    )


def _original(method: Callable[..., object]) -> Callable[..., object]:
    return inspect.unwrap(method)


def _admission_injector(method: Callable[..., object]) -> Callable[..., object]:
    return inspect.unwrap(
        method,
        stop=lambda candidate: "allowed_roles" in inspect.getclosurevars(candidate).nonlocals,
    )


@pytest.fixture
def tracing_configs(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    service = MagicMock()
    monkeypatch.setattr(
        ops_trace_module,
        "application_services",
        lambda: SimpleNamespace(app_tracing_configs=service),
    )
    return service


@pytest.mark.parametrize("method", _MUTATION_METHODS)
def test_trace_config_mutations_reject_read_only_member_when_rbac_is_disabled(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: Callable[..., object],
) -> None:
    account = _account(TenantAccountRole.NORMAL)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id=WORKSPACE_ID),
    )

    with app.test_request_context(), pytest.raises(Forbidden):
        _admission_injector(method)(None, app_id=UUID(APP_ID))


@pytest.mark.parametrize("method", _MUTATION_METHODS)
def test_trace_config_mutations_require_app_tracing_permission_when_rbac_is_enabled(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: Callable[..., object],
) -> None:
    account = _account(TenantAccountRole.NORMAL)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id=WORKSPACE_ID),
    )
    denied = MagicMock(side_effect=Forbidden())
    monkeypatch.setattr(flask_admission, "enforce_rbac_access", denied)

    with app.test_request_context(), pytest.raises(Forbidden):
        _admission_injector(method)(None, app_id=UUID(APP_ID))

    denied.assert_called_once_with(
        tenant_id=WORKSPACE_ID,
        account_id=ACCOUNT_ID,
        resource_type=ops_trace_module.RBACResourceScope.APP,
        scene=ops_trace_module.RBACPermission.APP_TRACING_CONFIG,
        resource_required=True,
        path_args={"app_id": UUID(APP_ID)},
    )


def test_trace_config_get_preserves_read_access_for_normal_member() -> None:
    admission = _admission_injector(ops_trace_module.TraceAppConfigApi.get)

    assert inspect.getclosurevars(admission).nonlocals["allowed_roles"] is None


@pytest.mark.parametrize("method", _MUTATION_METHODS)
def test_trace_config_mutations_preserve_legacy_edit_roles(method: Callable[..., object]) -> None:
    admission = _admission_injector(method)

    assert inspect.getclosurevars(admission).nonlocals["allowed_roles"] == frozenset(
        {
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
        }
    )


def test_trace_app_config_get_empty_returns_exact_legacy_body(
    app: Flask,
    tracing_configs: MagicMock,
) -> None:
    tracing_configs.get.return_value = None

    with app.test_request_context("/?tracing_provider=langfuse"):
        result = _original(ops_trace_module.TraceAppConfigApi.get)(
            ops_trace_module.TraceAppConfigApi(),
            ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER),
            _request_context(),
            UUID(APP_ID),
        )

    assert result == {"has_not_configured": True}
    tracing_configs.get.assert_called_once_with(
        context=_request_context(),
        app_id=APP_ID,
        tracing_provider=PROVIDER,
    )


def test_trace_app_config_get_configured_returns_exact_legacy_body(
    app: Flask,
    tracing_configs: MagicMock,
) -> None:
    tracing_configs.get.return_value = AppTracingConfigRecord(
        id="trace-config-1",
        app_id=APP_ID,
        tracing_provider=PROVIDER,
        tracing_config={"public_key": "pk", "secret_key": "******"},
        is_active=True,
        created_at=datetime(2026, 1, 2, 3, 4, 5),
        updated_at=datetime(2026, 1, 3, 4, 5, 6),
    )

    with app.test_request_context("/?tracing_provider=langfuse"):
        result = _original(ops_trace_module.TraceAppConfigApi.get)(
            ops_trace_module.TraceAppConfigApi(),
            ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER),
            _request_context(),
            UUID(APP_ID),
        )

    assert result == {
        "id": "trace-config-1",
        "app_id": APP_ID,
        "tracing_provider": PROVIDER,
        "tracing_config": {"public_key": "pk", "secret_key": "******"},
        "is_active": True,
        "created_at": "2026-01-02 03:04:05",
        "updated_at": "2026-01-03 04:05:06",
    }


@pytest.mark.parametrize("method_name", ["post", "patch"])
def test_trace_app_config_write_returns_exact_legacy_200_body(
    app: Flask,
    tracing_configs: MagicMock,
    method_name: str,
) -> None:
    payload = ops_trace_module.TraceConfigPayload(
        tracing_provider=PROVIDER,
        tracing_config={"public_key": "pk", "secret_key": "sk"},
    )

    with app.test_request_context("/", method=method_name.upper()):
        result = _original(getattr(ops_trace_module.TraceAppConfigApi, method_name))(
            ops_trace_module.TraceAppConfigApi(),
            payload,
            _request_context(),
            UUID(APP_ID),
        )

    assert result == {"result": "success"}
    getattr(tracing_configs, "create" if method_name == "post" else "update").assert_called_once_with(
        context=_request_context(),
        app_id=APP_ID,
        tracing_provider=PROVIDER,
        tracing_config={"public_key": "pk", "secret_key": "sk"},
    )


def test_trace_app_config_delete_returns_exact_204_response(
    app: Flask,
    tracing_configs: MagicMock,
) -> None:
    with app.test_request_context("/?tracing_provider=langfuse", method="DELETE"):
        result = _original(ops_trace_module.TraceAppConfigApi.delete)(
            ops_trace_module.TraceAppConfigApi(),
            ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER),
            _request_context(),
            UUID(APP_ID),
        )

    assert result == ("", 204)
    tracing_configs.delete.assert_called_once_with(
        context=_request_context(),
        app_id=APP_ID,
        tracing_provider=PROVIDER,
    )


@pytest.mark.parametrize("method_name", ["get", "post", "patch", "delete"])
def test_trace_app_config_maps_missing_app_to_404(
    app: Flask,
    tracing_configs: MagicMock,
    method_name: str,
) -> None:
    service_method = getattr(tracing_configs, _SERVICE_METHOD_NAMES[method_name])
    service_method.side_effect = AppTracingConfigAppNotFoundError()
    query_or_payload = (
        ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER)
        if method_name in {"get", "delete"}
        else ops_trace_module.TraceConfigPayload(tracing_provider=PROVIDER, tracing_config={})
    )

    with app.test_request_context("/"):
        with pytest.raises(AppNotFoundError) as exc_info:
            _original(getattr(ops_trace_module.TraceAppConfigApi, method_name))(
                ops_trace_module.TraceAppConfigApi(),
                query_or_payload,
                _request_context(),
                UUID(APP_ID),
            )

    assert exc_info.value.code == 404
    assert exc_info.value.error_code == "app_not_found"


@pytest.mark.parametrize(
    ("method_name", "service_error", "expected_http_error", "expected_status", "expected_code"),
    [
        pytest.param(
            "post",
            AppTracingConfigAlreadyExistsError(),
            TracingConfigAlreadyExistsError,
            409,
            "trace_config_already_exists",
            id="already-exists",
        ),
        pytest.param(
            "patch",
            AppTracingConfigNotFoundError(),
            TracingConfigNotFoundError,
            404,
            "trace_config_not_found",
            id="patch-not-found",
        ),
        pytest.param(
            "delete",
            AppTracingConfigNotFoundError(),
            TracingConfigNotFoundError,
            404,
            "trace_config_not_found",
            id="delete-not-found",
        ),
        pytest.param(
            "get",
            AppTracingConfigInvalidProviderError("unknown"),
            UnsupportedTracingProviderError,
            400,
            "unsupported_tracing_provider",
            id="get-unsupported-provider",
        ),
        pytest.param(
            "post",
            AppTracingConfigInvalidProviderError("unknown"),
            UnsupportedTracingProviderError,
            400,
            "unsupported_tracing_provider",
            id="post-unsupported-provider",
        ),
        pytest.param(
            "patch",
            AppTracingConfigInvalidProviderError("unknown"),
            UnsupportedTracingProviderError,
            400,
            "unsupported_tracing_provider",
            id="patch-unsupported-provider",
        ),
        pytest.param(
            "delete",
            AppTracingConfigInvalidProviderError("unknown"),
            UnsupportedTracingProviderError,
            400,
            "unsupported_tracing_provider",
            id="delete-unsupported-provider",
        ),
        pytest.param(
            "post",
            AppTracingConfigInvalidConfigurationError(),
            InvalidTracingConfigError,
            400,
            "invalid_tracing_config",
            id="post-invalid-config",
        ),
        pytest.param(
            "patch",
            AppTracingConfigInvalidConfigurationError(),
            InvalidTracingConfigError,
            400,
            "invalid_tracing_config",
            id="patch-invalid-config",
        ),
        pytest.param(
            "post",
            AppTracingConfigVerificationFailedError(),
            TracingConfigVerificationFailedError,
            400,
            "tracing_config_verification_failed",
            id="post-verification-failed",
        ),
        pytest.param(
            "patch",
            AppTracingConfigVerificationFailedError(),
            TracingConfigVerificationFailedError,
            400,
            "tracing_config_verification_failed",
            id="patch-verification-failed",
        ),
        pytest.param(
            "get",
            AppTracingConfigProcessingError(),
            TracingConfigProcessingError,
            500,
            "tracing_config_processing_failed",
            id="get-processing-failed",
        ),
        pytest.param(
            "post",
            AppTracingConfigProcessingError(),
            TracingConfigProcessingError,
            500,
            "tracing_config_processing_failed",
            id="post-processing-failed",
        ),
        pytest.param(
            "patch",
            AppTracingConfigProcessingError(),
            TracingConfigProcessingError,
            500,
            "tracing_config_processing_failed",
            id="patch-processing-failed",
        ),
        pytest.param(
            "delete",
            AppTracingConfigProcessingError(),
            TracingConfigProcessingError,
            500,
            "tracing_config_processing_failed",
            id="delete-processing-failed",
        ),
    ],
)
def test_trace_app_config_maps_application_errors_at_the_controller_boundary(
    app: Flask,
    tracing_configs: MagicMock,
    method_name: str,
    service_error: Exception,
    expected_http_error: type[BaseHTTPException],
    expected_status: int,
    expected_code: str,
) -> None:
    service_method = getattr(tracing_configs, _SERVICE_METHOD_NAMES[method_name])
    service_method.side_effect = service_error
    query_or_payload = (
        ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER)
        if method_name in {"get", "delete"}
        else ops_trace_module.TraceConfigPayload(tracing_provider=PROVIDER, tracing_config={})
    )

    with app.test_request_context("/"):
        with pytest.raises(expected_http_error) as exc_info:
            _original(getattr(ops_trace_module.TraceAppConfigApi, method_name))(
                ops_trace_module.TraceAppConfigApi(),
                query_or_payload,
                _request_context(),
                UUID(APP_ID),
            )

    assert exc_info.value.code == expected_status
    assert exc_info.value.error_code == expected_code
    assert exc_info.value.data == {
        "code": expected_code,
        "message": exc_info.value.description,
        "status": expected_status,
    }


@pytest.mark.parametrize("method_name", ["get", "post", "patch", "delete"])
def test_trace_app_config_maps_untyped_value_errors_to_internal_error(
    app: Flask,
    tracing_configs: MagicMock,
    method_name: str,
) -> None:
    service_method = getattr(tracing_configs, _SERVICE_METHOD_NAMES[method_name])
    service_method.side_effect = ValueError("internal detail")
    query_or_payload = (
        ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER)
        if method_name in {"get", "delete"}
        else ops_trace_module.TraceConfigPayload(tracing_provider=PROVIDER, tracing_config={})
    )

    with app.test_request_context("/"), pytest.raises(TracingConfigProcessingError) as exc_info:
        _original(getattr(ops_trace_module.TraceAppConfigApi, method_name))(
            ops_trace_module.TraceAppConfigApi(),
            query_or_payload,
            _request_context(),
            UUID(APP_ID),
        )

    assert exc_info.value.code == 500
    assert exc_info.value.error_code == "tracing_config_processing_failed"
    assert exc_info.value.description == "The tracing configuration could not be processed."
    assert exc_info.value.data == {
        "code": "tracing_config_processing_failed",
        "message": "The tracing configuration could not be processed.",
        "status": 500,
    }


@pytest.mark.parametrize("method_name", ["get", "post", "patch", "delete"])
def test_trace_app_config_does_not_mask_unexpected_errors(
    app: Flask,
    tracing_configs: MagicMock,
    method_name: str,
) -> None:
    service_method = getattr(tracing_configs, _SERVICE_METHOD_NAMES[method_name])
    unexpected_error = RuntimeError("unexpected")
    service_method.side_effect = unexpected_error
    query_or_payload = (
        ops_trace_module.TraceProviderQuery(tracing_provider=PROVIDER)
        if method_name in {"get", "delete"}
        else ops_trace_module.TraceConfigPayload(tracing_provider=PROVIDER, tracing_config={})
    )

    with app.test_request_context("/"), pytest.raises(RuntimeError) as exc_info:
        _original(getattr(ops_trace_module.TraceAppConfigApi, method_name))(
            ops_trace_module.TraceAppConfigApi(),
            query_or_payload,
            _request_context(),
            UUID(APP_ID),
        )

    assert exc_info.value is unexpected_error
