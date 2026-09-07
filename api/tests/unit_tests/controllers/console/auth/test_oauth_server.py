from http import HTTPStatus
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console.auth.oauth_server import (
    OAuthProviderAppResponse,
    OAuthServerAppApi,
    OAuthServerUserAccountApi,
    OAuthServerUserAuthorizeApi,
    OAuthServerUserTokenApi,
)
from machinery.context import RequestContext
from services.entities.oauth_server_entities import (
    OAuthAuthorizationCode,
    OAuthProviderAccount,
    OAuthProviderAppPresentation,
    OAuthTokenSet,
)
from services.oauth_server_service import OAuthServerClientNotFoundError, OAuthServerUnauthorizedError


def _context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "account-1", "workspace-1")


def _services(service: MagicMock) -> SimpleNamespace:
    return SimpleNamespace(oauth_server=service)


def test_provider_parses_payload_delegates_and_serializes() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.get_provider.return_value = OAuthProviderAppPresentation(
        app_icon="icon",
        app_label={"en-US": "Test App"},
        scope="read",
        auto_authorize=True,
    )

    with (
        app.test_request_context(json={"client_id": "client-1", "redirect_uri": "https://example.com/callback"}),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        result = unwrap(OAuthServerAppApi.post)(OAuthServerAppApi())

    assert result == (
        {
            "app_icon": "icon",
            "app_label": {"en-US": "Test App"},
            "scope": "read",
            "auto_authorize": True,
        },
        HTTPStatus.OK,
    )
    service.get_provider.assert_called_once_with(
        client_id="client-1",
        redirect_uri="https://example.com/callback",
    )


def test_authorize_uses_admission_request_context() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.authorize.return_value = OAuthAuthorizationCode(code="authorization-code")
    context = _context()

    with (
        app.test_request_context(json={"client_id": "client-1"}),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        result = unwrap(OAuthServerUserAuthorizeApi.post)(OAuthServerUserAuthorizeApi(), context)

    assert result == ({"code": "authorization-code"}, HTTPStatus.OK)
    service.authorize.assert_called_once_with(context, client_id="client-1")


def test_token_endpoint_delegates_grant_data() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.exchange_token.return_value = OAuthTokenSet(
        access_token="access-1",
        token_type="Bearer",
        expires_in=43200,
        refresh_token="refresh-1",
    )

    with (
        app.test_request_context(
            json={
                "client_id": "client-1",
                "grant_type": "authorization_code",
                "code": "code-1",
                "client_secret": "secret",
                "redirect_uri": "https://example.com/callback",
            }
        ),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        result = unwrap(OAuthServerUserTokenApi.post)(OAuthServerUserTokenApi())

    assert result == (
        {
            "access_token": "access-1",
            "token_type": "Bearer",
            "expires_in": 43200,
            "refresh_token": "refresh-1",
        },
        HTTPStatus.OK,
    )
    service.exchange_token.assert_called_once_with(
        client_id="client-1",
        grant_type="authorization_code",
        code="code-1",
        client_secret="secret",
        redirect_uri="https://example.com/callback",
        refresh_token=None,
    )


def test_account_endpoint_parses_bearer_token_and_serializes_account() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.get_account.return_value = OAuthProviderAccount(
        id="account-1",
        name="Test User",
        email="test@example.com",
        avatar="avatar",
        interface_language="en-US",
        timezone="UTC",
    )

    with (
        app.test_request_context(
            json={"client_id": "client-1"},
            headers={"Authorization": "Bearer access-1"},
        ),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        result = unwrap(OAuthServerUserAccountApi.post)(OAuthServerUserAccountApi())

    assert result == (
        {
            "id": "account-1",
            "name": "Test User",
            "email": "test@example.com",
            "avatar": "avatar",
            "interface_language": "en-US",
            "timezone": "UTC",
        },
        HTTPStatus.OK,
    )
    service.get_account.assert_called_once_with(client_id="client-1", access_token="access-1")


def test_account_endpoint_serializes_nullable_account_preferences() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.get_account.return_value = OAuthProviderAccount(
        id="account-1",
        name="Test User",
        email="test@example.com",
        avatar=None,
        interface_language=None,
        timezone=None,
    )

    with (
        app.test_request_context(
            json={"client_id": "client-1"},
            headers={"Authorization": "Bearer access-1"},
        ),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        result = unwrap(OAuthServerUserAccountApi.post)(OAuthServerUserAccountApi())

    assert result == (
        {
            "id": "account-1",
            "name": "Test User",
            "email": "test@example.com",
            "avatar": None,
            "interface_language": None,
            "timezone": None,
        },
        HTTPStatus.OK,
    )


def test_account_endpoint_returns_bearer_challenge_for_missing_header() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.get_account.side_effect = OAuthServerUnauthorizedError("access_token is required")

    with (
        app.test_request_context(json={"client_id": "client-1"}),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        response = unwrap(OAuthServerUserAccountApi.post)(OAuthServerUserAccountApi())

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json() == {"error": "Authorization header is required"}
    assert response.headers["WWW-Authenticate"] == "Bearer"
    service.get_account.assert_called_once_with(client_id="client-1", access_token=None)


def test_account_endpoint_preserves_client_validation_before_bearer_challenge() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.get_account.side_effect = OAuthServerClientNotFoundError("client_id is invalid")

    with (
        app.test_request_context(json={"client_id": "missing"}),
        patch("controllers.console.auth.oauth_server.application_services", return_value=_services(service)),
    ):
        with pytest.raises(NotFound, match="client_id is invalid"):
            unwrap(OAuthServerUserAccountApi.post)(OAuthServerUserAccountApi())


def test_oauth_provider_app_response_requires_auto_authorize() -> None:
    # A missing field must fail validation instead of silently defaulting:
    # an optional field would surface as `undefined` in the generated TS
    # contract and silently disable silent authorization.
    assert "auto_authorize" in OAuthProviderAppResponse.model_json_schema()["required"]
