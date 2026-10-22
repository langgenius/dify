"""Unit tests for the thin web-passport Flask adapter."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, Unauthorized

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from controllers.common.end_user_connections import ConnectionLoginRequiredError
from controllers.web.error import WebAppAuthRequiredError
from controllers.web.passport import AccountPassportResource, PassportQuery, PassportResource
from enums import DeploymentEdition
from services.entities.passport_entities import WebPassportRequest, WebPassportResult
from services.web_passport_service import (
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)
from tests.unit_tests.config_override import apply_config_overrides


def test_passport_resource_parses_input_and_serializes_result(app: Flask) -> None:
    service = MagicMock()
    service.issue.return_value = WebPassportResult(access_token="issued-token")
    services = SimpleNamespace(web_passport=service)

    with (
        app.test_request_context(
            "/passport?user_id=session-1",
            headers={"X-App-Code": "app-code", "Authorization": "Bearer login-token"},
        ),
        patch("controllers.web.passport.application_services", return_value=services),
        patch("controllers.web.passport.extract_webapp_access_token", return_value="login-token"),
    ):
        result = PassportResource().get()

    assert result == {"access_token": "issued-token"}
    service.issue.assert_called_once_with(
        WebPassportRequest(
            app_code="app-code",
            user_session_id="session-1",
            access_token="login-token",
        )
    )


def test_passport_resource_requires_app_code(app: Flask) -> None:
    with app.test_request_context("/passport"), pytest.raises(Unauthorized, match="X-App-Code"):
        PassportResource().get()


@pytest.mark.parametrize("enabled", [True, False])
def test_existing_passport_endpoint_keeps_web_login_and_does_not_select_account_cookie(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=enabled,
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    service = MagicMock()
    service.issue.return_value = WebPassportResult(access_token="passport")
    with (
        app.test_request_context(
            "/passport",
            headers={
                "X-App-Code": "app-code",
                "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}=account-login; {COOKIE_NAME_WEBAPP_ACCESS_TOKEN}=ee-login",
            },
        ),
        patch("controllers.web.passport.application_services", return_value=SimpleNamespace(web_passport=service)),
    ):
        PassportResource().get()
    assert service.issue.call_args.args[0].access_token == "ee-login"
    service.issue_for_account.assert_not_called()


def test_passport_query_keeps_its_existing_contract() -> None:
    assert set(PassportQuery.model_fields) == {"user_id"}


def test_account_exchange_uses_only_console_cookie_and_disables_caching(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    service = MagicMock()
    service.issue_for_account.return_value = WebPassportResult(access_token="account-passport")
    with (
        app.test_request_context(
            "/passport/account?user_id=guest-session",
            method="POST",
            headers={
                "X-App-Code": "app-code",
                "Authorization": "Bearer other-account",
                "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}=account-login; {COOKIE_NAME_WEBAPP_ACCESS_TOKEN}=ee-login",
            },
        ),
        patch("controllers.web.passport.application_services", return_value=SimpleNamespace(web_passport=service)),
        patch(
            "controllers.web.passport.PassportService.verify",
            return_value={"sub": "Console API Passport", "user_id": "account-1"},
        ),
        patch("controllers.web.passport.check_csrf_token") as check_csrf,
    ):
        response = AccountPassportResource().post()
    assert response.json == {"access_token": "account-passport"}
    assert check_csrf.call_args.args[1] == "account-1"
    assert response.headers["Cache-Control"] == "no-store"
    service.issue_for_account.assert_called_once_with(app_code="app-code", access_token="account-login")
    service.issue.assert_not_called()


@pytest.mark.parametrize("enabled", [False, True])
def test_account_exchange_rejects_disabled_feature_or_bearer_only(
    app: Flask, monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    apply_config_overrides(monkeypatch, WEBAPP_ACCOUNT_PASSPORT_ENABLED=enabled)
    with (
        app.test_request_context(
            "/passport/account", headers={"X-App-Code": "app-code", "Authorization": "Bearer account-login"}
        ),
        pytest.raises(ConnectionLoginRequiredError if enabled else NotFound),
    ):
        AccountPassportResource().post()


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        (WebPassportAuthenticationRequiredError("login required"), WebAppAuthRequiredError),
        (WebPassportUnauthorizedError("bad token"), Unauthorized),
        (WebPassportNotFoundError(), NotFound),
    ],
)
def test_passport_resource_translates_application_errors(
    service_error: Exception,
    http_error: type[Exception],
    app: Flask,
) -> None:
    service = MagicMock()
    service.issue.side_effect = service_error
    services = SimpleNamespace(web_passport=service)

    with (
        app.test_request_context("/passport", headers={"X-App-Code": "app-code"}),
        patch("controllers.web.passport.application_services", return_value=services),
        pytest.raises(http_error),
    ):
        PassportResource().get()


def test_account_exchange_rejects_missing_csrf_before_issuing_passport(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    service = MagicMock()
    with (
        app.test_request_context(
            "/passport/account",
            method="POST",
            headers={"X-App-Code": "app-code", "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}=account-login"},
        ),
        patch("controllers.web.passport.application_services", return_value=SimpleNamespace(web_passport=service)),
        patch(
            "controllers.web.passport.PassportService.verify",
            return_value={"sub": "Console API Passport", "user_id": "account-1"},
        ),
        pytest.raises(Unauthorized, match="CSRF"),
    ):
        AccountPassportResource().post()
    service.issue_for_account.assert_not_called()
