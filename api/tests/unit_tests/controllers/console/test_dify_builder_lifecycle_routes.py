"""Lifecycle wire contracts use explicit confirmation and no graph revision."""

from inspect import unwrap

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console import dify_builder as routes
from controllers.console import dify_builder_fields as schemas
from core.dify_builder.models import Actor
from tests.unit_tests.controllers.console.test_dify_builder_routes import _account, _route_service


def test_clear_payload_requires_explicit_confirmation_and_rejects_graph_revision() -> None:
    assert hasattr(schemas, "DifyBuilderClearConversationPayload")
    payload_type = schemas.DifyBuilderClearConversationPayload
    valid = {"base_version": 3, "client_action_id": "clear-3", "confirmed": True}
    assert payload_type.model_validate(valid).confirmed is True
    for invalid in (
        {"base_version": 3, "client_action_id": "clear-3"},
        {**valid, "confirmed": False},
        {**valid, "confirmed": 1},
        {**valid, "base_version": True},
        {**valid, "base_version": 0},
        {**valid, "base_app_revision": "must-not-be-read"},
    ):
        with pytest.raises(ValidationError):
            payload_type.model_validate(invalid)


@pytest.mark.parametrize("operation", ["clear", "abandon"])
def test_lifecycle_routes_return_only_the_lifecycle_receipt(operation: str, monkeypatch: pytest.MonkeyPatch) -> None:
    assert hasattr(routes, "DifyBuilderConversationClearApi")
    assert hasattr(routes, "DifyBuilderTaskAbandonApi")
    service = _route_service()
    calls = []
    receipt = {
        "session_id": "s1",
        "version": 4,
        "last_command_id": "lifecycle-3",
        "task_id": "s1:0",
        "task_status": "abandoned",
        "settlement": "settled",
        "conversation_cleared": operation == "clear",
        "conversation_last_seq": -1,
    }

    def control(session_id, actor, **kwargs):
        calls.append((session_id, actor, kwargs))
        return receipt

    monkeypatch.setattr(
        service, operation + "_conversation" if operation == "clear" else "abandon_task", control, raising=False
    )
    monkeypatch.setattr(routes, "build_service", lambda: service)
    body = {"base_version": 3, "client_action_id": "lifecycle-3", "expected_task_id": "s1:0"}
    if operation == "clear":
        body["confirmed"] = True
    resource = routes.DifyBuilderConversationClearApi if operation == "clear" else routes.DifyBuilderTaskAbandonApi
    with Flask(__name__).test_request_context(json=body):
        result = unwrap(resource.post)(object(), "ten-1", _account(), "s1")
    assert result == receipt
    assert calls == [("s1", Actor(account_id="acc-1", tenant_id="ten-1"), body)]
    assert "app_revision" not in result
    assert "conversation" not in result


def test_fix_intake_payload_requires_exactly_one_failure_source() -> None:
    assert hasattr(schemas, "DifyBuilderFixIntentPayload")
    payload_type = schemas.DifyBuilderFixIntentPayload
    base = {"client_action_id": "fix-1", "base_version": 1}
    assert payload_type.model_validate({**base, "failed_run_id": "native-failed"}).failed_run_id == "native-failed"
    for invalid in (base, {**base, "failed_run_id": ""}, {**base, "origin_task_id": "forged"}):
        with pytest.raises(ValidationError):
            payload_type.model_validate(invalid)
