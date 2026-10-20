"""Device-flow HTTP contracts with application services isolated at their public boundary."""

from collections.abc import Callable
from datetime import UTC, datetime
from http.cookies import SimpleCookie
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask

from controllers.console import flask_admission, wraps
from libs.helper import RateLimiter
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus
from services.oauth_device_application_service import OAuthDeviceApplicationService
from services.oauth_device_contracts import (
    AccessDeniedError,
    AlreadyResolvedError,
    ApprovalInProgressError,
    ApprovalOutcomeUnknownError,
    ApprovalSessionConsumedError,
    AuthorizationPendingError,
    DeviceApprovalContext,
    DeviceAuthorization,
    DeviceLookup,
    DeviceMutation,
    DeviceRequestContext,
    DeviceSSOCompletion,
    DeviceSSOInitiation,
    DeviceStateLostError,
    ExpiredOrUnknownError,
    ExpiredTokenError,
    ExternalApprovalCSRFError,
    ExternalApprovalRateLimitError,
    ExternalIdentityConflictError,
    ExternalUserCodeMismatchError,
    ExternalUserCodeNotFoundError,
    InvalidApprovalSessionError,
    InvalidUserCodeError,
    OAuthDeviceError,
    OAuthDeviceSSOConfigurationError,
    OAuthDeviceSSOInitiationError,
    PollTooFastError,
    UnsupportedClientError,
)

_PREFIX = "/openapi/v1/oauth/device"
_COOKIE = "device_approval_grant"


@pytest.fixture
def device_service(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> Mock:
    service = create_autospec(OAuthDeviceApplicationService, instance=True)
    openapi_app.extensions["application_services"] = SimpleNamespace(
        oauth_device=service,
        feature_queries=SimpleNamespace(has_valid_enterprise_license=lambda: True),
    )
    # Supply an authenticated account while retaining the real admission/context wrapper.
    account = Account(name="Ada", email="ada@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account_with_tenant = AccountWithTenant(account, "workspace-1")
    config_overrides(
        LOGIN_DISABLED=True,
        ENABLE_OAUTH_BEARER=True,
        CONSOLE_API_URL="https://api.example",
        CONSOLE_WEB_URL="https://console.example",
    )
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: account_with_tenant)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: account_with_tenant)
    monkeypatch.setattr(RateLimiter, "is_rate_limited", lambda *_args: False)
    monkeypatch.setattr(RateLimiter, "increment_rate_limit", lambda *_args: None)
    return service


def test_device_code_serializes_authorization_and_passes_request_origin(
    openapi_app: Flask, device_service: Mock
) -> None:
    device_service.start.return_value = DeviceAuthorization(
        device_code="opaque-code",
        user_code="ABCD-EFGH",
        verification_uri="https://console.example/device",
        expires_in=900,
        interval=5,
    )

    response = openapi_app.test_client().post(
        f"{_PREFIX}/code",
        json={"client_id": "difyctl", "device_label": "laptop"},
        base_url="https://api.example",
        environ_overrides={"REMOTE_ADDR": "192.0.2.10"},
    )

    assert response.status_code == 200
    assert response.json == {
        "device_code": "opaque-code",
        "user_code": "ABCD-EFGH",
        "verification_uri": "https://console.example/device",
        "expires_in": 900,
        "interval": 5,
    }
    device_service.start.assert_called_once_with(
        client_id="difyctl",
        device_label="laptop",
        created_ip="192.0.2.10",
        request_origin="https://api.example/",
    )


@pytest.mark.parametrize("path", ["code", "token", "approve", "deny", "approve-external"])
@pytest.mark.parametrize("body", ["{}", "[]", "{invalid"])
def test_invalid_device_request_never_reaches_service(
    openapi_app: Flask, device_service: Mock, path: str, body: str
) -> None:
    response = openapi_app.test_client().post(f"{_PREFIX}/{path}", data=body, content_type="application/json")

    assert response.status_code == 400
    assert device_service.mock_calls == []


