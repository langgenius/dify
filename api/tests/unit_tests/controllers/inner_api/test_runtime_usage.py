"""Authenticated HTTP contract backed by the real accounting service and DB."""

from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask

from controllers.inner_api import bp as inner_api_bp
from models.agent_sandbox_usage import AgentSandboxUsageEvent
from tests.unit_tests.config_override import config_overrides_context

PROJECT = "431de237-596f-4d59-8a85-20a9846bf243"


@pytest.fixture
def client():
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


def payload():
    return {
        "project_id": PROJECT,
        "events": [
            {
                "id": str(uuid4()),
                "source": "application",
                "type": "operation_observed",
                "timestamp": "2026-09-20T00:01:00Z",
                "payload": {"operation": "pause", "result": True},
            }
        ],
    }


def test_state_requires_inner_auth(client):
    response = client.get(f"/inner/api/agent/sandbox-usage/state?project_id={PROJECT}")
    assert response.status_code == 404


def test_state_exposes_persisted_scope_without_secret_or_environment(client):
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


def test_events_ack_only_after_persisted_and_duplicate_is_idempotent(client, sqlite_session_factory):
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


def test_ingestion_rejects_other_project_and_oversized_batch(client):
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


def test_ingestion_payload_limit(client):
    body = payload()
    body["events"][0]["payload"] = {"oversized": "x" * (1024 * 1024)}
    response = client.post(
        "/inner/api/agent/sandbox-usage/events", json=body, headers={"X-Inner-Api-Key": "test-inner"}
    )
    assert response.status_code == 413
