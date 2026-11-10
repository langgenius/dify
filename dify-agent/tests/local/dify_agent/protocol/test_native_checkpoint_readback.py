"""Private read DTO boundaries; no backend/Redis execution proof."""

import importlib
import importlib.util

import pytest
from pydantic import ValidationError


def module():
    assert importlib.util.find_spec("dify_agent.protocol.native_continuation") is not None, (
        "missing private checkpoint wire"
    )
    return importlib.import_module("dify_agent.protocol.native_continuation")


def read_payload():
    return {
        "ref": {
            "policy_version": "builder-native-test-v1",
            "request_id": "req-1",
            "invocation_id": "inv-1",
            "context_digest": "a" * 64,
        },
        "expected_generation": 7,
        "waiting_event_id": "18446744073709551615-1",
        "config_ref": "config-1",
        "config_digest": "b" * 64,
    }


def test_read_request_preserves_backend_generation_and_selected_event():
    dto = module().ReadNativeCheckpointRequest.model_validate(read_payload())
    assert dto.expected_generation == 7  # Deliberately not an outer local/shared generation.
    assert dto.waiting_event_id == "18446744073709551615-1"
    assert dto.model_dump(mode="json") == read_payload()


@pytest.mark.parametrize(
    "event_id",
    ["0-0", "01-1", "1-01", "-1-0", "1", "1-", "+1-0", "1-0\n", "18446744073709551616-0", "1-18446744073709551616", 1],
)
def test_noncanonical_or_zero_event_selectors_refuse(event_id):
    payload = {**read_payload(), "waiting_event_id": event_id}
    with pytest.raises(ValidationError):
        module().ReadNativeCheckpointRequest.model_validate(payload)


@pytest.mark.parametrize(
    "change",
    [{"expected_generation": True}, {"expected_generation": "7"}, {"acked": True}, {"config_digest": "secret"}],
)
def test_request_does_not_coerce_or_accept_caller_proof(change):
    with pytest.raises(ValidationError):
        module().ReadNativeCheckpointRequest.model_validate({**read_payload(), **change})


def test_checkpoint_data_models_remain_runtime_compatible():
    pure = module()
    from dify_agent.runtime import native_continuation as runtime

    assert runtime.AgentCheckpoint is pure.AgentCheckpoint
    assert runtime.AgentPendingCall is pure.AgentPendingCall