def test_lookup_requires_user_code(openapi_app: Flask, device_service: Mock) -> None:
    response = openapi_app.test_client().get(f"{_PREFIX}/lookup")

    assert response.status_code == 400
    device_service.lookup.assert_not_called()


def test_lookup_returns_public_validity_without_token_data(openapi_app: Flask, device_service: Mock) -> None:
    device_service.lookup.return_value = DeviceLookup(valid=False, expires_in_remaining=0, client_id=None)

    response = openapi_app.test_client().get(f"{_PREFIX}/lookup?user_code=ABCD-EFGH")

    assert response.status_code == 200
    assert response.json == {"valid": False, "expires_in_remaining": 0, "client_id": None}
    device_service.lookup.assert_called_once_with(user_code="ABCD-EFGH")


@pytest.mark.parametrize(
    ("path", "method", "error", "status", "code"),
    [
        ("code", "start", UnsupportedClientError(), 400, "unsupported_client"),
        ("token", "poll", PollTooFastError(), 400, "slow_down"),
        ("token", "poll", ExpiredTokenError(), 400, "expired_token"),
        ("token", "poll", AuthorizationPendingError(), 400, "authorization_pending"),
        ("token", "poll", AccessDeniedError(), 400, "access_denied"),
        ("approve", "approve", ExpiredOrUnknownError(), 404, "expired_or_unknown"),
        ("approve", "approve", AlreadyResolvedError(), 409, "already_resolved"),
        ("approve", "approve", ApprovalInProgressError(), 409, "approve_in_progress"),
        ("approve", "approve", ApprovalOutcomeUnknownError(), 503, "approval_outcome_unknown"),
        ("deny", "deny", DeviceStateLostError(), 409, "state_lost"),
    ],
)
def test_device_errors_keep_oauth_response_contract(
    openapi_app: Flask, device_service: Mock, path: str, method: str, error: OAuthDeviceError, status: int, code: str
) -> None:
    methods = {
        "start": device_service.start,
        "poll": device_service.poll,
        "approve": device_service.approve,
        "deny": device_service.deny,
    }
    methods[method].side_effect = error

    response = openapi_app.test_client().post(
        f"{_PREFIX}/{path}",
        json={"client_id": "difyctl", "device_label": "CLI", "device_code": "opaque-code", "user_code": "ABCD-EFGH"},
    )

    assert response.status_code == status
    assert response.json == {"error": code}


@pytest.mark.parametrize("external", [False, True], ids=["account", "external"])
def test_poll_serializes_subject_specific_token_payload(
    openapi_app: Flask, device_service: Mock, external: bool
) -> None:
    payload: dict[str, object] = {
        "token": "secret-token",
        "expires_at": "2030-01-01T00:00:00Z",
        "token_id": "token-1",
        "subject_type": "external_sso" if external else "account",
        "account": None if external else {"id": "account-1", "email": "ada@example.com", "name": "Ada"},
        "workspaces": [],
        "default_workspace_id": None,
    }
    if external:
        payload.update(subject_email="external@example.com", subject_issuer="https://idp.example")
    device_service.poll.return_value = payload

    response = openapi_app.test_client().post(
        f"{_PREFIX}/token",
        json={"device_code": "opaque-code", "client_id": "difyctl"},
        environ_overrides={"REMOTE_ADDR": "192.0.2.10"},
    )

    assert response.status_code == 200
    assert response.json == payload
    device_service.poll.assert_called_once_with(device_code="opaque-code", poll_ip="192.0.2.10")


@pytest.mark.parametrize("path", ["approve", "deny"])
def test_account_decision_uses_admitted_identity(openapi_app: Flask, device_service: Mock, path: str) -> None:
    method = device_service.approve if path == "approve" else device_service.deny
    method.return_value = DeviceMutation(status="approved" if path == "approve" else "denied")

    response = openapi_app.test_client().post(
        f"{_PREFIX}/{path}",
        json={"user_code": "ABCD-EFGH", "account_id": "forged", "workspace_id": "foreign"},
    )

    assert response.status_code == 200
    assert response.json == {"status": method.return_value.status}
    assert method.call_args.kwargs == {"user_code": "ABCD-EFGH"}
    if path == "approve":
        context = method.call_args.args[0]
        assert isinstance(context, RequestContext)
        assert context.account_id == "account-1"
        assert context.active_workspace_id == "workspace-1"


