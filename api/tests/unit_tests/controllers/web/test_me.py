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
from controllers.web import account_admission, bp, me
from models.end_user_connection import AppConnection
from models.model import AppMode
from tests.helpers.consumer import (
    ConsumerHarness,
    consumer_connection_key,
    make_consumer_harness,
    new_consumer_run,
    publish_consumer_app,
)
from tests.helpers.end_user_connection_contract import new_connection


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def client(harness: ConsumerHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    monkeypatch.setattr(me, "application_services", lambda: SimpleNamespace(consumer=harness.service))
    monkeypatch.setattr(account_admission, "application_services", lambda: SimpleNamespace(consumer=harness.service))
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    app.register_blueprint(bp)
    with app.test_client() as client:
        client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, harness.token())
        client.environ_base["HTTP_ORIGIN"] = "http://localhost"
        yield client


@pytest.mark.parametrize(
    "mode",
    [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.WORKFLOW, AppMode.AGENT],
)
def test_http_app_views_favorites_and_timestamps(client: FlaskClient, harness: ConsumerHarness, mode: AppMode) -> None:
    base = harness.oauth.base
    publish_consumer_app(base, mode)
    path = f"/api/me/apps/{base.context.app_id}/favorite"
    assert client.put(path).status_code == 204
    assert client.put(path).status_code == 204
    with base.sessions.begin() as session:
        session.add(new_consumer_run(base, created_at=datetime(2026, 10, 30)))
    harness.record_usage(datetime(2026, 10, 30))
    for view in ("recent", "favorites", "shared"):
        response = client.get(f"/api/me/apps?view={view}&limit=1")
        assert response.status_code == 200
        data = response.get_json()
        assert data["has_more"] is False
        assert data["data"][0]["id"] == base.context.app_id
        assert isinstance(data["data"][0]["last_used_at"], int)
        assert data["data"][0]["mode"] == mode
        assert data["data"][0]["connection_status"] == (
            "not_configured" if mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW) else None
        )
        assert "continuation" not in data["data"][0]
    assert client.delete(path).status_code == 204
    assert client.get("/api/me/apps?view=favorites").get_json()["data"] == []


def test_remove_app_hides_personal_lists_but_preserves_data_and_shared_discovery(
    client: FlaskClient, harness: ConsumerHarness
) -> None:
    base = harness.oauth.base
    harness.record_usage(datetime(2026, 11, 4))
    assert client.put(f"/api/me/apps/{base.context.app_id}/favorite").status_code == 204
    path = f"/api/me/apps/{base.context.app_id}"
    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 204
    assert client.get("/api/me/apps?view=recent").get_json()["data"] == []
    assert client.get("/api/me/apps?view=favorites").get_json()["data"] == []
    assert client.get("/api/me/apps?view=shared").get_json()["data"][0]["id"] == base.context.app_id
    assert client.delete(f"/api/me/apps/{uuid4()}").status_code == 204
    client.environ_base.pop("HTTP_ORIGIN")
    assert client.delete(path).status_code == 403


def test_connections_support_only_query_and_disconnect(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    created = base.service.create_api_key(base.context, base.command())
    providers = client.get("/api/me/connections?limit=1")
    assert providers.status_code == 200
    provider = providers.get_json()["data"][0]
    assert provider["provider"] == created.provider
    assert provider["connections_count"] == 1
    assert provider["label"]["en_US"] == "Calendar"
    assert provider["description"]["en_US"] == "Calendar"
    assert "filename=icon.svg" in provider["icon"]
    assert provider["icon_dark"] is None
    listed = client.get(f"/api/me/connections/providers/{created.provider}/connections?limit=1")
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
    providers = client.get("/api/me/connections").get_json()
    assert providers["data"][0]["connections_count"] == 1
    response = client.get(f"/api/me/connections/providers/{connections[0].provider}/connections")
    listed = response.get_json()
    assert len(listed["data"]) == 1
    group = listed["data"][0]
    assert group["webapps_count"] == 1
    assert group["connection_type"] == "oauth2"
    assert group["account_label"] == "al***@example.com"
    assert "alice@example.com" not in response.get_data(as_text=True)
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


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "cursor=", "provider=other", "unknown=value"])
def test_provider_summary_rejects_invalid_queries(client: FlaskClient, query: str) -> None:
    assert client.get(f"/api/me/connections?{query}").status_code == 400


def test_provider_connection_list_filters_and_validates_cursors(client: FlaskClient, harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    created = [base.service.create_api_key(base.context, base.command()) for _ in range(2)]
    path = f"/api/me/connections/providers/{created[0].provider}/connections"
    first = client.get(path + "?limit=1").get_json()
    assert first["has_more"] is True
    second = client.get(path, query_string={"limit": 1, "cursor": first["next_cursor"]}).get_json()
    assert second["has_more"] is False
    assert {row["key"] for page in (first, second) for row in page["data"]} == {row.id for row in created}
    other_path = "/api/me/connections/providers/vendor/other/calendar/connections"
    assert client.get(other_path).get_json()["data"] == []
    assert client.get(other_path, query_string={"cursor": first["next_cursor"]}).get_json()["data"] == []
    assert client.get(path + "?cursor=invalid").status_code == 400
    assert client.get(path + "?provider=other").status_code == 400


def test_provider_queries_require_account_cookie(client: FlaskClient, harness: ConsumerHarness) -> None:
    client.delete_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN)
    assert client.get("/api/me/connections").status_code == 401
    provider = harness.oauth.providers.controller.entity.identity.name
    assert client.get(f"/api/me/connections/providers/{provider}/connections").status_code == 401


def test_connection_discovery_schema_documents_each_level(client: FlaskClient) -> None:
    schema = client.get("/api/openapi.json").get_json()
    summary = schema["paths"]["/me/connections"]["get"]
    assert {parameter["name"] for parameter in summary["parameters"]} == {"cursor", "limit"}
    assert summary["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ConsumerConnectionProvidersResponse"
    }
    provider_path = schema["paths"]["/me/connections/providers/{provider}/connections"]
    connections = provider_path["get"]
    parameters = [*provider_path.get("parameters", []), *connections["parameters"]]
    assert all(parameter["in"] in {"query", "path"} for parameter in parameters)
    assert {parameter["name"] for parameter in parameters} == {"provider", "cursor", "limit"}
    assert "requestBody" not in connections
    assert "/me/connections/{connection_key}/apps" in schema["paths"]


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
