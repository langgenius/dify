"""Controller integration tests for console OAuth server routes."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from services.entities.oauth_server_entities import (
    OAuthAuthorizationCode,
    OAuthProviderAccount,
    OAuthProviderAppPresentation,
    OAuthTokenSet,
)
from services.oauth_server_service import (
    OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    OAuthServerClientNotFoundError,
    OAuthServerRequestError,
    OAuthServerUnauthorizedError,
)
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    ensure_dify_setup,
)


def _application_services(service: MagicMock) -> SimpleNamespace:
    return SimpleNamespace(oauth_server=service)


def test_oauth_provider_successful_post(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.get_provider.return_value = OAuthProviderAppPresentation(
        app_icon="icon_url",
        app_label={"en-US": "Test App"},
        scope="read,write",
        auto_authorize=True,
    )

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider",
            json={"client_id": "test_client_id", "redirect_uri": "http://localhost/callback"},
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "app_icon": "icon_url",
        "app_label": {"en-US": "Test App"},
        "scope": "read,write",
        "auto_authorize": True,
    }


@pytest.mark.parametrize(
    ("error", "status", "message"),
    [
        (OAuthServerRequestError("redirect_uri is invalid"), 400, "redirect_uri is invalid"),
        (OAuthServerClientNotFoundError("client_id is invalid"), 404, "client_id is invalid"),
    ],
)
def test_oauth_provider_maps_application_errors(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    error: Exception,
    status: int,
    message: str,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.get_provider.side_effect = error

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider",
            json={"client_id": "test_client_id", "redirect_uri": "http://invalid/callback"},
        )

    assert response.status_code == status
    assert message in response.get_json()["message"]


def test_oauth_authorize_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    service = MagicMock()
    service.authorize.return_value = OAuthAuthorizationCode(code="auth_code_123")

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/authorize",
            json={"client_id": "test_client_id"},
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"code": "auth_code_123"}
    context = service.authorize.call_args.args[0]
    assert context.account_id == account.id


def test_oauth_token_authorization_code_grant(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.exchange_token.return_value = OAuthTokenSet(
        access_token="access_123",
        token_type="Bearer",
        expires_in=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
        refresh_token="refresh_123",
    )

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://localhost/callback",
            },
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "access_token": "access_123",
        "token_type": "Bearer",
        "expires_in": OAUTH_ACCESS_TOKEN_EXPIRES_IN,
        "refresh_token": "refresh_123",
    }


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://localhost/callback",
            },
            "code is required",
        ),
        (
            {
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "invalid_secret",
                "redirect_uri": "http://localhost/callback",
            },
            "client_secret is invalid",
        ),
        (
            {
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://invalid/callback",
            },
            "redirect_uri is invalid",
        ),
        (
            {"client_id": "test_client_id", "grant_type": "refresh_token"},
            "refresh_token is required",
        ),
        (
            {"client_id": "test_client_id", "grant_type": "invalid_grant"},
            "invalid grant_type",
        ),
    ],
)
def test_oauth_token_maps_invalid_grant_requests(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    payload: dict[str, str],
    message: str,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.exchange_token.side_effect = OAuthServerRequestError(message)

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post("/console/api/oauth/provider/token", json=payload)

    assert response.status_code == 400
    assert response.get_json()["message"] == message


def test_oauth_token_refresh_token_grant(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.exchange_token.return_value = OAuthTokenSet(
        access_token="new_access",
        token_type="Bearer",
        expires_in=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
        refresh_token="new_refresh",
    )

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={"client_id": "test_client_id", "grant_type": "refresh_token", "refresh_token": "refresh_123"},
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "access_token": "new_access",
        "token_type": "Bearer",
        "expires_in": OAUTH_ACCESS_TOKEN_EXPIRES_IN,
        "refresh_token": "new_refresh",
    }


def test_oauth_account_successful_retrieval(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.get_account.return_value = OAuthProviderAccount(
        id="account-1",
        name="Test User",
        email="test@example.com",
        avatar=None,
        interface_language=None,
        timezone=None,
    )

    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/account",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "Bearer valid_access_token"},
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "id": "account-1",
        "name": "Test User",
        "email": "test@example.com",
        "avatar": None,
        "interface_language": None,
        "timezone": None,
    }


@pytest.mark.parametrize(
    ("headers", "message"),
    [
        ({}, "Authorization header is required"),
        ({"Authorization": "InvalidFormat"}, "Invalid Authorization header format"),
        ({"Authorization": "Basic token"}, "token_type is invalid"),
        ({"Authorization": "Bearer "}, "Invalid Authorization header format"),
    ],
)
def test_oauth_account_rejects_invalid_authorization_header(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    headers: dict[str, str],
    message: str,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.get_account.side_effect = OAuthServerUnauthorizedError("access_token is required")
    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/account",
            json={"client_id": "test_client_id"},
            headers=headers,
        )

    assert response.status_code == 401
    assert response.get_json() == {"error": message}
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_oauth_account_validates_client_before_authorization_header(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    service = MagicMock()
    service.get_account.side_effect = OAuthServerClientNotFoundError("client_id is invalid")
    with patch(
        "controllers.console.auth.oauth_server.application_services",
        return_value=_application_services(service),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/account",
            json={"client_id": "invalid"},
        )

    assert response.status_code == 404
    assert "client_id is invalid" in response.get_json()["message"]