@pytest.mark.parametrize("path", ["approve", "deny"])
def test_disabled_bearer_feature_blocks_account_decisions(
    openapi_app: Flask, device_service: Mock, config_overrides: Callable[..., None], path: str
) -> None:
    config_overrides(ENABLE_OAUTH_BEARER=False)

    response = openapi_app.test_client().post(f"{_PREFIX}/{path}", json={"user_code": "ABCD-EFGH"})

    assert response.status_code == 503
    assert device_service.mock_calls == []


def test_sso_initiation_clears_old_approval_cookie(openapi_app: Flask, device_service: Mock) -> None:
    device_service.initiate_sso.return_value = DeviceSSOInitiation("https://idp.example/authorize")

    response = openapi_app.test_client().get(f"{_PREFIX}/sso-initiate?user_code=%20ABCD-EFGH%20")

    assert response.status_code == 302
    assert response.headers["Location"] == "https://idp.example/authorize"
    cookie = SimpleCookie(response.headers["Set-Cookie"])[_COOKIE]
    assert cookie["max-age"] == "0"
    assert cookie["path"] == _PREFIX
    assert device_service.initiate_sso.call_args.kwargs == {"user_code": "ABCD-EFGH"}


def test_sso_initiation_requires_user_code(openapi_app: Flask, device_service: Mock) -> None:
    response = openapi_app.test_client().get(f"{_PREFIX}/sso-initiate?user_code=%20")

    assert response.status_code == 400
    device_service.initiate_sso.assert_not_called()


def test_sso_completion_sets_scoped_http_only_cookie(openapi_app: Flask, device_service: Mock) -> None:
    device_service.complete_sso.return_value = DeviceSSOCompletion(user_code="ABCD-EFGH", approval_grant="signed-grant")

    response = openapi_app.test_client().get(f"{_PREFIX}/sso-complete?sso_assertion=signed-assertion")

    assert response.status_code == 302
    assert response.headers["Location"] == "/device?sso_verified=1"
    cookie = SimpleCookie(response.headers["Set-Cookie"])[_COOKIE]
    assert cookie.value == "signed-grant"
    assert cookie["path"] == _PREFIX
    assert cookie["httponly"]
    assert cookie["secure"]
    assert cookie["samesite"] == "Lax"
    assert cookie["max-age"] == "300"
    assert device_service.complete_sso.call_args.kwargs == {
        "inbound_error": None,
        "inbound_user_code": None,
        "assertion": "signed-assertion",
    }


@pytest.mark.parametrize("failure", ["exception", "missing-grant", "untrusted-error"])
def test_sso_completion_failure_redirects_without_exposing_details(
    openapi_app: Flask, device_service: Mock, failure: str
) -> None:
    device_service.complete_sso.return_value = DeviceSSOCompletion(
        error_code="private-provider-error" if failure == "untrusted-error" else None,
    )
    if failure == "exception":
        device_service.complete_sso.side_effect = RuntimeError("private-provider-error")

    response = openapi_app.test_client().get(f"{_PREFIX}/sso-complete?sso_assertion=private-assertion")

    assert response.status_code == 302
    assert response.headers["Location"] == "/device?sso_error=sso_failed"
    assert "Set-Cookie" not in response.headers
    assert b"private-" not in response.data


def test_approval_context_reads_cookie_and_serializes_expiry(openapi_app: Flask, device_service: Mock) -> None:
    device_service.get_approval_context.return_value = DeviceApprovalContext(
        subject_email="external@example.com",
        subject_issuer="https://idp.example",
        user_code="ABCD-EFGH",
        csrf_token="csrf-token",
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
    )
    client = openapi_app.test_client()
    client.set_cookie(_COOKIE, "signed-grant", path=_PREFIX)

    response = client.get(f"{_PREFIX}/approval-context")

    assert response.status_code == 200
    assert response.json == {
        "subject_email": "external@example.com",
        "subject_issuer": "https://idp.example",
        "user_code": "ABCD-EFGH",
        "csrf_token": "csrf-token",
        "expires_at": "2030-01-01T00:00:00Z",
    }
    assert device_service.get_approval_context.call_args.kwargs == {"approval_grant": "signed-grant"}


