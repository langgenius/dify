"""A successor is exact immutable data, never an execution permit."""

import hashlib
import json

import pytest
from pydantic import ValidationError

from dify_agent import protocol


def successor_payload() -> dict[str, object]:
    return dict(
        protocol_version=1,
        attempt_id="a" * 64,
        parent_node=dict(
            ref=dict(
                policy_version="builder-native-test-v1",
                request_id="request",
                invocation_id="invocation",
                context_digest="b" * 64,
            ),
            execution_id="00000000-0000-0000-0000-000000000001",
            input_result_ref="input",
            input_digest="c" * 64,
        ),
        agent_run_id="child",
        expected_parent_generation=2,
        expected_agent_generation=3,
        predecessor=dict(
            binding_id="old-b",
            workspace_id="old-w",
            binding_ref="old-b:old-w",
            workspace_ref="old-w",
            workspace_generation=0,
            association_object_ref="old-assoc",
            config_ref="old-config",
            config_digest="d" * 64,
        ),
        successor=dict(
            binding_id="new-b",
            workspace_id="new-w",
            binding_ref="new-b:new-w",
            workspace_ref="new-w",
            workspace_generation=1,
            association_object_ref="new-assoc",
            config_ref="new-config",
            config_digest="e" * 64,
        ),
        predecessor_checkpoint=dict(checkpoint_id="old-cp", payload_digest="f" * 64),
        successor_checkpoint=dict(checkpoint_id="new-cp", payload_digest="1" * 64),
        predecessor_waiting_event_id="1-0",
        reconstruction_object_ref="manifest",
        reconstruction_digest="2" * 64,
        pending_operation_substitutions=(dict(predecessor_operation_id="old-op", successor_operation_id="new-op"),),
    )


def test_successor_roundtrip_and_handoff_binding() -> None:
    successor = protocol.AgentRecoverySuccessor.model_validate(successor_payload())
    request = protocol.InstallConfirmedRecoverySuccessorRequest(
        successor=successor,
        successor_object_ref="protected",
        successor_digest=hashlib.sha256(
            json.dumps(
                successor.model_dump(mode="json"),
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
                allow_nan=False,
            ).encode()
        ).hexdigest(),
    )
    assert protocol.InstallConfirmedRecoverySuccessorRequest.model_validate_json(request.model_dump_json()) == request


@pytest.mark.parametrize(
    "field,value",
    [
        ("protocol_version", 2),
        ("expected_agent_generation", True),
        ("attempt_id", "bad"),
        ("predecessor_waiting_event_id", "0-0"),
        ("secret", "credential"),
    ],
)
def test_successor_rejects_invalid_or_unknown_fields(field: str, value: object) -> None:
    payload = successor_payload()
    payload[field] = value
    with pytest.raises(ValidationError):
        protocol.AgentRecoverySuccessor.model_validate(payload)


def test_successor_requires_fresh_workspace_and_unique_pending_links() -> None:
    payload = successor_payload()
    payload["successor"] = payload["predecessor"]
    with pytest.raises(ValidationError):
        protocol.AgentRecoverySuccessor.model_validate(payload)
    payload = successor_payload()
    payload["pending_operation_substitutions"] = (
        dict(predecessor_operation_id="old", successor_operation_id="new"),
        dict(predecessor_operation_id="old", successor_operation_id="other"),
    )
    with pytest.raises(ValidationError):
        protocol.AgentRecoverySuccessor.model_validate(payload)


def test_handoff_rejects_relation_digest_mismatch() -> None:
    successor = protocol.AgentRecoverySuccessor.model_validate(successor_payload())
    with pytest.raises(ValidationError):
        protocol.InstallConfirmedRecoverySuccessorRequest(
            successor=successor, successor_object_ref="protected", successor_digest="0" * 64
        )
