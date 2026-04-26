"""Controller integration tests for console OAuth server routes."""

from unittest.mock import patch

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.model import OAuthProviderApp
from services.oauth_server import OAUTH_ACCESS_TOKEN_EXPIRES_IN
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    ensure_dify_setup,
)


def _build_oauth_provider_app() -> OAuthProviderApp:
    return OAuthProviderApp(
        app_icon="icon_url",
        client_id="test_client_id",
        client_secret="test_secret",
        app_label={"en-US": "Test App"},
        redirect_uris=["http://localhost/callback"],
        scope="read,write",
    )


def test_oauth_provider_successful_post(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider",
            json={"client_id": "test_client_id", "redirect_uri": "http://localhost/callback"},
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["app_icon"] == "icon_url"
    assert payload["app_label"] == {"en-US": "Test App"}
    assert payload["scope"] == "read,write"


def test_oauth_provider_invalid_redirect_uri(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider",
            json={"client_id": "test_client_id", "redirect_uri": "http://invalid/callback"},
        )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload is not None
    assert "redirect_uri is invalid" in payload["message"]


def test_oauth_provider_invalid_client_id(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    response = test_client_with_containers.post(
        "/console/api/oauth/provider",
        json={"client_id": "test_invalid_client_id", "redirect_uri": "http://localhost/callback"},
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert "client_id is invalid" in payload["message"]


def test_oauth_authorize_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)

    with (
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
            return_value=_build_oauth_provider_app(),
        ),
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_authorization_code",
            return_value="auth_code_123",
        ) as mock_sign,
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/authorize",
            json={"client_id": "test_client_id"},
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"code": "auth_code_123"}
    mock_sign.assert_called_once_with("test_client_id", account.id)


def test_oauth_token_authorization_code_grant(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with (
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
            return_value=_build_oauth_provider_app(),
        ),
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_access_token",
            return_value=("access_123", "refresh_123"),
        ),
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


def test_oauth_token_authorization_code_grant_missing_code(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://localhost/callback",
            },
        )

    assert response.status_code == 400
    assert response.get_json()["message"] == "code is required"


def test_oauth_token_authorization_code_grant_invalid_secret(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "invalid_secret",
                "redirect_uri": "http://localhost/callback",
            },
        )

    assert response.status_code == 400
    assert response.get_json()["message"] == "client_secret is invalid"


def test_oauth_token_authorization_code_grant_invalid_redirect_uri(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://invalid/callback",
            },
        )

    assert response.status_code == 400
    assert response.get_json()["message"] == "redirect_uri is invalid"


def test_oauth_token_refresh_token_grant(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with (
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
            return_value=_build_oauth_provider_app(),
        ),
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_access_token",
            return_value=("new_access", "new_refresh"),
        ),
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


def test_oauth_token_refresh_token_grant_missing_token(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={"client_id": "test_client_id", "grant_type": "refresh_token"},
        )

    assert response.status_code == 400
    assert response.get_json()["message"] == "refresh_token is required"


def test_oauth_token_invalid_grant_type(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/token",
            json={"client_id": "test_client_id", "grant_type": "invalid_grant"},
        )

    assert response.status_code == 400
    assert response.get_json()["message"] == "invalid grant_type"


def test_oauth_account_successful_retrieval(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    account.avatar = "avatar_url"
    db_session_with_containers.commit()

    with (
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
            return_value=_build_oauth_provider_app(),
        ),
        patch(
            "controllers.console.auth.oauth_server.OAuthServerService.validate_oauth_access_token",
            return_value=account,
        ),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/account",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "Bearer valid_access_token"},
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "name": "Test User",
        "email": account.email,
        "avatar": "avatar_url",
        "interface_language": "en-US",
        "timezone": "UTC",
    }


def test_oauth_account_missing_authorization_header(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/account",
            json={"client_id": "test_client_id"},
        )

    assert response.status_code == 401
    assert response.get_json() == {"error": "Authorization header is required"}


def test_oauth_account_invalid_authorization_header_format(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    ensure_dify_setup(db_session_with_containers)

    with patch(
        "controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app",
        return_value=_build_oauth_provider_app(),
    ):
        response = test_client_with_containers.post(
            "/console/api/oauth/provider/account",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "InvalidFormat"},
        )

    assert response.status_code == 401
    assert response.get_json() == {"error": "Invalid Authorization header format"}
