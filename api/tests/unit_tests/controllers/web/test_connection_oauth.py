from collections.abc import Callable, Iterator
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from clients.plugin.auth_entities import OAuthRevokeResult
from configs import dify_config
from controllers.common import end_user_connection_oauth
from controllers.console import bp as console_bp
from controllers.web import bp, connection_oauth, connections, wraps
from enums import DeploymentEdition
from models.end_user_connection import EndUserConnection
from models.model import App, EndUser
from models.tools import ToolOAuthTenantClient
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def client(harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    def identity() -> tuple[App, EndUser]:
        with harness.base.sessions() as session:
            app = session.get(App, harness.base.context.app_id)
            user = session.get(EndUser, harness.base.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    services = SimpleNamespace(end_user_connection_oauth=harness.service, end_user_connections=harness.base.service)
    monkeypatch.setattr(connection_oauth, "application_services", lambda: services)
    monkeypatch.setattr(end_user_connection_oauth, "application_services", lambda: services)
    monkeypatch.setattr(connections, "application_services", lambda: services)
    monkeypatch.setattr(dify_config, "CONSOLE_API_URL", "https://console-api.example")
    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://web.example")
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    app.register_blueprint(console_bp)
    with app.test_client() as client:
        yield client


def start(client: FlaskClient, harness: OAuthHarness) -> TestResponse:
    return client.post(
        "/api/connections/oauth/authorization-url",
        base_url="https://web-api.example",
        headers={"X-App-Code": harness.app_code},
        json=harness.command().model_dump(mode="json"),
    )


def callback_query(response: TestResponse) -> str:
    state = parse_qs(urlsplit(response.get_json()["authorization_url"]).query)["state"][0]
    return f"state={state}&code=provider-code"


def test_cross_host_oauth_callback_returns_to_cookie_owner(client: FlaskClient, harness: OAuthHarness) -> None:
    response = start(client, harness)
    assert response.status_code == 200
    assert set(response.get_json()) == {"authorization_url"}
    cookie = response.headers["Set-Cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie
    assert "Secure" in cookie
    assert "Max-Age=300" in cookie
    query = callback_query(response)
    routed = client.get(
        f"/console/api/oauth/plugin/{PROVIDER}/tool/callback?{query}", base_url="https://console-api.example"
    )
    assert routed.status_code == 302
    assert routed.location == f"https://web-api.example/api/connections/oauth/{PROVIDER}/callback?{query}"
    assert harness.handler.exchanges == 0
    completed = client.get(
        routed.location, headers={"Authorization": "private-passport", "X-App-Passport": "private-app-token"}
    )
    assert completed.status_code == 302
    assert completed.location.startswith("https://web.example/oauth-callback?connection_id=")
    assert "Max-Age=0" in completed.headers["Set-Cookie"]
    assert "Authorization" not in harness.handler.callback_headers
    assert "Cookie" not in harness.handler.callback_headers
    assert "X-App-Passport" not in harness.handler.callback_headers
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 1
    replay = client.get(routed.location)
    assert replay.status_code == 400
    assert replay.get_json()["code"] == "connection_oauth_failed"


def test_callback_requires_initiating_browser_cookie(client: FlaskClient, harness: OAuthHarness) -> None:
    response = start(client, harness)
    query = callback_query(response)
    client.delete_cookie("context_id", domain="web-api.example")
    denied = client.get(f"https://web-api.example/api/connections/oauth/{PROVIDER}/callback?{query}")
    assert denied.status_code == 400
    assert denied.get_json()["code"] == "connection_oauth_failed"
    assert harness.handler.exchanges == 0


def test_invalid_oauth_payload_does_not_echo_input(client: FlaskClient, harness: OAuthHarness) -> None:
    response = client.post(
        "/api/connections/oauth/authorization-url",
        json={"tenant_id": "secret-value"},
        headers={"X-App-Code": harness.app_code},
    )
    assert response.status_code == 400
    assert "secret-value" not in response.get_data(as_text=True)


def test_reauthorize_keeps_id_without_requiring_published_node(client: FlaskClient, harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == harness.base.context.app_id).values({"workflow_id": None}))
    response = client.post(
        f"/api/connections/{connection.id}/reauthorize",
        headers={"X-App-Code": harness.app_code},
        base_url="https://web-api.example",
    )
    assert response.status_code == 200
    result = client.get(f"https://web-api.example/api/connections/oauth/{PROVIDER}/callback?{callback_query(response)}")
    assert result.status_code == 302
    assert result.location.endswith(f"connection_id={connection.id}")


def test_guest_cannot_start_authorization(
    client: FlaskClient, harness: OAuthHarness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == harness.base.context.end_user_id).values(account_id=None)
        )
    response = start(client, harness)
    assert response.status_code == 401
    assert response.get_json()["code"] == "end_user_login_required"


def test_oauth_check_and_delete_use_existing_management_routes(client: FlaskClient, harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    response = client.post(f"/api/connections/{connection.id}/check")
    assert response.status_code == 200
    assert response.get_json()["check"]["status"] == "valid"
    assert response.get_json()["credential_status"] == "connected"
    assert "secret" not in response.get_data(as_text=True)
    assert len(harness.handler.refreshes) == 1
    harness.base.auth.revoke_result = OAuthRevokeResult(
        status="temporarily_unavailable", reason_code="provider_unavailable", retryable=True
    )
    deleted = client.delete(f"/api/connections/{connection.id}")
    assert deleted.status_code == 204
    assert deleted.data == b""
    assert client.get(f"/api/connections/{connection.id}").status_code == 404


@pytest.mark.parametrize("change", ["changed", "deleted"])
def test_oauth_client_change_is_a_documented_check_error(
    client: FlaskClient, harness: OAuthHarness, change: str
) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        if change == "deleted":
            session.execute(sa.delete(ToolOAuthTenantClient).where(ToolOAuthTenantClient.id == harness.client_id))
        else:
            session.execute(
                sa.update(ToolOAuthTenantClient)
                .where(ToolOAuthTenantClient.id == harness.client_id)
                .values(encrypted_oauth_params='{"client_id":"changed"}')
            )
    response = client.post(f"/api/connections/{connection.id}/check")
    assert response.status_code == 409
    assert response.get_json()["code"] == "connection_reauthorization_required"
    assert client.delete(f"/api/connections/{connection.id}").status_code == 204


def test_refresh_timeout_is_a_check_result_without_invalidating_connection(
    client: FlaskClient, harness: OAuthHarness
) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    harness.handler.refresh_error = ValueError("private-provider-response")
    response = client.post(f"/api/connections/{connection.id}/check")
    assert response.status_code == 200
    assert response.get_json()["check"]["status"] == "temporarily_unavailable"
    assert response.get_json()["credential_status"] == "connected"
    assert "private-provider-response" not in response.get_data(as_text=True)


@pytest.mark.parametrize("disable_before_callback", [False, True])
def test_guest_oauth_rechecks_policy_before_exchanging_and_persisting_credentials(
    client: FlaskClient, harness: OAuthHarness, config_overrides: Callable[..., None], disable_before_callback: bool
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=True)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == harness.base.context.end_user_id).values(account_id=None)
        )
    harness.base.context = replace(harness.base.context, account_id=None)
    response = start(client, harness)
    assert response.status_code == 200
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=not disable_before_callback)
    completed = client.get(
        f"https://web-api.example/api/connections/oauth/{PROVIDER}/callback?{callback_query(response)}"
    )
    if disable_before_callback:
        assert completed.status_code == 401
        assert completed.get_json()["code"] == "end_user_login_required"
        assert harness.handler.exchanges == 0
        with harness.base.sessions() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0
        return
    assert completed.status_code == 302
    connection_id = parse_qs(urlsplit(completed.location).query)["connection_id"][0]
    with harness.base.sessions() as session:
        stored = session.get(EndUserConnection, connection_id)
        assert stored is not None
        assert stored.account_id is None
        assert stored.end_user_id == harness.base.context.end_user_id
    renewed = client.post(f"/api/connections/{connection_id}/reauthorize", base_url="https://web-api.example")
    assert renewed.status_code == 200
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    denied = client.post(f"/api/connections/{connection_id}/reauthorize", base_url="https://web-api.example")
    assert denied.status_code == 401
    completed = client.get(
        f"https://web-api.example/api/connections/oauth/{PROVIDER}/callback?{callback_query(renewed)}"
    )
    assert completed.status_code == 401
    assert harness.handler.exchanges == 1
