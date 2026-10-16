"""Checkpoint barrier delegates persistence and wait categories to actual owners."""

import importlib

import pytest

from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.contracts import CheckpointRef, NativeTestContextRef, WaitingReceipt
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload

REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)
CP = CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64)


def bridge_class():
    module = "services.dify_builder.native_testing.checkpoint_bridge"
    assert importlib.util.find_spec(module) is not None, "checkpoint commit-before-wait barrier is not implemented"
    return importlib.import_module(module).NativeCheckpointBridge


def payload(generation):
    return NativeCheckpointPayload(
        schema_version="1",
        native_run_id="run",
        generation=generation,
        generate_entity_json='{"private":"history"}',
        graph_runtime_state_json='{"frame":"original"}',
        response_stream_filter_json='{"buffer":[1]}',
        node_journals=(),
        child_refs=(),
        input_result_refs=(),
    )


class State:
    def __init__(self, events, error=None):
        self.events, self.error = events, error

    def commit_checkpoint(self, **kwargs):
        self.events.append(("commit", kwargs))
        if self.error:
            raise self.error
        return CP


class Lifecycle:
    def __init__(self, events, reason, error=None):
        self.events, self.reason, self.error = events, reason, error

    def pause(self, **kwargs):
        assert self.events[-1][0] == "commit"
        self.events.append(("pause", kwargs))
        if self.error:
            raise self.error
        return WaitingReceipt(
            request_id=kwargs["ref"].request_id,
            invocation_id=kwargs["ref"].invocation_id,
            generation=kwargs["expected_generation"],
            checkpoint=kwargs["checkpoint"],
            pending_operation_ids=kwargs["pending_operation_ids"],
            wait_reason=self.reason,
        )


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_two_generation_wait_receipt_preserves_owner_category_and_exact_private_state(reason):
    events = []
    bridge = bridge_class()(state=State(events), lifecycle=Lifecycle(events, reason))
    for generation in (0, 1):
        saved = payload(generation)
        receipt = bridge.commit_wait(ref=REF, generation=generation, payload=saved, pending_operation_ids=("pending",))
        assert receipt.wait_reason == reason
        assert receipt.generation == generation
        assert events[-2] == ("commit", {"ref": REF, "generation": generation, "payload": saved})
        assert events[-1] == (
            "pause",
            {"ref": REF, "checkpoint": CP, "pending_operation_ids": ("pending",), "expected_generation": generation},
        )


@pytest.mark.parametrize(
    "code",
    [
        "checkpoint_unavailable",
        "native_payload_invalid",
        "native_payload_conflict",
        "native_owner_mismatch",
        "native_child_owner_mismatch",
        "native_generation_conflict",
    ],
)
def test_storage_encryption_readback_or_sql_ack_failure_never_reaches_pause(code):
    events = []
    bridge = bridge_class()(
        state=State(events, BuilderExecutionPolicyError(code)), lifecycle=Lifecycle(events, "approval")
    )
    with pytest.raises(BuilderExecutionPolicyError, match=code):
        bridge.commit_wait(ref=REF, generation=0, payload=payload(0), pending_operation_ids=("pending",))
    assert [event[0] for event in events] == ["commit"]


@pytest.mark.parametrize(
    "code",
    [
        "checkpoint_unavailable",
        "native_generation_conflict",
        "native_pending_mismatch",
        "native_child_wait_uncommitted",
    ],
)
def test_lifecycle_refusal_propagates_without_creating_a_waiting_outcome(code):
    events = []
    bridge = bridge_class()(
        state=State(events), lifecycle=Lifecycle(events, "interaction", BuilderExecutionPolicyError(code))
    )
    with pytest.raises(BuilderExecutionPolicyError, match=code):
        bridge.commit_wait(ref=REF, generation=0, payload=payload(0), pending_operation_ids=("pending",))
    assert [event[0] for event in events] == ["commit", "pause"]


def test_lifecycle_commit_exception_is_not_masked_as_durable_wait():
    events = []
    bridge = bridge_class()(
        state=State(events), lifecycle=Lifecycle(events, "approval", RuntimeError("sql commit failed"))
    )
    with pytest.raises(RuntimeError, match="sql commit failed"):
        bridge.commit_wait(ref=REF, generation=0, payload=payload(0), pending_operation_ids=("pending",))
