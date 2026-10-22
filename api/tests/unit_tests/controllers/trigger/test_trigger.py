"""Trigger capability failures exercise the real HTTP, SQL and daemon boundaries."""

import json
from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine

from controllers.trigger.trigger import trigger_endpoint
from models.trigger import TriggerSubscription
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


@pytest.fixture
def endpoint_harness(harness: _Harness) -> _Harness:
    harness.app.add_url_rule("/triggers/plugin/<string:endpoint_id>", view_func=trigger_endpoint, methods=["POST"])
    return harness


@pytest.mark.parametrize("endpoint_id", ["not-a-uuid", "123e4567-e89b-12d3-a456-426614174000"])
def test_invalid_endpoint_preserves_json_error_contract(endpoint_id: str) -> None:
    app = Flask(__name__)
    app.add_url_rule("/triggers/plugin/<string:endpoint_id>", view_func=trigger_endpoint, methods=["POST"])

    response = app.test_client().post(f"/triggers/plugin/{endpoint_id}", json={})

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.data == b'{"error":"Endpoint not found"}'
    assert response.mimetype == "application/json"
    assert response.headers["Cache-Control"] == "no-store"


def test_subscription_query_failure_preserves_text_error_without_plugin_lookup(
    endpoint_harness: _Harness, daemon: _Daemon, sqlite_engine: Engine
) -> None:
    TriggerSubscription.__table__.drop(sqlite_engine)

    response = endpoint_harness.client.post(f"/triggers/plugin/{uuid4()}", json={})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.data == b"Failed to get subscription by endpoint"
    assert response.content_type == "text/html; charset=utf-8"
    assert daemon.requests == []


def test_provider_load_failure_preserves_text_error_after_subscription_transaction_closes(
    endpoint_harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _add_subscription(endpoint_harness)
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    response = Context().run(endpoint_harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", json={})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.data == b"Failed to get subscription by endpoint"
    assert response.content_type == "text/html; charset=utf-8"
    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"
    assert not daemon.requests[0].open_transactions


@pytest.mark.parametrize(
    ("error_type", "expected_status", "expected_body"),
    [
        pytest.param("PluginNotFoundError", HTTPStatus.NOT_FOUND, b"Trigger provider not found", id="plugin-not-found"),
        pytest.param(
            "PluginDaemonInternalServerError",
            HTTPStatus.INTERNAL_SERVER_ERROR,
            b"Failed to get subscription by endpoint",
            id="daemon-failure",
        ),
    ],
)
def test_provider_metadata_daemon_errors_reach_http_mapping_after_subscription_transaction_closes(
    endpoint_harness: _Harness,
    daemon: _Daemon,
    error_type: str,
    expected_status: HTTPStatus,
    expected_body: bytes,
) -> None:
    subscription = _add_subscription(endpoint_harness)
    daemon.get_response_code = -500
    daemon.get_response_message = json.dumps({"error_type": error_type, "message": "provider unavailable"})

    response = Context().run(endpoint_harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", json={})

    assert response.status_code == expected_status
    assert response.data == expected_body
    assert response.content_type == "text/html; charset=utf-8"
    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"
    assert not daemon.requests[0].open_transactions


def test_invalid_persisted_provider_is_load_failure_not_missing_plugin(
    endpoint_harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _add_subscription(endpoint_harness, provider_id="not/a/valid/provider")

    response = Context().run(endpoint_harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", json={})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.data == b"Failed to get subscription by endpoint"
    assert response.content_type == "text/html; charset=utf-8"
    assert daemon.requests == []
