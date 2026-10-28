"""Commit the protected snapshot before requesting the lifecycle's durable wait.

C03 owns encrypted storage/readback, SQL acknowledgement and pending categories.
Exceptions deliberately propagate to the native coordinator; a failed barrier
must never manufacture a waiting receipt or swallow an uncommitted pause.
"""

from typing import Protocol

from runtime_contracts.builder.native.contracts import CheckpointRef, NativeTestContextRef, WaitingReceipt
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NativeStatePort


class CheckpointLifecyclePort(Protocol):
    def pause(
        self,
        *,
        ref: NativeTestContextRef,
        checkpoint: CheckpointRef,
        pending_operation_ids: tuple[str, ...],
        expected_generation: int,
    ) -> WaitingReceipt: ...


class NativeCheckpointBridge:
    def __init__(self, *, state: NativeStatePort, lifecycle: CheckpointLifecyclePort):
        self._state, self._lifecycle = state, lifecycle

    def commit_wait(
        self,
        *,
        ref: NativeTestContextRef,
        generation: int,
        payload: NativeCheckpointPayload,
        pending_operation_ids: tuple[str, ...],
    ) -> WaitingReceipt:
        checkpoint = self._state.commit_checkpoint(ref=ref, generation=generation, payload=payload)
        return self._lifecycle.pause(
            ref=ref,
            checkpoint=checkpoint,
            pending_operation_ids=pending_operation_ids,
            expected_generation=generation,
        )
