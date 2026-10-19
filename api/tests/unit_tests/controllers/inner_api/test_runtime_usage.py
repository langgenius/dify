"""Authenticated HTTP contract backed by the real accounting service and DB."""

from collections.abc import Iterator
from typing import TypedDict
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from controllers.inner_api import bp as inner_api_bp
from controllers.inner_api import inner_api_ns
from models.agent_sandbox_usage import AgentSandboxUsageEvent
from tests.unit_tests.config_override import config_overrides_context

PROJECT = "431de237-596f-4d59-8a85-20a9846bf243"


class _EventPayload(TypedDict):
    id: str
    source: str
    type: str
    timestamp: str
    payload: dict[str, JsonValue]


class _BatchPayload(TypedDict):
    project_id: str
    events: list[_EventPayload]


@pytest.fixture
def client() -> Iterator[FlaskClient]:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)
    with config_overrides_context(
        PLUGIN_DAEMON_KEY="test-daemon",
        INNER_API_KEY_FOR_PLUGIN="test-inner",
        AGENT_SANDBOX_METERING_ENABLED=True,
        AGENT_SANDBOX_METERING_PROJECT_ID=PROJECT,
        AGENT_SANDBOX_METERING_START_AT="2026-09-20T00:00:00Z",
    ):
        yield app.test_client()


def payload() -> _BatchPayload:
    event_id = str(uuid4())
    return {
        "project_id": PROJECT,
        "events": [
            {
                "id": event_id,
                "source": "provider",
                "type": "sandbox.lifecycle.paused",
                "timestamp": "2026-09-20T00:01:00Z",
                "payload": {
                    "id": event_id,
                    "version": "v2",
                    "type": "sandbox.lifecycle.paused",
                    "timestamp": "2026-09-20T00:01:00Z",
                    "sandboxId": "sandbox-test",
                    "sandboxExecutionId": "execution-test",
                    "sandboxTeamId": PROJECT,
                    "eventData": {
                        "execution": {
                            "started_at": "2026-09-20T00:00:02Z",
                            "execution_time": 12345,
                            "memory_mb": 1024,
                            "vcpu_count": 2,
                        }
                    },
                },
            }
        ],
    }


def test_state_requires_inner_auth(client: FlaskClient) -> None:
    response = client.get(f"/inner/api/agent/sandbox-usage/state?project_id={PROJECT}")
    assert response.status_code == 404


def test_state_exposes_persisted_scope_without_secret_or_environment(client: FlaskClient) -> None:
    response = client.get(
        f"/inner/api/agent/sandbox-usage/state?project_id={PROJECT}", headers={"X-Inner-Api-Key": "test-inner"}
    )
    assert response.status_code == 200
    assert response.json == {
        "enabled": True,
        "project_id": PROJECT,
        "started_at": "2026-09-20T00:00:00Z",
        "checkpoint_at": None,
        "full_scan_at": None,
        "diagnostics": {
            "unresolved_events": 0,
            "conflict_events": 0,
            "open_executions": 0,
            "unattributed_executions": 0,
        },
    }


@pytest.mark.parametrize("query", ["", "?project_id=", f"?project_id={PROJECT}&unexpected=value"])
def test_state_rejects_invalid_query_before_activation(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], query: str
) -> None:
    response = client.get(f"/inner/api/agent/sandbox-usage/state{query}", headers={"X-Inner-Api-Key": "test-inner"})
    assert response.status_code == 400
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "sandbox_usage_invalid_request"
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxUsageEvent)) == 0


def test_state_rejects_project_outside_allowlist_without_activation(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    response = client.get(
        "/inner/api/agent/sandbox-usage/state?project_id=other-project", headers={"X-Inner-Api-Key": "test-inner"}
    )
    assert response.status_code == 403
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "sandbox_metering_project_not_allowed"
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxUsageEvent)) == 0


def test_state_reports_start_change_conflict_and_preserves_activation(client: FlaskClient) -> None:
    url = f"/inner/api/agent/sandbox-usage/state?project_id={PROJECT}"
    headers = {"X-Inner-Api-Key": "test-inner"}
    original = client.get(url, headers=headers)
    assert original.status_code == 200
    with config_overrides_context(AGENT_SANDBOX_METERING_START_AT="2026-09-21T00:00:00Z"):
        changed = client.get(url, headers=headers)
    assert changed.status_code == 409
    body = changed.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "sandbox_metering_start_is_immutable"
    restored = client.get(url, headers=headers)
    assert restored.status_code == 200
    assert restored.json == original.json


def test_state_reports_invalid_start_as_configuration_error(client: FlaskClient) -> None:
    with config_overrides_context(AGENT_SANDBOX_METERING_START_AT="2026-09-20T00:00:00"):
        response = client.get(
            f"/inner/api/agent/sandbox-usage/state?project_id={PROJECT}", headers={"X-Inner-Api-Key": "test-inner"}
        )
    assert response.status_code == 503
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "sandbox_metering_start_not_configured"


def test_events_ack_only_after_persisted_and_duplicate_is_idempotent(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    body = payload()
    for expected in (
        {"accepted": 1, "duplicates": 0, "conflicts": 0, "ignored": 0},
        {"accepted": 0, "duplicates": 1, "conflicts": 0, "ignored": 0},
    ):
        response = client.post(
            "/inner/api/agent/sandbox-usage/events", json=body, headers={"X-Inner-Api-Key": "test-inner"}
        )
        assert response.status_code == 200
        assert response.json == expected
    with sqlite_session_factory() as session:
        assert (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(AgentSandboxUsageEvent)
                .where(AgentSandboxUsageEvent.source_event_id == body["events"][0]["id"])
            )
            == 1
        )


def test_ingestion_rejects_other_project_and_oversized_batch(client: FlaskClient) -> None:
    body = payload()
    body["project_id"] = "other-project"
    response = client.post(
        "/inner/api/agent/sandbox-usage/events", json=body, headers={"X-Inner-Api-Key": "test-inner"}
    )
    assert response.status_code == 403
    body = payload()
    body["events"] *= 101
    response = client.post(
        "/inner/api/agent/sandbox-usage/events", json=body, headers={"X-Inner-Api-Key": "test-inner"}
    )
    assert response.status_code == 400


def test_ingestion_payload_limit(client: FlaskClient) -> None:
    body = payload()
    body["events"][0]["payload"] = {"oversized": "x" * (1024 * 1024)}
    response = client.post(
        "/inner/api/agent/sandbox-usage/events", json=body, headers={"X-Inner-Api-Key": "test-inner"}
    )
    assert response.status_code == 413


def test_schema_and_http_exclude_business_operation_envelope_fields(client: FlaskClient) -> None:
    schema = inner_api_ns.models["SandboxUsageEvent"].__schema__
    assert set(schema["properties"]) == {"id", "source", "type", "timestamp", "sandbox_id", "execution_id", "payload"}
    assert schema["additionalProperties"] is False
    body = payload()
    response = client.post(
        "/inner/api/agent/sandbox-usage/events",
        json={**body, "events": [{**body["events"][0], "allocation_id": str(uuid4())}]},
        headers={"X-Inner-Api-Key": "test-inner"},
    )
    assert response.status_code == 400
