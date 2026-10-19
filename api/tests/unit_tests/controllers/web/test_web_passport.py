"""Unit tests for the thin web-passport Flask adapter."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, ServiceUnavailable, Unauthorized

from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from controllers.web.passport import PassportResource
from services.entities.passport_entities import WebPassportIdentity, WebPassportRequest, WebPassportResult
from services.web_passport_service import (
    WebPassportAccessDeniedError,
    WebPassportAccountExchangeDisabledError,
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)


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
        patch("controllers.web.passport.extract_web_login_token", return_value="login-token"),
    ):
        result = PassportResource().get()

    assert result == {"access_token": "issued-token"}
    service.issue.assert_called_once_with(
        WebPassportRequest(
            app_code="app-code",
            user_session_id="session-1",
            access_token="login-token",
            app_passport=None,
            identity=None,
        )
    )


def test_passport_resource_requires_app_code(app: Flask) -> None:
    with app.test_request_context("/passport"), pytest.raises(Unauthorized, match="X-App-Code"):
        PassportResource().get()


def test_passport_resource_parses_explicit_account_exchange_without_discarding_app_passport(app: Flask) -> None:
    service = MagicMock()
    service.issue.return_value = WebPassportResult(access_token="account-passport")
    with (
        app.test_request_context("/passport?identity=account", headers={"X-App-Code": "app-code"}),
        patch("controllers.web.passport.application_services", return_value=SimpleNamespace(web_passport=service)),
        patch("controllers.web.passport.extract_web_login_token", return_value="account-login"),
        patch("controllers.web.passport.extract_webapp_passport", return_value="guest-passport"),
    ):
        assert PassportResource().get() == {"access_token": "account-passport"}
    service.issue.assert_called_once_with(
        WebPassportRequest(
            app_code="app-code",
            user_session_id=None,
            access_token="account-login",
            app_passport="guest-passport",
            identity=WebPassportIdentity.ACCOUNT,
        )
    )


@pytest.mark.parametrize(
    ("service_error", "http_error"),
    [
        (WebPassportAuthenticationRequiredError("login required"), WebAppAuthRequiredError),
        (WebPassportUnauthorizedError("bad token"), Unauthorized),
        (WebPassportAccessDeniedError("access denied"), WebAppAuthAccessDeniedError),
        (WebPassportNotFoundError(), NotFound),
        (WebPassportAccountExchangeDisabledError("disabled"), ServiceUnavailable),
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
