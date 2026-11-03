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
from models.end_user_connection import AppConnection
from tests.helpers.consumer import ConsumerHarness, consumer_connection_key, make_consumer_harness, new_consumer_run
from tests.helpers.end_user_connection_contract import new_connection


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
    with base.sessions.begin() as session:
        session.add(new_consumer_run(base, created_at=datetime(2026, 10, 30)))
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
    listed = client.get("/api/me/connections?limit=1")
    assert listed.status_code == 200
    listed_connection = listed.get_json()["data"][0]
    assert listed_connection == {
        "key": str(consumer_connection_key(created)),
        "provider": created.provider,
        "connection_type": "api-key",
        "name": created.name,
        "account_label": None,
        "webapps_count": 0,
    }
    path = f"/api/me/connections/{listed_connection['key']}"
    assert "encrypted_credentials" not in listed.get_data(as_text=True)
    assert client.get(path).status_code == 405
    assert client.patch(path, json={"name": "Renamed"}).status_code == 405
    assert client.get(path + "/credential-schema").status_code == 404
    assert client.post(path + "/reauthorize").status_code == 404
    assert client.get(path + "/revision").status_code == 404
    assert client.get(path + "/apps").get_json()["data"] == []
    assert client.delete(path).status_code == 204
    assert client.get(path + "/apps").status_code == 404
    assert client.get("/api/me/connections").get_json()["data"] == []


def test_foreign_connection_matches_unknown_http_id(client: FlaskClient) -> None:
    response = client.delete(f"/api/me/connections/{consumer_connection_key(new_connection())}")
    assert response.status_code == 404
    assert response.get_json()["code"] == "connection_not_found"


def test_connection_group_routes_reuse_the_list_key(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    connections = [harness.oauth.finish(harness.oauth.start()) for _ in range(2)]
    with base.sessions.begin() as session:
        session.add_all(
            AppConnection(
                tenant_id=base.context.tenant_id,
                app_id=base.context.app_id,
                workflow_id=base.workflow_id,
                node_id=f"node-{index}",
                end_user_id=base.context.end_user_id,
                provider=connection.provider,
                connection_id=connection.id,
            )
            for index, connection in enumerate(connections)
        )
    listed = client.get("/api/me/connections").get_json()
    assert len(listed["data"]) == 1
    group = listed["data"][0]
    assert group["webapps_count"] == 1
    assert group["connection_type"] == "oauth2"
    assert "apps" not in group
    path = f"/api/me/connections/{group['key']}"
    apps = client.get(path + "/apps?limit=1")
    assert apps.status_code == 200
    assert [app["id"] for app in apps.get_json()["data"]] == [base.context.app_id]
    assert apps.get_json()["has_more"] is False
    assert client.get(path + "/apps?cursor=invalid").status_code == 400
    assert client.get(path + "/apps?limit=0").status_code == 400
    assert client.delete(path).status_code == 204
    assert len(base.auth.revocations) == 2
    assert client.get("/api/me/connections").get_json()["data"] == []


def test_malformed_connection_group_key_does_not_match_routes(client: FlaskClient) -> None:
    path = "/api/me/connections/invalid"
    assert client.get(path + "/apps").status_code == 404
    assert client.delete(path).status_code == 404


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
