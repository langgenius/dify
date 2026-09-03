"""Unit tests for the thin web-passport Flask adapter."""

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.web.error import WebAppAuthRequiredError
from controllers.web.passport import PassportResource
from services.entities.passport_entities import WebPassportRequest, WebPassportResult
from services.web_passport_service import (
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
        patch("controllers.web.passport.extract_webapp_access_token", return_value="login-token"),
    ):
        result = unwrap(PassportResource.get)(PassportResource())

    assert result == {"access_token": "issued-token"}
    service.issue.assert_called_once_with(
        WebPassportRequest(app_code="app-code", user_session_id="session-1", access_token="login-token")
    )


def test_passport_resource_requires_app_code(app: Flask) -> None:
    with app.test_request_context("/passport"), pytest.raises(Unauthorized, match="X-App-Code"):
        unwrap(PassportResource.get)(PassportResource())


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
        unwrap(PassportResource.get)(PassportResource())
