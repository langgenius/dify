"""Serve consumer HTTP requests with real authentication, persistence and serializers."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console import bp, me
from libs.passport import PassportService
from tests.helpers.consumer import ConsumerHarness, make_consumer_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def client(harness: ConsumerHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    services = SimpleNamespace(consumer=harness.service, end_user_connection_oauth=harness.oauth.service)
    monkeypatch.setattr(me, "application_services", lambda: services)
    from controllers.common import end_user_connection_oauth

    monkeypatch.setattr(end_user_connection_oauth, "application_services", lambda: services)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    app.register_blueprint(bp)
    with app.test_client() as client:
        client.set_cookie(COOKIE_NAME_ACCESS_TOKEN, harness.token())
        csrf = PassportService().issue(
            {
                "sub": harness.identity.account_id,
                "exp": datetime.now(UTC) + timedelta(minutes=10),
            }
        )
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, csrf)
        client.environ_base["HTTP_" + HEADER_NAME_CSRF_TOKEN.upper().replace("-", "_")] = csrf
        yield client


def test_http_app_views_favorites_and_timestamps(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    path = f"/console/api/me/apps/{base.context.app_id}/favorite"
    assert client.put(path).status_code == 204
    assert client.put(path).status_code == 204
    harness.service.record_usage(
        harness.identity, tenant_id=base.context.tenant_id, app_id=base.context.app_id, used_at=datetime(2026, 10, 30)
    )
    for view in ("recent", "favorites", "shared"):
        response = client.get(f"/console/api/me/apps?view={view}&limit=1")
        assert response.status_code == 200
        data = response.get_json()
        assert data["has_more"] is False
        assert data["data"][0]["id"] == base.context.app_id
        assert isinstance(data["data"][0]["last_used_at"], int)
        assert "continuation" not in data["data"][0]
    assert client.delete(path).status_code == 204
    assert client.get("/console/api/me/apps?view=favorites").get_json()["data"] == []


def test_http_connection_replacement_and_delete(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    created = base.service.create_api_key(base.context, base.command())
    path = f"/console/api/me/connections/{created.id}"
    listed = client.get("/console/api/me/connections?limit=1")
    assert listed.status_code == 200
    assert listed.get_json()["data"][0]["connection"]["id"] == created.id
    response = client.get(path)
    assert response.status_code == 200
    assert isinstance(response.get_json()["connection"]["created_at"], int)
    revision = client.get(path + "/revision").get_json()["connection_revision"]
    schema = client.get(path + "/credential-schema", query_string={"connection_revision": revision})
    assert schema.status_code == 200
    assert schema.get_json()[0]["name"] == "api_key"
    updated = client.patch(
        path,
        json={"name": "Renamed", "credentials": {"api_key": "replacement-secret"}, "connection_revision": revision},
    )
    assert updated.status_code == 200
    assert updated.get_json()["name"] == "Renamed"
    assert "replacement-secret" not in updated.get_data(as_text=True)
    assert "encrypted_credentials" not in response.get_data(as_text=True)
    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("suffix", ["", "/revision", "/credential-schema"])
def test_foreign_connection_matches_unknown_http_id(client: FlaskClient, suffix: str) -> None:
    response = client.get(f"/console/api/me/connections/{uuid4()}{suffix}")
    # Schema parsing precedes the ownership lookup only when its required revision is absent.
    assert response.status_code == (400 if suffix == "/credential-schema" else 404)
    assert response.get_json()["code"] == (
        "invalid_param" if suffix == "/credential-schema" else "connection_not_found"
    )


@pytest.mark.parametrize(
    "payload", [{"name": None}, {"credentials": {"api_key": "secret"}}, {"account_id": "secret"}, {}]
)
def test_invalid_connection_payloads_are_safe(
    client: FlaskClient, harness: ConsumerHarness, payload: dict[str, object]
) -> None:
    base = harness.oauth.base
    created = base.service.create_api_key(base.context, base.command())
    response = client.patch(f"/console/api/me/connections/{created.id}", json=payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"
    assert "secret" not in response.get_data(as_text=True)


def test_account_cookie_and_csrf_are_both_required(client: FlaskClient, harness: ConsumerHarness) -> None:
    client.delete_cookie(COOKIE_NAME_ACCESS_TOKEN)
    assert client.get("/console/api/me/apps").status_code == 401
    client.set_cookie(COOKIE_NAME_ACCESS_TOKEN, harness.token())
    client.delete_cookie(COOKIE_NAME_CSRF_TOKEN)
    assert client.get("/console/api/me/apps").status_code == 401


def test_oauth_start_and_callback_use_account_origin(client: FlaskClient, harness: ConsumerHarness) -> None:
    oauth = harness.oauth
    created = oauth.finish(oauth.start())
    path = f"/console/api/me/connections/{created.id}"
    revision = client.get(path + "/revision").get_json()["connection_revision"]
    response = client.post(path + "/reauthorize", json={"connection_revision": revision})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["Set-Cookie"]
    from urllib.parse import parse_qs, urlsplit

    state = parse_qs(urlsplit(response.get_json()["authorization_url"]).query)["state"][0]
    callback = f"/console/api/me/connections/oauth/{created.provider}/callback?state={state}&code=code"
    completed = client.get(callback)
    assert completed.status_code == 302
    assert completed.headers["Location"] == f"http://localhost/oauth-callback?connection_id={created.id}"
    assert client.get(callback).status_code == 400
