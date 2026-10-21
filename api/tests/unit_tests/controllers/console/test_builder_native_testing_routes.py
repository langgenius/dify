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


@pytest.mark.parametrize(
    ("suffix", "body"),
    [
        (
            "",
            {
                "schema_version": "builder-native-test-v1",
                "test_input_id": "input",
                "expected_version": True,
                "mode": "native",
                "idempotency_key": "start",
            },
        ),
        (
            "/request/decisions",
            {
                "schema_version": "builder-native-test-v1",
                "pending_operation_id": "pending",
                "decision": "confirm",
                "scope_digest": "a" * 64,
                "expected_version": 1,
                "idempotency_key": "decision",
                "parameters": {"recipient": "changed@example.invalid"},
            },
        ),
        (
            "/request/resume",
            {"schema_version": "builder-native-test-v1", "expected_generation": "0", "idempotency_key": "r"},
        ),
        ("/request/cancel", {"schema_version": "builder-native-test-v1", "idempotency_key": "c", "permit": "forged"}),
    ],
)
def test_native_routes_reject_invalid_payload_before_composition(request_sql_world, suffix, body):
    response = request_sql_world.client.post(BASE + suffix, json=body)
    assert response.status_code == 400
    assert "changed@example.invalid" not in response.get_data(as_text=True)
    assert "forged" not in response.get_data(as_text=True)


def test_native_sse_snapshot_has_reconnect_cursor_and_no_private_payload():
    from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
    from services.dify_builder.wiring import stream_advance_frames

    receipt = NativeTestPublicReceipt(
        request_id="r",
        generation=0,
        version=1,
        status="prepared",
        wait_reason=None,
        native_run_id=None,
        native_status=None,
        pending=(),
        outcome=None,
        evidence_refs=(),
    )
    frames = list(
        stream_advance_frames(
            {"session_id": "s"}, None, False, emit_command_started=False, native_receipts=lambda: (receipt,)
        )
    )
    assert len(frames) == 1
    assert frames[0].startswith("id: ")
    assert '"event": "native_execution"' in frames[0]
    assert '"schema_version": "builder-native-test-v1"' in frames[0]
    assert "context_digest" not in frames[0]


def test_native_sse_reconnect_skips_unchanged_public_snapshot():
    from runtime_contracts.builder.execution import canonical_digest
    from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
    from services.dify_builder.wiring import stream_advance_frames

    receipt = NativeTestPublicReceipt(
        request_id="r",
        generation=0,
        version=1,
        status="prepared",
        wait_reason=None,
        native_run_id=None,
        native_status=None,
        pending=(),
        outcome=None,
        evidence_refs=(),
    )
    cursor = canonical_digest(receipt.model_dump(mode="json"))
    assert (
        list(
            stream_advance_frames(
                {"session_id": "s"},
                None,
                False,
                emit_command_started=False,
                native_receipts=lambda: (receipt,),
                native_cursor=cursor,
            )
        )
        == []
    )


def test_native_input_binding_requires_signed_login(request_sql_world):
    response = request_sql_world.client.get(
        BASE.removesuffix("/native-tests") + "/native-test-input", headers={"Authorization": ""}
    )
    assert response.status_code == 401


def test_native_input_binding_has_only_public_identity(request_sql_world, monkeypatch, mocker):
    from sqlalchemy.orm import sessionmaker

    from controllers.console import dify_builder as controller
    from services.dify_builder.native_testing.input_binding import NativeTestInputBindingService
    from services.dify_builder.native_testing.public_contracts import NativeTestInputBinding

    binding = NativeTestInputBinding(
        test_input_id="input-1", expected_version=3, workflow_id="workflow-1", graph_revision="a" * 64
    )

    def binding_service(*, actor):
        service = NativeTestInputBindingService(
            session_factory=sessionmaker(bind=request_sql_world.registry.get_bind()), actor=actor
        )
        mocker.patch.object(service, "get", return_value=binding)
        return service

    monkeypatch.setattr(controller, "build_native_test_input_binding_service", binding_service)
    response = request_sql_world.client.get(BASE.removesuffix("/native-tests") + "/native-test-input")
    assert response.status_code == 200
    assert response.get_json() == {"data": binding.model_dump(mode="json")}