def test_external_approval_uses_cookie_and_csrf_header_then_clears_cookie(
    openapi_app: Flask, device_service: Mock
) -> None:
    device_service.approve_external.return_value = DeviceMutation("approved")
    client = openapi_app.test_client()
    client.set_cookie(_COOKIE, "signed-grant", path=_PREFIX)

    response = client.post(
        f"{_PREFIX}/approve-external",
        headers={"X-CSRF-Token": "csrf-header"},
        json={"user_code": "ABCD-EFGH", "csrf_token": "forged", "approval_grant": "forged"},
    )

    assert response.status_code == 200
    assert response.json == {"status": "approved"}
    assert isinstance(device_service.approve_external.call_args.args[0], DeviceRequestContext)
    assert device_service.approve_external.call_args.kwargs == {
        "approval_grant": "signed-grant",
        "csrf_token": "csrf-header",
        "user_code": "ABCD-EFGH",
    }
    cookie = SimpleCookie(response.headers["Set-Cookie"])[_COOKIE]
    assert cookie["max-age"] == "0"
    assert cookie["path"] == _PREFIX


@pytest.mark.parametrize(
    ("path", "method", "error", "status", "message"),
    [
        ("sso-initiate", "initiate_sso", InvalidUserCodeError(), 400, "invalid_user_code"),
        ("sso-initiate", "initiate_sso", OAuthDeviceSSOConfigurationError(), 502, "console_api_url_unset"),
        ("sso-initiate", "initiate_sso", OAuthDeviceSSOInitiationError(), 502, "sso_initiate_failed"),
        ("approval-context", "get_approval_context", InvalidApprovalSessionError(), 401, "no_session"),
        ("approve-external", "approve_external", InvalidApprovalSessionError(), 401, "invalid_session"),
        ("approve-external", "approve_external", ExternalApprovalRateLimitError(), 429, "rate_limited"),
        ("approve-external", "approve_external", ExternalApprovalCSRFError(), 403, "csrf_mismatch"),
        ("approve-external", "approve_external", ExternalUserCodeMismatchError(), 400, "user_code_mismatch"),
        ("approve-external", "approve_external", ExternalUserCodeNotFoundError(), 404, "user_code_not_pending"),
        ("approve-external", "approve_external", AlreadyResolvedError(), 409, "user_code_not_pending"),
        ("approve-external", "approve_external", ApprovalInProgressError(), 409, "approve_in_progress"),
        ("approve-external", "approve_external", ApprovalOutcomeUnknownError(), 503, "approval_outcome_unknown"),
        ("approve-external", "approve_external", ExternalIdentityConflictError(), 403, "email_belongs_to_dify_account"),
        ("approve-external", "approve_external", ApprovalSessionConsumedError(), 401, "session_already_consumed"),
        ("approve-external", "approve_external", DeviceStateLostError(), 409, "state_lost"),
    ],
)
def test_sso_errors_preserve_http_status_and_approval_cookie(
    openapi_app: Flask, device_service: Mock, path: str, method: str, error: OAuthDeviceError, status: int, message: str
) -> None:
    methods = {
        "initiate_sso": device_service.initiate_sso,
        "get_approval_context": device_service.get_approval_context,
        "approve_external": device_service.approve_external,
    }
    methods[method].side_effect = error
    client = openapi_app.test_client()
    client.set_cookie(_COOKIE, "signed-grant", path=_PREFIX)
    if path == "approve-external":
        response = client.post(f"{_PREFIX}/{path}", json={"user_code": "ABCD-EFGH"})
    else:
        response = client.get(f"{_PREFIX}/{path}?user_code=ABCD-EFGH")

    assert response.status_code == status
    assert message in response.get_data(as_text=True)
    assert "Set-Cookie" not in response.headers
    assert "signed-grant" not in response.get_data(as_text=True)
