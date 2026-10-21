"""Checkpoint barrier delegates persistence and wait categories to actual owners."""

import importlib.util
from typing import NoReturn

import pytest

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import (
    CheckpointRef,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    WaitingReceipt,
    WaitReason,
)
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge

REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)
CP = CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64)


def bridge_class() -> type[NativeCheckpointBridge]:
    module = "services.dify_builder.native_testing.checkpoint_bridge"
    assert importlib.util.find_spec(module) is not None, "checkpoint commit-before-wait barrier is not implemented"
    return NativeCheckpointBridge


def payload(generation: int) -> NativeCheckpointPayload:
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
    def __init__(
        self, events: list[tuple[str, dict[str, object]]], error: BuilderExecutionPolicyError | None = None
    ) -> None:
        self.events, self.error = events, error

    def commit_checkpoint(
        self, *, ref: NativeTestContextRef, generation: int, payload: NativeCheckpointPayload
    ) -> CheckpointRef:
        self.events.append(("commit", {"ref": ref, "generation": generation, "payload": payload}))
        if self.error:
            raise self.error
        return CP

    def load_context(self, *, ref: NativeTestContextRef) -> NoReturn:
        del ref
        raise AssertionError("checkpoint barrier does not read context")

    def read_checkpoint(self, *, ref: NativeTestContextRef, checkpoint: CheckpointRef) -> NoReturn:
        del ref, checkpoint
        raise AssertionError("checkpoint barrier does not read checkpoints")

    def store_result(self, *, ref: NativeTestContextRef, key: OperationKey, result: JsonValue) -> NoReturn:
        del ref, key, result
        raise AssertionError("checkpoint barrier does not store results")

    def load_result(self, *, ref: NativeTestContextRef, result_ref: str) -> NoReturn:
        del ref, result_ref
        raise AssertionError("checkpoint barrier does not read results")


class Lifecycle:
    def __init__(
        self,
        events: list[tuple[str, dict[str, object]]],
        reason: WaitReason,
        error: BuilderExecutionPolicyError | RuntimeError | None = None,
    ) -> None:
        self.events, self.reason, self.error = events, reason, error

    def pause(
        self,
        *,
        ref: NativeTestContextRef,
        checkpoint: CheckpointRef,
        pending_operation_ids: tuple[str, ...],
        expected_generation: int,
    ) -> WaitingReceipt:
        kwargs: dict[str, object] = {
            "ref": ref,
            "checkpoint": checkpoint,
            "pending_operation_ids": pending_operation_ids,
            "expected_generation": expected_generation,
        }
        assert self.events[-1][0] == "commit"
        self.events.append(("pause", kwargs))
        if self.error:
            raise self.error
        return WaitingReceipt(
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            generation=expected_generation,
            checkpoint=checkpoint,
            pending_operation_ids=pending_operation_ids,
            wait_reason=self.reason,
        )


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_two_generation_wait_receipt_preserves_owner_category_and_exact_private_state(reason: WaitReason) -> None:
    events: list[tuple[str, dict[str, object]]] = []
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
def test_storage_encryption_readback_or_sql_ack_failure_never_reaches_pause(code: str) -> None:
    events: list[tuple[str, dict[str, object]]] = []
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
def test_lifecycle_refusal_propagates_without_creating_a_waiting_outcome(code: str) -> None:
    events: list[tuple[str, dict[str, object]]] = []
    bridge = bridge_class()(
        state=State(events), lifecycle=Lifecycle(events, "interaction", BuilderExecutionPolicyError(code))
    )
    with pytest.raises(BuilderExecutionPolicyError, match=code):
        bridge.commit_wait(ref=REF, generation=0, payload=payload(0), pending_operation_ids=("pending",))
    assert [event[0] for event in events] == ["commit", "pause"]


def test_lifecycle_commit_exception_is_not_masked_as_durable_wait() -> None:
    events: list[tuple[str, dict[str, object]]] = []
    bridge = bridge_class()(
        state=State(events), lifecycle=Lifecycle(events, "approval", RuntimeError("sql commit failed"))
    )
    with pytest.raises(RuntimeError, match="sql commit failed"):
        bridge.commit_wait(ref=REF, generation=0, payload=payload(0), pending_operation_ids=("pending",))
