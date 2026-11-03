"""Serve consumer APIs through WebApp Account login and same-origin cookies."""

from collections.abc import Iterator
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from constants import COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from controllers.web import bp, me
from tests.helpers.consumer import ConsumerHarness, make_consumer_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def client(harness: ConsumerHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    monkeypatch.setattr(me, "application_services", lambda: SimpleNamespace(consumer=harness.service))
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    app.register_blueprint(bp)
    with app.test_client() as client:
        client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, harness.token())
        client.environ_base["HTTP_ORIGIN"] = "http://localhost"
        yield client


def test_http_app_views_favorites_and_timestamps(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    path = f"/api/me/apps/{base.context.app_id}/favorite"
    assert client.put(path).status_code == 204
    assert client.put(path).status_code == 204
    harness.service.record_usage(
        harness.identity, tenant_id=base.context.tenant_id, app_id=base.context.app_id, used_at=datetime(2026, 10, 30)
    )
    for view in ("recent", "favorites", "shared"):
        response = client.get(f"/api/me/apps?view={view}&limit=1")
        assert response.status_code == 200
        data = response.get_json()
        assert data["has_more"] is False
        assert data["data"][0]["id"] == base.context.app_id
        assert isinstance(data["data"][0]["last_used_at"], int)
        assert "continuation" not in data["data"][0]
    assert client.delete(path).status_code == 204
    assert client.get("/api/me/apps?view=favorites").get_json()["data"] == []


def test_connections_support_only_query_and_disconnect(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    created = base.service.create_api_key(base.context, base.command())
    path = f"/api/me/connections/{created.id}"
    listed = client.get("/api/me/connections?limit=1")
    assert listed.status_code == 200
    assert listed.get_json()["data"][0]["connection"]["id"] == created.id
    response = client.get(path)
    assert response.status_code == 200
    assert isinstance(response.get_json()["connection"]["created_at"], int)
    assert "encrypted_credentials" not in response.get_data(as_text=True)
    assert client.patch(path, json={"name": "Renamed"}).status_code == 405
    assert client.get(path + "/credential-schema").status_code == 404
    assert client.post(path + "/reauthorize").status_code == 404
    assert client.get(path + "/revision").status_code == 404
    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404


def test_foreign_connection_matches_unknown_http_id(client: FlaskClient) -> None:
    response = client.get(f"/api/me/connections/{uuid4()}")
    assert response.status_code == 404
    assert response.get_json()["code"] == "connection_not_found"


@pytest.mark.parametrize("source", [None, "webapp", "webapp_account", "webapp_login_token", "unknown"])
def test_console_and_app_tokens_cannot_authenticate_consumer_routes(
    client: FlaskClient, harness: ConsumerHarness, source: str | None
) -> None:
    subject = "Console API Passport" if source is None else "Web API Account Login"
    client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, harness.token(source=source, subject=subject))
    assert client.get("/api/me/apps").status_code == 401


@pytest.mark.parametrize("origin", [None, "https://evil.example", "null", "http://localhost.evil"])
def test_account_mutations_require_a_trusted_origin(
    client: FlaskClient, harness: ConsumerHarness, origin: str | None
) -> None:
    client.environ_base.pop("HTTP_ORIGIN")
    headers: dict[str, str] = {} if origin is None else {"Origin": origin}
    response = client.put(f"/api/me/apps/{harness.oauth.base.context.app_id}/favorite", headers=headers)
    assert response.status_code == 403
    assert client.get("/api/me/apps", headers=headers).status_code == (200 if origin is None else 403)


def test_webapp_login_cookie_is_required(client: FlaskClient) -> None:
    client.delete_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN)
    assert client.get("/api/me/apps").status_code == 401


def test_account_reads_do_not_require_origin(client: FlaskClient) -> None:
    client.environ_base.pop("HTTP_ORIGIN")
    assert client.get("/api/me/apps").status_code == 200


def test_mutations_require_origin_even_with_a_trusted_referrer(client: FlaskClient) -> None:
    client.environ_base.pop("HTTP_ORIGIN")
    response = client.put(
        f"/api/me/apps/{uuid4()}/favorite",
        headers={"Referer": "http://localhost/apps/1"},
    )
    assert response.status_code == 403
