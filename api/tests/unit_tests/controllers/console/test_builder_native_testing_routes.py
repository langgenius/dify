"""Authenticated wrappers, strict payload and public schema regression."""

import pytest

from tests.unit_tests.controllers.console.test_dify_builder_routes import (
    request_sql_world as request_sql_world,  # noqa: PLC0414
)

BASE = "/console/api/dify-builder/sessions/session-1/native-tests"


def test_native_route_requires_signed_login(request_sql_world):
    response = request_sql_world.client.post(BASE, json={}, headers={"Authorization": ""})
    assert response.status_code == 401


def test_native_route_requires_csrf(request_sql_world):
    response = request_sql_world.client.post(BASE, json={}, headers={"X-CSRF-Token": ""})
    assert response.status_code == 401


@pytest.mark.parametrize("suffix,body", [
    ("", {"schema_version": "builder-native-test-v1", "test_input_id": "input", "expected_version": True,
          "mode": "native", "idempotency_key": "start"}),
    ("/request/decisions", {"schema_version": "builder-native-test-v1", "pending_operation_id": "pending",
                           "decision": "confirm", "scope_digest": "a" * 64, "expected_version": 1,
                           "idempotency_key": "decision", "parameters": {"recipient": "changed@example.invalid"}}),
    ("/request/resume", {"schema_version": "builder-native-test-v1", "expected_generation": "0", "idempotency_key": "r"}),
    ("/request/cancel", {"schema_version": "builder-native-test-v1", "idempotency_key": "c", "permit": "forged"}),
])
def test_native_routes_reject_invalid_payload_before_composition(request_sql_world, suffix, body):
    response = request_sql_world.client.post(BASE + suffix, json=body)
    assert response.status_code == 400
    assert "changed@example.invalid" not in response.get_data(as_text=True)
    assert "forged" not in response.get_data(as_text=True)
