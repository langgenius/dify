import hashlib
import hmac
from typing import Protocol

from models.workflow_handoff import (
    RagPipelineHandoffGroupMetadata,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.workflow_handoff_repository import (
    WorkflowHandoffPreparationCancelledError,
    WorkflowRunHandoffRepository,
)

WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION = "workflow-resumption-context/v1"
_WORKFLOW_HANDOFF_STORAGE_PREFIX = "workflow-run-handoffs"


class WorkflowHandoffObjectStorage(Protocol):
    def save(self, filename: str, data: bytes): ...

    def load_once(self, filename: str) -> bytes: ...

    def delete(self, filename: str): ...


class WorkflowHandoffSnapshotError(RuntimeError):
    pass


class UnsupportedWorkflowHandoffSnapshotVersionError(WorkflowHandoffSnapshotError):
    pass


class WorkflowHandoffSnapshotIntegrityError(WorkflowHandoffSnapshotError):
    pass


class WorkflowHandoffService:
    """Store and verify workflow checkpoints around durable handoff records.

    Object storage is deliberately accessed outside repository transactions. A
    PREPARING row is committed first so Stop can fence an upload in progress.
    The deterministic content-addressed key keeps retries idempotent.
    """

    def __init__(
        self,
        *,
        repository: WorkflowRunHandoffRepository,
        storage: WorkflowHandoffObjectStorage,
        supported_schema_versions: frozenset[str] | None = None,
    ):
        self._repository = repository
        self._storage = storage
        self._supported_schema_versions = (
            frozenset({WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION})
            if supported_schema_versions is None
            else supported_schema_versions
        )

    def create_prepared_from_state(
        self,
        *,
        workflow_run_id: str,
        task_id: str,
        serialized_state: str | bytes,
        resume_route: WorkflowHandoffResumeRoute,
        source_worker_id: str,
        rag_group_metadata: RagPipelineHandoffGroupMetadata | None = None,
        snapshot_schema_version: str = WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
    ) -> WorkflowRunHandoff:
        if not source_worker_id:
            raise ValueError("source_worker_id must not be empty")
        if not task_id:
            raise ValueError("task_id must not be empty")
        if snapshot_schema_version not in self._supported_schema_versions:
            raise UnsupportedWorkflowHandoffSnapshotVersionError(
                f"Unsupported workflow handoff snapshot schema: {snapshot_schema_version}"
            )

        payload = serialized_state.encode() if isinstance(serialized_state, str) else serialized_state
        checksum = hashlib.sha256(payload).hexdigest()
        object_key = self._snapshot_object_key(
            workflow_run_id=workflow_run_id,
            source_worker_id=source_worker_id,
            resume_route=resume_route,
            schema_version=snapshot_schema_version,
            checksum=checksum,
        )

        handoff = self._repository.create_preparing(
            workflow_run_id=workflow_run_id,
            task_id=task_id,
            snapshot_object_key=object_key,
            snapshot_schema_version=snapshot_schema_version,
            snapshot_checksum=checksum,
            snapshot_size_bytes=len(payload),
            resume_route=resume_route,
            source_worker_id=source_worker_id,
            rag_group_metadata=rag_group_metadata,
        )
        if handoff.state == WorkflowHandoffState.FAILED:
            raise WorkflowHandoffPreparationCancelledError(
                f"Workflow handoff preparation was cancelled: handoff_id={handoff.id}"
            )
        # An ambiguous finish commit is recovered by replaying create_preparing,
        # which returns the identical already-PREPARED row. The object was saved
        # before that commit, so no second upload is necessary.
        if handoff.state != WorkflowHandoffState.PREPARING:
            return handoff

        self._storage.save(object_key, payload)
        # Do not delete this deterministic object when finish raises. The commit
        # may have succeeded, and deleting it would corrupt an idempotent replay.
        prepared = self._repository.finish_preparing(
            handoff_id=handoff.id,
            generation=handoff.generation,
        )
        if prepared is None:
            raise WorkflowHandoffPreparationCancelledError(
                f"Workflow handoff preparation was cancelled: handoff_id={handoff.id}"
            )
        return prepared

    def create_ready_from_state(
        self,
        *,
        workflow_run_id: str,
        task_id: str,
        serialized_state: str | bytes,
        resume_route: WorkflowHandoffResumeRoute,
        source_worker_id: str,
        rag_group_metadata: RagPipelineHandoffGroupMetadata | None = None,
        snapshot_schema_version: str = WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
    ) -> WorkflowRunHandoff:
        """Compatibility alias; newly persisted rows intentionally remain PREPARED.

        Callers should migrate to :meth:`create_prepared_from_state`. Keeping the
        alias avoids making a rolling deploy depend on an atomic code rollout.
        """
        return self.create_prepared_from_state(
            workflow_run_id=workflow_run_id,
            task_id=task_id,
            serialized_state=serialized_state,
            resume_route=resume_route,
            source_worker_id=source_worker_id,
            rag_group_metadata=rag_group_metadata,
            snapshot_schema_version=snapshot_schema_version,
        )

    def load_and_verify_state(self, handoff: WorkflowRunHandoff) -> bytes:
        if handoff.snapshot_schema_version not in self._supported_schema_versions:
            raise UnsupportedWorkflowHandoffSnapshotVersionError(
                f"Unsupported workflow handoff snapshot schema: {handoff.snapshot_schema_version}"
            )

        payload = self._storage.load_once(handoff.snapshot_object_key)
        if len(payload) != handoff.snapshot_size_bytes:
            raise WorkflowHandoffSnapshotIntegrityError(
                f"Workflow handoff snapshot size mismatch for {handoff.id}: "
                f"expected={handoff.snapshot_size_bytes}, actual={len(payload)}"
            )
        checksum = hashlib.sha256(payload).hexdigest()
        if not hmac.compare_digest(checksum, handoff.snapshot_checksum):
            raise WorkflowHandoffSnapshotIntegrityError(f"Workflow handoff snapshot checksum mismatch for {handoff.id}")
        return payload

    def delete_terminal_snapshot(self, handoff: WorkflowRunHandoff) -> None:
        if handoff.state not in {WorkflowHandoffState.RESUMED, WorkflowHandoffState.FAILED}:
            raise ValueError(f"Cannot delete snapshot for active handoff {handoff.id}")
        self._storage.delete(handoff.snapshot_object_key)

    @staticmethod
    def _snapshot_object_key(
        *,
        workflow_run_id: str,
        source_worker_id: str,
        resume_route: WorkflowHandoffResumeRoute,
        schema_version: str,
        checksum: str,
    ) -> str:
        worker_digest = hashlib.sha256(source_worker_id.encode()).hexdigest()[:16]
        schema_digest = hashlib.sha256(schema_version.encode()).hexdigest()[:16]
        # The route is part of repository idempotency. Include it in the object
        # identity as well: if the same worker accidentally reports the same
        # checkpoint under a competing route, cleanup of the rejected write must
        # never delete the blob referenced by the already-committed handoff.
        return (
            f"{_WORKFLOW_HANDOFF_STORAGE_PREFIX}/{workflow_run_id}/"
            f"{worker_digest}-{resume_route.value}-{schema_digest}-{checksum}.json"
        )


__all__ = [
    "WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION",
    "UnsupportedWorkflowHandoffSnapshotVersionError",
    "WorkflowHandoffObjectStorage",
    "WorkflowHandoffPreparationCancelledError",
    "WorkflowHandoffService",
    "WorkflowHandoffSnapshotError",
    "WorkflowHandoffSnapshotIntegrityError",
]
