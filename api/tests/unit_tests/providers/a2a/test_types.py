"""Keep the frozen v1 wire sets and strict boundaries after enum conversion."""

import json

import pytest
from pydantic import ValidationError

from providers.a2a.types import MessageRoleV1, MessageV1, ResponseV1, StatusV1, TaskStateV1, strict_json


@pytest.mark.parametrize("role", ["ROLE_USER", "ROLE_AGENT"])
@pytest.mark.parametrize(
    "state",
    [
        "TASK_STATE_SUBMITTED",
        "TASK_STATE_WORKING",
        "TASK_STATE_COMPLETED",
        "TASK_STATE_FAILED",
        "TASK_STATE_CANCELED",
        "TASK_STATE_REJECTED",
        "TASK_STATE_INPUT_REQUIRED",
        "TASK_STATE_AUTH_REQUIRED",
    ],
)
def test_frozen_wire_role_and_state_round_trip_from_plain_strings(role: str, state: str) -> None:
    """Accept existing wire strings through each parser and preserve JSON names."""
    payload = {
        "task": {
            "id": "task-1",
            "contextId": "context-1",
            "status": {"state": state},
            "history": [{"messageId": "message-1", "role": role, "parts": [{"text": "hello"}]}],
        }
    }
    encoded = json.dumps(payload)
    for response in (
        ResponseV1.model_validate(payload),
        ResponseV1.model_validate(strict_json(encoded)),
        ResponseV1.model_validate_json(encoded),
    ):
        assert response.task is not None
        assert isinstance(response.task.status.state, TaskStateV1)
        assert isinstance(response.task.history[0].role, MessageRoleV1)
        assert response.model_dump(mode="json", by_alias=True, exclude_unset=True) == payload


@pytest.mark.parametrize(
    "role",
    ["user", "agent", "ROLE_UNSPECIFIED", "ROLE_SYSTEM", b"ROLE_AGENT", True, 0.3, 0, None, [], {}],
)
def test_message_role_rejects_legacy_unknown_and_non_string_values(role: object) -> None:
    """Preserve rejection of legacy roles and Python values JSON cannot carry."""
    with pytest.raises(ValidationError):
        MessageV1.model_validate({"messageId": "message-1", "role": role, "parts": [{"text": "hello"}]})


@pytest.mark.parametrize(
    "state",
    ["working", "completed", "TASK_STATE_UNSPECIFIED", b"TASK_STATE_COMPLETED", True, 0.3, 0, None, [], {}],
)
def test_task_state_rejects_legacy_unknown_and_non_string_values(state: object) -> None:
    """Preserve rejection of legacy states and prevent string coercion."""
    with pytest.raises(ValidationError):
        StatusV1.model_validate({"state": state})


@pytest.mark.parametrize("role", [MessageRoleV1.USER, MessageRoleV1.AGENT])
def test_existing_role_and_state_members_are_valid_internal_inputs(role: MessageRoleV1) -> None:
    """Keep typed internal construction valid without requiring a JSON detour."""
    message = MessageV1.model_validate({"messageId": "message-1", "role": role, "parts": [{"text": "hello"}]})
    status = StatusV1(state=TaskStateV1.COMPLETED, message=message)
    assert status.state is TaskStateV1.COMPLETED
    assert status.message is not None
    assert status.message.role is role
    assert status.model_dump(mode="json", exclude_unset=True) == {
        "state": "TASK_STATE_COMPLETED",
        "message": {"messageId": "message-1", "role": role.value, "parts": [{"text": "hello"}]},
    }


@pytest.mark.parametrize("invalid_content", [True, 0.3, 1, b"hello"])
def test_enum_conversion_does_not_coerce_message_content(invalid_content: object) -> None:
    """Strict scalar validation outside enum fields remains in force."""
    with pytest.raises(ValidationError):
        MessageV1.model_validate({"messageId": "message-1", "role": "ROLE_AGENT", "parts": [{"text": invalid_content}]})


def test_enum_conversion_keeps_legacy_message_discriminators_forbidden() -> None:
    """An otherwise valid role cannot admit a 0.3-style Message discriminator."""
    with pytest.raises(ValidationError):
        MessageV1.model_validate(
            {"kind": "message", "messageId": "message-1", "role": "ROLE_AGENT", "parts": [{"text": "hello"}]}
        )
