from datetime import datetime, timedelta
from typing import cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import Table
from sqlalchemy.orm import Session, sessionmaker

import repositories.sqlalchemy_workflow_handoff_repository as handoff_repository_module
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileTransferMethod, FileType
from models.dataset import Document
from models.enums import (
    AppTriggerType,
    ConversationFromSource,
    CreatorUserRole,
    IndexingStatus,
    MessageStatus,
    WorkflowTriggerStatus,
)
from models.model import AppMode, Conversation, Message, MessageFile, UploadFile
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowRun
from models.workflow_handoff import (
    RagPipelineHandoffGroupMetadata,
    RagPipelineQueueKind,
    WorkflowHandoffCancellation,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffSnapshotGC,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.sqlalchemy_workflow_handoff_repository import (
    ActiveWorkflowRunHandoffError,
    SQLAlchemyWorkflowRunHandoffRepository,
    WorkflowRunNotFoundForHandoffError,
    WorkflowRunNotResumableForHandoffError,
)
from repositories.workflow_handoff_repository import (
    WorkflowHandoffPreparationCancelledError,
    WorkflowHandoffTerminalOwnershipError,
    WorkflowHandoffTerminalScope,
)

NOW = datetime(2026, 7, 28, 12, 0, 0)
FAR_FUTURE = datetime(2100, 1, 1)
RUN_ID = str(uuid4())
APP_ID = str(uuid4())
TENANT_ID = str(uuid4())
WORKFLOW_ID = str(uuid4())
WORKFLOW_RUN_TABLE = cast(Table, WorkflowRun.__table__)
WORKFLOW_RUN_HANDOFF_TABLE = cast(Table, WorkflowRunHandoff.__table__)
WORKFLOW_HANDOFF_CANCELLATION_TABLE = cast(Table, WorkflowHandoffCancellation.__table__)
WORKFLOW_HANDOFF_SNAPSHOT_GC_TABLE = cast(Table, WorkflowHandoffSnapshotGC.__table__)
CONVERSATION_TABLE = cast(Table, Conversation.__table__)
MESSAGE_TABLE = cast(Table, Message.__table__)
UPLOAD_FILE_TABLE = cast(Table, UploadFile.__table__)
MESSAGE_FILE_TABLE = cast(Table, MessageFile.__table__)
WORKFLOW_TRIGGER_LOG_TABLE = cast(Table, WorkflowTriggerLog.__table__)
DOCUMENT_TABLE = cast(Table, Document.__table__)


@pytest.fixture
def repository() -> SQLAlchemyWorkflowRunHandoffRepository:
    engine = sa.create_engine("sqlite:///:memory:")
    WORKFLOW_RUN_TABLE.create(engine)
    WORKFLOW_RUN_HANDOFF_TABLE.create(engine)
    WORKFLOW_HANDOFF_CANCELLATION_TABLE.create(engine)
    WORKFLOW_HANDOFF_SNAPSHOT_GC_TABLE.create(engine)
    CONVERSATION_TABLE.create(engine)
    MESSAGE_TABLE.create(engine)
    UPLOAD_FILE_TABLE.create(engine)
    MESSAGE_FILE_TABLE.create(engine)
    WORKFLOW_TRIGGER_LOG_TABLE.create(engine)
    DOCUMENT_TABLE.create(engine)
    with engine.begin() as connection:
        connection.execute(
            WORKFLOW_RUN_TABLE.insert(),
            {
                "id": RUN_ID,
                "tenant_id": TENANT_ID,
                "app_id": APP_ID,
                "workflow_id": WORKFLOW_ID,
                "type": "workflow",
                "triggered_from": "app-run",
                "version": "1",
                "status": "running",
                "created_by_role": "account",
                "created_by": str(uuid4()),
                "created_at": NOW - timedelta(seconds=60),
            },
        )
    return SQLAlchemyWorkflowRunHandoffRepository(sessionmaker(bind=engine, class_=Session, expire_on_commit=False))


def _create_prepared(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    *,
    object_key: str = "workflow-handoffs/run/checkpoint.bin",
    resume_route: WorkflowHandoffResumeRoute = WorkflowHandoffResumeRoute.WORKFLOW,
    rag_group_metadata: RagPipelineHandoffGroupMetadata | None = None,
) -> WorkflowRunHandoff:
    return repository.create_prepared(
        workflow_run_id=RUN_ID,
        task_id="task-1",
        snapshot_object_key=object_key,
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:0123456789abcdef",
        snapshot_size_bytes=128,
        resume_route=resume_route,
        source_worker_id="worker-old",
        rag_group_metadata=rag_group_metadata,
    )


def _create_ready(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    *,
    object_key: str = "workflow-handoffs/run/checkpoint.bin",
    resume_route: WorkflowHandoffResumeRoute = WorkflowHandoffResumeRoute.WORKFLOW,
    rag_group_metadata: RagPipelineHandoffGroupMetadata | None = None,
) -> WorkflowRunHandoff:
    prepared = _create_prepared(
        repository,
        object_key=object_key,
        resume_route=resume_route,
        rag_group_metadata=rag_group_metadata,
    )
    activated = repository.activate_latest_prepared_by_task_id(task_id=prepared.task_id, activated_at=NOW)
    assert activated is not None
    return activated


def _mark_resumed(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    handoff: WorkflowRunHandoff,
) -> None:
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=NOW,
    )


def _terminal_scope(route: WorkflowHandoffResumeRoute) -> WorkflowHandoffTerminalScope:
    return WorkflowHandoffTerminalScope(
        workflow_run_id=RUN_ID,
        task_id="task-1",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        workflow_id=WORKFLOW_ID,
        resume_route=route,
    )


def _get_workflow_run(repository: SQLAlchemyWorkflowRunHandoffRepository) -> WorkflowRun:
    with repository._session_factory() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        session.expunge(workflow_run)
        return workflow_run


def test_create_prepared_allocates_monotonic_generation_and_persists_snapshot_metadata(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    first = _create_ready(repository)
    claim = repository.claim(
        handoff_id=first.id,
        generation=first.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=first.id,
        generation=first.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=NOW,
    )
    second = _create_prepared(repository, object_key="workflow-handoffs/run/checkpoint-2.bin")

    assert first.generation == 1
    assert second.generation == 2
    assert first.task_id == "task-1"
    assert first.state == WorkflowHandoffState.READY
    assert second.state == WorkflowHandoffState.PREPARED
    assert first.snapshot_schema_version == "graph-runtime-state/v1"
    assert first.snapshot_checksum == "sha256:0123456789abcdef"
    assert first.snapshot_size_bytes == 128
    assert repository.get_latest_by_run(RUN_ID).id == second.id  # type: ignore[union-attr]
    with repository._session_factory() as session:
        gc_record = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == first.snapshot_object_key
            )
        )
        assert gc_record is not None
        assert gc_record.upload_completed_at is not None


def test_create_prepared_is_idempotent_for_same_checkpoint_and_rejects_competing_active_checkpoint(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    first = _create_prepared(repository)

    replay = _create_prepared(repository)
    assert replay.id == first.id
    assert replay.generation == first.generation
    with pytest.raises(ActiveWorkflowRunHandoffError):
        _create_prepared(repository, object_key="workflow-handoffs/run/different-checkpoint.bin")


def test_create_prepared_rejects_unknown_workflow_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    with pytest.raises(WorkflowRunNotFoundForHandoffError):
        repository.create_prepared(
            workflow_run_id=str(uuid4()),
            task_id="task-missing",
            snapshot_object_key="checkpoint.bin",
            snapshot_schema_version="v1",
            snapshot_checksum="sha256:value",
            snapshot_size_bytes=1,
            resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT,
            source_worker_id="worker-old",
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("snapshot_size_bytes", -1, "snapshot_size_bytes must be non-negative"),
        ("task_id", "", "task_id must not be empty"),
        ("snapshot_object_key", "", "snapshot metadata must not be empty"),
        ("snapshot_schema_version", "", "snapshot metadata must not be empty"),
        ("snapshot_checksum", "", "snapshot metadata must not be empty"),
        ("source_worker_id", "", "source_worker_id must not be empty"),
    ],
)
def test_create_preparing_rejects_invalid_snapshot_identity(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    field: str,
    value: object,
    message: str,
) -> None:
    arguments: dict[str, object] = {
        "workflow_run_id": RUN_ID,
        "task_id": "task-1",
        "snapshot_object_key": "workflow-handoffs/run/checkpoint.bin",
        "snapshot_schema_version": "graph-runtime-state/v1",
        "snapshot_checksum": "sha256:0123456789abcdef",
        "snapshot_size_bytes": 128,
        "resume_route": WorkflowHandoffResumeRoute.WORKFLOW,
        "source_worker_id": "worker-old",
    }
    arguments[field] = value

    with pytest.raises(ValueError, match=message):
        repository.create_preparing(**arguments)  # type: ignore[arg-type]


def test_create_prepared_reports_stop_tombstone_as_cancelled(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    assert (
        repository.request_cancel_by_task_id(
            task_id="task-cancelled-before-upload",
            requested_at=NOW,
            expires_at=FAR_FUTURE,
        )
        == 0
    )

    with pytest.raises(WorkflowHandoffPreparationCancelledError, match="preparation was cancelled"):
        repository.create_prepared(
            workflow_run_id=RUN_ID,
            task_id="task-cancelled-before-upload",
            snapshot_object_key="workflow-handoffs/run/cancelled.bin",
            snapshot_schema_version="graph-runtime-state/v1",
            snapshot_checksum="sha256:cancelled",
            snapshot_size_bytes=8,
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id="worker-old",
        )


def test_create_prepared_reports_finish_race_as_cancelled(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(repository, "finish_preparing", lambda **_kwargs: None)

    with pytest.raises(WorkflowHandoffPreparationCancelledError, match="preparation was cancelled"):
        _create_prepared(repository)


def test_finish_preparing_is_idempotent_and_rejects_missing_generation(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-uploading",
        snapshot_object_key="workflow-handoffs/run/uploading-idempotently.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:uploading-idempotently",
        snapshot_size_bytes=32,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )

    assert repository.finish_preparing(handoff_id="missing", generation=1) is None
    prepared = repository.finish_preparing(handoff_id=preparing.id, generation=preparing.generation)
    assert prepared is not None
    assert prepared.state == WorkflowHandoffState.PREPARED
    replay = repository.finish_preparing(handoff_id=preparing.id, generation=preparing.generation)
    assert replay is not None
    assert replay.id == prepared.id
    assert replay.state == WorkflowHandoffState.PREPARED


def test_finish_preparing_observes_tombstone_created_during_upload(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-cancelled-during-upload",
        snapshot_object_key="workflow-handoffs/run/cancelled-during-upload.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:cancelled-during-upload",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    with repository._session_factory.begin() as session:
        session.add(
            WorkflowHandoffCancellation(
                task_id=preparing.task_id,
                requested_at=NOW,
                expires_at=FAR_FUTURE,
                reason="stop raced checkpoint upload",
            )
        )

    assert repository.finish_preparing(handoff_id=preparing.id, generation=preparing.generation) is None
    cancelled = repository.get(preparing.id)
    assert cancelled is not None
    assert cancelled.state == WorkflowHandoffState.FAILED
    assert cancelled.cancel_requested_at == NOW
    assert cancelled.last_error == "stop raced checkpoint upload"
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.STOPPED


def test_finish_preparing_refuses_orphaned_run_after_upload(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-orphaned-during-upload",
        snapshot_object_key="workflow-handoffs/run/orphaned-during-upload.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:orphaned-during-upload",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    with repository._session_factory.begin() as session:
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == RUN_ID))

    assert repository.finish_preparing(handoff_id=preparing.id, generation=preparing.generation) is None
    persisted = repository.get(preparing.id)
    assert persisted is not None
    assert persisted.state == WorkflowHandoffState.PREPARING
    with repository._session_factory() as session:
        gc_record = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == preparing.snapshot_object_key
            )
        )
        assert gc_record is not None
        assert gc_record.upload_completed_at is not None


def test_create_preparing_applies_new_tombstone_to_existing_active_intent(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-existing-upload",
        snapshot_object_key="workflow-handoffs/run/existing-upload.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:existing-upload",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    with repository._session_factory.begin() as session:
        session.add(
            WorkflowHandoffCancellation(
                task_id=preparing.task_id,
                requested_at=NOW,
                expires_at=FAR_FUTURE,
                reason="stop raced retry",
            )
        )

    replay = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id=preparing.task_id,
        snapshot_object_key=preparing.snapshot_object_key,
        snapshot_schema_version=preparing.snapshot_schema_version,
        snapshot_checksum=preparing.snapshot_checksum,
        snapshot_size_bytes=preparing.snapshot_size_bytes,
        resume_route=preparing.resume_route,
        source_worker_id=preparing.source_worker_id,
    )

    assert replay.id == preparing.id
    assert replay.state == WorkflowHandoffState.FAILED
    assert replay.cancel_requested_at == NOW
    assert replay.last_error == "stop raced retry"


def test_prepared_is_not_due_or_claimable_until_activation_and_activation_is_idempotent(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    prepared = _create_prepared(repository)

    assert (
        repository.list_due(
            now=NOW,
            redispatch_interval=timedelta(seconds=30),
            max_attempts=3,
            limit=10,
        )
        == []
    )
    assert (
        repository.claim(
            handoff_id=prepared.id,
            generation=prepared.generation,
            lease_owner="worker-new",
            lease_duration=timedelta(seconds=30),
            max_attempts=3,
            now=NOW,
        )
        is None
    )

    activated = repository.activate_latest_prepared_by_task_id(task_id="task-1", activated_at=NOW)
    assert activated is not None
    assert activated.id == prepared.id
    assert activated.state == WorkflowHandoffState.READY
    assert repository.activate_latest_prepared_by_task_id(task_id="task-1", activated_at=NOW) is None
    assert repository.activate_latest_prepared_by_task_id(task_id="missing", activated_at=NOW) is None


def test_public_scanner_and_lease_inputs_are_validated(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    with pytest.raises(ValueError, match="task_id must not be empty"):
        repository.activate_latest_prepared_by_task_id(task_id="", activated_at=NOW)
    with pytest.raises(ValueError, match="redispatch_interval must be non-negative"):
        repository.list_due(
            now=NOW,
            redispatch_interval=timedelta(seconds=-1),
            max_attempts=1,
            limit=1,
        )
    with pytest.raises(ValueError, match="max_attempts must be positive"):
        repository.list_due(now=NOW, redispatch_interval=timedelta(), max_attempts=0, limit=1)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.list_due(now=NOW, redispatch_interval=timedelta(), max_attempts=1, limit=0)
    with pytest.raises(ValueError, match="lease_owner must not be empty"):
        repository.claim(
            handoff_id="missing",
            generation=1,
            lease_owner="",
            lease_duration=timedelta(seconds=1),
            max_attempts=1,
            now=NOW,
        )
    with pytest.raises(ValueError, match="lease_duration must be positive"):
        repository.claim(
            handoff_id="missing",
            generation=1,
            lease_owner="worker",
            lease_duration=timedelta(),
            max_attempts=1,
            now=NOW,
        )
    with pytest.raises(ValueError, match="lease_duration must be positive"):
        repository.renew_lease(
            handoff_id="missing",
            generation=1,
            lease_owner="worker",
            lease_token="token",
            lease_duration=timedelta(),
            now=NOW,
        )
    with pytest.raises(ValueError, match="max_attempts must be positive"):
        repository.record_failure(
            handoff_id="missing",
            generation=1,
            lease_owner="worker",
            lease_token="token",
            error="failure",
            retry_at=NOW,
            max_attempts=0,
            now=NOW,
        )


def test_public_cleanup_limits_are_validated(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    with pytest.raises(ValueError, match="max_attempts must be positive"):
        repository.fail_exhausted(now=NOW, max_attempts=0, error="invalid")
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.fail_stale_prepared(now=NOW, stale_before=NOW, error="invalid", limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.fail_stale_ready(now=NOW, stale_before=NOW, error="invalid", limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.list_failed_pending_terminal_compensation(limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.list_pending_terminal_events(limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.list_snapshot_gc_candidates(now=NOW, limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.cleanup_expired_cancellations(now=NOW, limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.cleanup_terminal_handoffs(terminal_before=NOW, limit=0)
    with pytest.raises(ValueError, match="limit must be positive"):
        repository.cleanup_completed_snapshot_gc(deleted_before=NOW, limit=0)


def test_create_and_activate_refuse_a_stopped_workflow_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    prepared = _create_prepared(repository)
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.STOPPED

    assert repository.activate_latest_prepared_by_task_id(task_id="task-1", activated_at=NOW) is None
    with pytest.raises(WorkflowRunNotResumableForHandoffError):
        _create_prepared(repository, object_key="workflow-handoffs/run/other.bin")
    assert repository.get(prepared.id).state == WorkflowHandoffState.PREPARED  # type: ignore[union-attr]


def test_claim_reclaims_expired_lease_and_fences_stale_claim_token(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)

    first_claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new-a",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert first_claim is not None
    assert first_claim.attempts == 1
    assert first_claim.lease_token is not None

    assert (
        repository.claim(
            handoff_id=handoff.id,
            generation=handoff.generation,
            lease_owner="worker-new-b",
            lease_duration=timedelta(seconds=30),
            max_attempts=3,
            now=NOW + timedelta(seconds=29),
        )
        is None
    )

    second_claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new-b",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW + timedelta(seconds=31),
    )
    assert second_claim is not None
    assert second_claim.attempts == 2
    assert second_claim.lease_token is not None
    assert second_claim.lease_token != first_claim.lease_token

    assert not repository.mark_resumed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new-a",
        lease_token=first_claim.lease_token,
        resumed_at=NOW + timedelta(seconds=32),
    )
    assert repository.mark_resumed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new-b",
        lease_token=second_claim.lease_token,
        resumed_at=NOW + timedelta(seconds=32),
    )

    resumed = repository.get(handoff.id, handoff.generation)
    assert resumed is not None
    assert resumed.state == WorkflowHandoffState.RESUMED
    assert resumed.lease_owner is None
    assert resumed.lease_token is None


def test_missing_and_stale_claim_mutations_are_safe_noops(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    assert (
        repository.claim(
            handoff_id="missing",
            generation=1,
            lease_owner="worker-new",
            lease_duration=timedelta(seconds=30),
            max_attempts=3,
            now=NOW,
        )
        is None
    )
    assert (
        repository.record_failure(
            handoff_id="missing",
            generation=1,
            lease_owner="worker-new",
            lease_token="missing-token",
            error="ignored",
            retry_at=NOW,
            max_attempts=3,
            now=NOW,
        )
        is None
    )
    assert not repository.mark_resumed(
        handoff_id="missing",
        generation=1,
        lease_owner="worker-new",
        lease_token="missing-token",
        resumed_at=NOW,
    )
    assert not repository.mark_failed(
        handoff_id="missing",
        generation=1,
        error="ignored",
        failed_at=NOW,
    )

    handoff = _create_ready(repository)
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert not repository.mark_dispatched(
        handoff_id=handoff.id,
        generation=handoff.generation + 1,
        dispatched_at=NOW,
    )
    assert not repository.renew_lease(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token="stale-token",
        lease_duration=timedelta(seconds=30),
        now=NOW,
    )
    assert (
        repository.record_failure(
            handoff_id=handoff.id,
            generation=handoff.generation,
            lease_owner="worker-new",
            lease_token="stale-token",
            error="ignored",
            retry_at=NOW,
            max_attempts=3,
            now=NOW,
        )
        is None
    )
    assert not repository.mark_failed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token="stale-token",
        error="ignored",
        failed_at=NOW,
    )


def test_claim_and_failure_are_fenced_by_attempts_and_parent_terminal_state(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.attempts = 3

    assert (
        repository.claim(
            handoff_id=handoff.id,
            generation=handoff.generation,
            lease_owner="worker-new",
            lease_duration=timedelta(seconds=30),
            max_attempts=3,
            now=NOW,
        )
        is None
    )

    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.attempts = 0
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_run.finished_at = NOW

    assert not repository.mark_resumed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=NOW + timedelta(seconds=1),
    )
    failure = repository.record_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        error="late worker failure",
        retry_at=NOW + timedelta(seconds=30),
        max_attempts=3,
        now=NOW + timedelta(seconds=1),
    )
    assert failure is not None
    assert failure.state == WorkflowHandoffState.FAILED
    terminal_run = _get_workflow_run(repository)
    assert terminal_run.status == WorkflowExecutionStatus.SUCCEEDED
    assert terminal_run.finished_at == NOW
    assert terminal_run.error is None


def test_mark_failed_rejects_terminal_state_after_resume(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)

    assert not repository.mark_failed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        error="late failure",
        failed_at=NOW + timedelta(seconds=1),
    )
    assert repository.get(handoff.id).state == WorkflowHandoffState.RESUMED  # type: ignore[union-attr]


def test_claim_failure_terminalizes_handoff_after_parent_is_deleted(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    with repository._session_factory.begin() as session:
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == RUN_ID))

    failed = repository.record_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        error="parent was retained first",
        retry_at=NOW + timedelta(seconds=30),
        max_attempts=3,
        now=NOW + timedelta(seconds=1),
    )
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.failed_at == NOW + timedelta(seconds=1)


def test_mark_failed_terminalizes_handoff_after_parent_is_deleted(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository)
    with repository._session_factory.begin() as session:
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == RUN_ID))

    assert repository.mark_failed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        error="parent was retained first",
        failed_at=NOW,
    )
    failed = repository.get(handoff.id)
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.failed_at == NOW


def test_mark_resumed_accumulates_handoff_duration_once_per_fenced_generation(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    first = _create_ready(repository)
    with repository._session_factory.begin() as session:
        persisted_first = session.get(WorkflowRunHandoff, first.id)
        assert persisted_first is not None
        persisted_first.created_at = NOW - timedelta(seconds=20)

    first_claim = repository.claim(
        handoff_id=first.id,
        generation=first.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert first_claim is not None
    assert first_claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=first.id,
        generation=first.generation,
        lease_owner="worker-new",
        lease_token=first_claim.lease_token,
        resumed_at=NOW + timedelta(seconds=5),
    )
    # A duplicate ACK is fenced because the row is no longer CLAIMED.
    assert not repository.mark_resumed(
        handoff_id=first.id,
        generation=first.generation,
        lease_owner="worker-new",
        lease_token=first_claim.lease_token,
        resumed_at=NOW + timedelta(seconds=6),
    )
    assert _get_workflow_run(repository).handoff_duration == 25.0

    second = _create_prepared(repository, object_key="workflow-handoffs/run/checkpoint-2.bin")
    with repository._session_factory.begin() as session:
        persisted_second = session.get(WorkflowRunHandoff, second.id)
        assert persisted_second is not None
        persisted_second.created_at = NOW + timedelta(seconds=10)
    second = repository.activate_latest_prepared_by_task_id(
        task_id=second.task_id,
        activated_at=NOW + timedelta(seconds=10),
    )
    assert second is not None
    second_claim = repository.claim(
        handoff_id=second.id,
        generation=second.generation,
        lease_owner="worker-newer",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW + timedelta(seconds=10),
    )
    assert second_claim is not None
    assert second_claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=second.id,
        generation=second.generation,
        lease_owner="worker-newer",
        lease_token=second_claim.lease_token,
        resumed_at=NOW + timedelta(seconds=22),
    )
    assert _get_workflow_run(repository).handoff_duration == 37.0


def test_handoff_failure_records_logical_wall_clock_elapsed_time(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.created_at = NOW - timedelta(seconds=90)

    assert repository.mark_failed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        error="snapshot incompatible",
        failed_at=NOW,
    )

    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.finished_at == NOW
    assert stopped_run.elapsed_time == 90.0


def test_renew_lease_requires_the_current_fencing_token(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None

    assert not repository.renew_lease(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=str(uuid4()),
        lease_duration=timedelta(seconds=60),
        now=NOW + timedelta(seconds=10),
    )
    assert repository.renew_lease(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        lease_duration=timedelta(seconds=60),
        now=NOW + timedelta(seconds=10),
    )
    # A delayed heartbeat must not shorten a lease renewed by a newer heartbeat.
    assert repository.renew_lease(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        lease_duration=timedelta(seconds=30),
        now=NOW + timedelta(seconds=5),
    )
    renewed = repository.get(handoff.id)
    assert renewed is not None
    assert renewed.lease_expires_at == NOW + timedelta(seconds=70)


def test_record_failure_retries_when_due_then_fails_at_attempt_limit(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.created_at = NOW - timedelta(seconds=30)
    first_claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=2,
        now=NOW,
    )
    assert first_claim is not None
    assert first_claim.lease_token is not None

    retry_at = NOW + timedelta(seconds=10)
    retry = repository.record_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=first_claim.lease_token,
        error="transient storage error",
        retry_at=retry_at,
        max_attempts=2,
        now=NOW + timedelta(seconds=1),
    )
    assert retry is not None
    assert retry.state == WorkflowHandoffState.READY
    assert retry.next_retry_at == retry_at
    assert retry.dispatched_at is None

    assert (
        repository.claim(
            handoff_id=handoff.id,
            generation=handoff.generation,
            lease_owner="worker-new",
            lease_duration=timedelta(seconds=30),
            max_attempts=2,
            now=retry_at - timedelta(seconds=1),
        )
        is None
    )
    second_claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=2,
        now=retry_at,
    )
    assert second_claim is not None
    assert second_claim.lease_token is not None

    failed = repository.record_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=second_claim.lease_token,
        error="snapshot is incompatible",
        retry_at=retry_at + timedelta(seconds=30),
        max_attempts=2,
        now=retry_at + timedelta(seconds=1),
    )
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.failed_at == retry_at + timedelta(seconds=1)
    assert failed.next_retry_at is None
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.finished_at == retry_at + timedelta(seconds=1)
    assert stopped_run.error == "snapshot is incompatible"
    assert stopped_run.handoff_duration == 41.0


def test_due_outbox_rows_are_redispatched_only_after_interval(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    interval = timedelta(seconds=15)

    due = repository.list_due(now=NOW, redispatch_interval=interval, max_attempts=3, limit=10)
    assert [row.id for row in due] == [handoff.id]
    assert repository.mark_dispatched(handoff_id=handoff.id, generation=handoff.generation, dispatched_at=NOW)

    assert (
        repository.list_due(
            now=NOW + timedelta(seconds=14),
            redispatch_interval=interval,
            max_attempts=3,
            limit=10,
        )
        == []
    )
    redispatch = repository.list_due(
        now=NOW + timedelta(seconds=15),
        redispatch_interval=interval,
        max_attempts=3,
        limit=10,
    )
    assert [row.id for row in redispatch] == [handoff.id]


def test_due_scan_excludes_active_handoff_whose_parent_run_is_terminal(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    _create_ready(repository)
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED

    assert (
        repository.list_due(
            now=NOW,
            redispatch_interval=timedelta(seconds=30),
            max_attempts=3,
            limit=10,
        )
        == []
    )


@pytest.mark.parametrize(
    "active_state",
    [
        WorkflowHandoffState.PREPARING,
        WorkflowHandoffState.PREPARED,
        WorkflowHandoffState.READY,
        WorkflowHandoffState.CLAIMED,
    ],
)
def test_cancel_atomically_fails_active_handoff_and_stops_running_workflow_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    active_state: WorkflowHandoffState,
) -> None:
    if active_state == WorkflowHandoffState.PREPARING:
        cancelled = repository.create_preparing(
            workflow_run_id=RUN_ID,
            task_id="task-1",
            snapshot_object_key="workflow-handoffs/run/checkpoint.bin",
            snapshot_schema_version="graph-runtime-state/v1",
            snapshot_checksum="sha256:0123456789abcdef",
            snapshot_size_bytes=128,
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id="worker-old",
        )
    else:
        cancelled = _create_prepared(repository)
    if active_state in {WorkflowHandoffState.READY, WorkflowHandoffState.CLAIMED}:
        activated = repository.activate_latest_prepared_by_task_id(task_id="task-1", activated_at=NOW)
        assert activated is not None
        cancelled = activated
    if active_state == WorkflowHandoffState.CLAIMED:
        claimed = repository.claim(
            handoff_id=cancelled.id,
            generation=cancelled.generation,
            lease_owner="worker-new",
            lease_duration=timedelta(seconds=30),
            max_attempts=3,
            now=NOW,
        )
        assert claimed is not None
        cancelled = claimed
    assert cancelled.state == active_state
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, cancelled.id)
        assert persisted is not None
        persisted.created_at = NOW - timedelta(seconds=15)

    assert repository.request_cancel_by_task_id(task_id="unrelated-task", requested_at=NOW) == 0
    assert repository.request_cancel_by_task_id(task_id="task-1", requested_at=NOW) == 1
    assert repository.request_cancel_by_task_id(task_id="task-1", requested_at=NOW) == 0
    cancelled_record = repository.get(cancelled.id)
    assert cancelled_record is not None
    assert cancelled_record.state == WorkflowHandoffState.FAILED
    assert cancelled_record.cancel_requested_at == NOW
    assert repository.activate_latest_prepared_by_task_id(task_id="task-1", activated_at=NOW) is None
    assert (
        repository.claim(
            handoff_id=cancelled.id,
            generation=cancelled.generation,
            lease_owner="worker-new",
            lease_duration=timedelta(seconds=30),
            max_attempts=1,
            now=NOW,
        )
        is None
    )

    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.finished_at == NOW
    assert stopped_run.error == "workflow task cancellation requested"
    assert stopped_run.handoff_duration == 15.0


def test_cancel_does_not_change_run_after_latest_handoff_is_resumed(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=NOW,
    )

    assert repository.request_cancel_by_task_id(task_id="task-1", requested_at=NOW) == 0
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.RUNNING


@pytest.mark.parametrize(
    ("scope_tenant_id", "scope_app_id"),
    [(TENANT_ID, None), (None, APP_ID)],
    ids=("tenant-only", "app-only"),
)
def test_task_cancellation_rejects_partial_owner_scope(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    scope_tenant_id: str | None,
    scope_app_id: str | None,
) -> None:
    with pytest.raises(ValueError, match="scope_tenant_id and scope_app_id must be provided together"):
        repository.request_cancel_by_task_id(
            task_id="task-1",
            requested_at=NOW,
            scope_tenant_id=scope_tenant_id,
            scope_app_id=scope_app_id,
        )


def test_cancel_validates_identity_scope_and_expiration(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    with pytest.raises(ValueError, match="workflow_run_id must not be empty"):
        repository.request_cancel(workflow_run_id="", requested_at=NOW)
    assert repository.request_cancel(workflow_run_id=str(uuid4()), requested_at=NOW) == 0
    with pytest.raises(ValueError, match="task_id must not be empty"):
        repository.request_cancel_by_task_id(task_id="", requested_at=NOW)
    with pytest.raises(ValueError, match="reason must not be empty"):
        repository.request_cancel_by_task_id(task_id="task", requested_at=NOW, reason="")
    with pytest.raises(ValueError, match="scope_created_by_role and scope_created_by must be provided together"):
        repository.request_cancel_by_task_id(
            task_id="task",
            requested_at=NOW,
            scope_created_by_role=CreatorUserRole.ACCOUNT,
        )
    with pytest.raises(ValueError, match="scope_created_by_role and scope_created_by must be provided together"):
        repository.request_cancel_by_task_id(
            task_id="task",
            requested_at=NOW,
            scope_created_by=str(uuid4()),
        )
    with pytest.raises(ValueError, match="creator scope requires tenant and app scope"):
        repository.request_cancel_by_task_id(
            task_id="task",
            requested_at=NOW,
            scope_created_by_role=CreatorUserRole.ACCOUNT,
            scope_created_by=str(uuid4()),
        )
    with pytest.raises(ValueError, match="expires_at must be later than requested_at"):
        repository.request_cancel_by_task_id(task_id="task", requested_at=NOW, expires_at=NOW)


def test_duplicate_stop_tombstone_extends_expiration_without_duplication(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    first_expiration = FAR_FUTURE - timedelta(days=1)
    extended_expiration = FAR_FUTURE
    assert (
        repository.request_cancel_by_task_id(
            task_id="task-with-extended-stop",
            requested_at=NOW,
            reason="original stop",
            expires_at=first_expiration,
        )
        == 0
    )
    assert (
        repository.request_cancel_by_task_id(
            task_id="task-with-extended-stop",
            requested_at=NOW + timedelta(seconds=1),
            reason="duplicate stop",
            expires_at=extended_expiration,
        )
        == 0
    )

    with repository._session_factory() as session:
        cancellations = list(
            session.scalars(
                sa.select(WorkflowHandoffCancellation).where(
                    WorkflowHandoffCancellation.task_id == "task-with-extended-stop"
                )
            )
        )
    assert len(cancellations) == 1
    assert cancellations[0].requested_at == NOW
    assert cancellations[0].expires_at == extended_expiration
    assert cancellations[0].reason == "original stop"


def test_stop_tombstone_before_preparation_fences_upload_and_stops_owned_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    workflow_run = _get_workflow_run(repository)

    assert (
        repository.request_cancel_by_task_id(
            task_id="task-before-preparing",
            requested_at=NOW,
            scope_tenant_id=workflow_run.tenant_id,
            scope_app_id=workflow_run.app_id,
            expires_at=FAR_FUTURE,
        )
        == 0
    )
    fenced = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-before-preparing",
        snapshot_object_key="workflow-handoffs/run/fenced.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:fenced",
        snapshot_size_bytes=7,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )

    assert fenced.state == WorkflowHandoffState.FAILED
    assert fenced.cancel_requested_at == NOW
    assert repository.finish_preparing(handoff_id=fenced.id, generation=fenced.generation) is None
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.finished_at == NOW


def test_creator_scoped_tombstone_does_not_fence_another_users_future_handoff(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    workflow_run = _get_workflow_run(repository)

    assert (
        repository.request_cancel_by_task_id(
            task_id="task-before-preparing",
            requested_at=NOW,
            scope_tenant_id=workflow_run.tenant_id,
            scope_app_id=workflow_run.app_id,
            scope_created_by_role=workflow_run.created_by_role,
            scope_created_by=str(uuid4()),
            expires_at=FAR_FUTURE,
        )
        == 0
    )
    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-before-preparing",
        snapshot_object_key="workflow-handoffs/run/not-fenced.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:not-fenced",
        snapshot_size_bytes=10,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )

    assert preparing.state == WorkflowHandoffState.PREPARING
    assert preparing.cancel_requested_at is None
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.RUNNING


def test_stop_after_preparing_terminalizes_upload_intent_before_finish(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-uploading",
        snapshot_object_key="workflow-handoffs/run/uploading.bin",
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:uploading",
        snapshot_size_bytes=9,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    assert preparing.state == WorkflowHandoffState.PREPARING

    assert repository.request_cancel_by_task_id(task_id="task-uploading", requested_at=NOW) == 1
    assert repository.finish_preparing(handoff_id=preparing.id, generation=preparing.generation) is None
    cancelled = repository.get(preparing.id)
    assert cancelled is not None
    assert cancelled.state == WorkflowHandoffState.FAILED
    assert cancelled.cancel_requested_at == NOW


def test_scoped_stop_cannot_cancel_another_tenant_or_app(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    owned_run = _get_workflow_run(repository)
    prepared = _create_prepared(repository)

    assert (
        repository.request_cancel_by_task_id(
            task_id=prepared.task_id,
            requested_at=NOW,
            scope_tenant_id=str(uuid4()),
            scope_app_id=str(uuid4()),
        )
        == 0
    )
    assert repository.get(prepared.id).state == WorkflowHandoffState.PREPARED  # type: ignore[union-attr]
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.RUNNING

    assert (
        repository.request_cancel_by_task_id(
            task_id=prepared.task_id,
            requested_at=NOW,
            scope_tenant_id=owned_run.tenant_id,
            scope_app_id=owned_run.app_id,
            scope_created_by_role=CreatorUserRole.ACCOUNT,
            scope_created_by=str(uuid4()),
        )
        == 0
    )
    assert repository.get(prepared.id).state == WorkflowHandoffState.PREPARED  # type: ignore[union-attr]

    assert (
        repository.request_cancel_by_task_id(
            task_id=prepared.task_id,
            requested_at=NOW,
            scope_tenant_id=owned_run.tenant_id,
            scope_app_id=owned_run.app_id,
            scope_created_by_role=owned_run.created_by_role,
            scope_created_by=owned_run.created_by,
        )
        == 1
    )
    assert repository.get(prepared.id).state == WorkflowHandoffState.FAILED  # type: ignore[union-attr]


def test_cancel_by_workflow_run_id_atomically_stops_prepared_handoff(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    prepared = _create_prepared(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, prepared.id)
        assert persisted is not None
        persisted.created_at = NOW - timedelta(seconds=25)

    assert repository.request_cancel(workflow_run_id=RUN_ID, requested_at=NOW, reason="user stopped") == 1
    cancelled = repository.get(prepared.id)
    assert cancelled is not None
    assert cancelled.state == WorkflowHandoffState.FAILED
    assert cancelled.cancel_requested_at == NOW
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.error == "user stopped"
    assert stopped_run.handoff_duration == 25.0

    # The FAILED state fences duplicate Stop requests from double-counting.
    assert repository.request_cancel(workflow_run_id=RUN_ID, requested_at=NOW, reason="duplicate stop") == 0
    assert _get_workflow_run(repository).handoff_duration == 25.0


def test_exhausted_expired_claim_fails_handoff_and_stops_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    exhausted = _create_ready(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, exhausted.id)
        assert persisted is not None
        persisted.created_at = NOW - timedelta(seconds=20)
    claim = repository.claim(
        handoff_id=exhausted.id,
        generation=exhausted.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=1,
        now=NOW,
    )
    assert claim is not None
    assert (
        repository.fail_exhausted(
            now=NOW + timedelta(seconds=31),
            max_attempts=1,
            error="resume attempts exhausted",
        )
        == 1
    )
    failed = repository.get(exhausted.id)
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.last_error == "resume attempts exhausted"
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.handoff_duration == 51.0


def test_permanent_claim_failure_atomically_stops_the_running_workflow_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.created_at = NOW - timedelta(seconds=10)
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None

    assert repository.mark_failed(
        handoff_id=claim.id,
        generation=claim.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        error="snapshot schema is unsupported",
        failed_at=NOW + timedelta(seconds=1),
    )
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.error == "snapshot schema is unsupported"
    assert stopped_run.handoff_duration == 11.0


def test_stale_prepared_fails_closed_and_is_idempotent(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    prepared = _create_prepared(repository)
    failed_at = prepared.created_at + timedelta(days=1)
    assert (
        repository.fail_stale_prepared(
            now=failed_at,
            stale_before=failed_at,
            error="drain barrier timed out",
            limit=10,
        )
        == 1
    )
    failed = repository.get(prepared.id)
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.last_error == "drain barrier timed out"
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.finished_at == failed_at
    assert stopped_run.handoff_duration == 24 * 60 * 60

    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_run.error = "completed concurrently"
        workflow_run.finished_at = failed_at + timedelta(seconds=1)
    assert (
        repository.fail_stale_prepared(
            now=failed_at + timedelta(seconds=2),
            stale_before=failed_at + timedelta(seconds=2),
            error="must not overwrite",
            limit=10,
        )
        == 0
    )
    terminal_run = _get_workflow_run(repository)
    assert terminal_run.status == WorkflowExecutionStatus.SUCCEEDED
    assert terminal_run.error == "completed concurrently"
    assert terminal_run.handoff_duration == 24 * 60 * 60


def test_stale_prepared_failure_does_not_overwrite_a_concurrent_terminal_run(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    prepared = _create_prepared(repository)
    terminal_at = prepared.created_at + timedelta(hours=1)
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_run.error = None
        workflow_run.finished_at = terminal_at

    assert (
        repository.fail_stale_prepared(
            now=terminal_at + timedelta(seconds=1),
            stale_before=terminal_at + timedelta(seconds=1),
            error="drain barrier timed out",
            limit=10,
        )
        == 1
    )
    failed = repository.get(prepared.id)
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    terminal_run = _get_workflow_run(repository)
    assert terminal_run.status == WorkflowExecutionStatus.SUCCEEDED
    assert terminal_run.finished_at == terminal_at
    assert terminal_run.error is None
    assert terminal_run.handoff_duration == 60 * 60 + 1


def test_stale_prepared_scanner_terminalizes_orphaned_handoff(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository)
    failed_at = handoff.created_at + timedelta(hours=1)
    with repository._session_factory.begin() as session:
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == RUN_ID))

    assert (
        repository.fail_stale_prepared(
            now=failed_at,
            stale_before=failed_at,
            error="orphaned checkpoint timed out",
            limit=10,
        )
        == 1
    )
    failed = repository.get(handoff.id)
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.last_error == "orphaned checkpoint timed out"


def test_stale_never_claimed_ready_fails_closed_at_activation_deadline(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    ready = _create_ready(repository)
    timeout = timedelta(minutes=10)

    # Broker publication can be acknowledged repeatedly without a resume
    # worker ever claiming the row. Redispatch must not extend the activation
    # deadline.
    assert repository.mark_dispatched(
        handoff_id=ready.id,
        generation=ready.generation,
        dispatched_at=NOW + timeout - timedelta(seconds=1),
    )
    assert (
        repository.fail_stale_ready(
            now=NOW + timeout - timedelta(microseconds=1),
            stale_before=NOW - timedelta(microseconds=1),
            error="handoff timed out before first resume attempt",
            limit=10,
        )
        == 0
    )
    assert (
        repository.fail_stale_ready(
            now=NOW + timeout,
            stale_before=NOW,
            error="handoff timed out before first resume attempt",
            limit=10,
        )
        == 1
    )

    failed = repository.get(ready.id)
    assert failed is not None
    assert failed.state == WorkflowHandoffState.FAILED
    assert failed.failed_at == NOW + timeout
    assert failed.last_error == "handoff timed out before first resume attempt"
    stopped_run = _get_workflow_run(repository)
    assert stopped_run.status == WorkflowExecutionStatus.STOPPED
    assert stopped_run.finished_at == NOW + timeout
    assert stopped_run.handoff_duration == max(((NOW + timeout) - failed.created_at).total_seconds(), 0.0)


def test_stale_ready_timeout_does_not_preempt_a_started_resume_retry(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    ready = _create_ready(repository)
    claim = repository.claim(
        handoff_id=ready.id,
        generation=ready.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    retry = repository.record_failure(
        handoff_id=claim.id,
        generation=claim.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        error="transient resume failure",
        retry_at=NOW + timedelta(seconds=10),
        max_attempts=3,
        now=NOW + timedelta(seconds=1),
    )
    assert retry is not None
    assert retry.state == WorkflowHandoffState.READY
    assert retry.attempts == 1

    assert (
        repository.fail_stale_ready(
            now=NOW + timedelta(hours=1),
            stale_before=NOW + timedelta(hours=1),
            error="must not replace retry policy",
            limit=10,
        )
        == 0
    )
    assert repository.get(ready.id).state == WorkflowHandoffState.READY  # type: ignore[union-attr]
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.RUNNING


def test_terminal_compensation_builds_stopped_workflow_event(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert persisted is not None
        assert workflow_run is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        persisted.last_error = "resume attempts exhausted"
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.finished_at = NOW
        workflow_run.error = "resume attempts exhausted"
        workflow_run.elapsed_time = 60.0
        workflow_run.outputs = '{"partial": true}'
        workflow_run.total_tokens = 7
        workflow_run.total_steps = 3
        workflow_run.exceptions_count = 1

    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW,
    )
    events = repository.list_pending_terminal_events(limit=10)
    assert len(events) == 1
    event = events[0]
    assert event.workflow_run_id == RUN_ID
    assert event.task_id == "task-1"
    assert event.status == WorkflowExecutionStatus.STOPPED
    assert event.outputs == {"partial": True}
    assert event.error == "resume attempts exhausted"
    assert event.total_tokens == 7
    assert event.total_steps == 3
    assert repository.mark_terminal_event_published(
        handoff_id=handoff.id,
        generation=handoff.generation,
        published_at=NOW,
    )
    assert repository.list_pending_terminal_events(limit=10) == []


def test_failed_terminal_compensation_is_listed_fenced_and_idempotent(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository)
    assert not repository.compensate_failed_terminal(
        handoff_id="missing",
        generation=1,
        compensated_at=NOW,
    )
    assert not repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW,
    )

    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert persisted is not None
        assert workflow_run is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        persisted.last_error = "stale handoff failure"
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_run.finished_at = NOW

    pending_compensation = repository.list_failed_pending_terminal_compensation(limit=10)
    assert [item.id for item in pending_compensation] == [handoff.id]
    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW + timedelta(seconds=1),
    )
    compensated = repository.get(handoff.id)
    assert compensated is not None
    assert compensated.terminal_compensated_at == NOW + timedelta(seconds=1)
    assert compensated.terminal_event_published_at == NOW + timedelta(seconds=1)
    assert compensated.terminal_last_error == "workflow run already completed; terminal event skipped"
    assert repository.list_failed_pending_terminal_compensation(limit=10) == []
    assert repository.list_pending_terminal_events(limit=10) == []
    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW + timedelta(seconds=2),
    )


@pytest.mark.parametrize(
    "resume_route",
    [
        WorkflowHandoffResumeRoute.WORKFLOW,
        WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW,
        WorkflowHandoffResumeRoute.ADVANCED_CHAT,
        WorkflowHandoffResumeRoute.RAG_PIPELINE,
    ],
)
def test_terminal_reconciliation_completes_failed_scanner_race_for_every_route(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    resume_route: WorkflowHandoffResumeRoute,
) -> None:
    handoff = _create_ready(repository, resume_route=resume_route)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW + timedelta(seconds=1)
        persisted.last_error = "scanner won claim failure race"

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(resume_route),
        error="publisher observed failure",
        failed_at=NOW + timedelta(seconds=2),
    )

    assert event is not None
    assert event.status == WorkflowExecutionStatus.STOPPED
    assert event.error == "scanner won claim failure race"
    persisted = repository.get(handoff.id)
    assert persisted is not None
    assert persisted.terminal_compensated_at == NOW + timedelta(seconds=2)
    assert persisted.terminal_event_published_at is None


def test_terminal_reconciliation_accepts_failure_after_scanner_stopped_parent(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    assert repository.mark_failed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        error="scanner stopped parent",
        failed_at=NOW + timedelta(seconds=1),
    )

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
        error="publisher observed failure",
        failed_at=NOW + timedelta(seconds=2),
    )

    assert event is not None
    assert event.status == WorkflowExecutionStatus.STOPPED
    assert event.error == "scanner stopped parent"


def test_terminal_reconciliation_fences_identity_state_and_published_event(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    scope = _terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW)

    with pytest.raises(WorkflowHandoffTerminalOwnershipError, match="handoff ownership changed"):
        repository.reconcile_resumed_terminal_failure(
            handoff_id="missing",
            generation=handoff.generation,
            scope=scope,
            error="stale worker",
            failed_at=NOW,
        )
    with pytest.raises(WorkflowHandoffTerminalOwnershipError, match="no longer runtime-owned"):
        repository.reconcile_resumed_terminal_failure(
            handoff_id=handoff.id,
            generation=handoff.generation,
            scope=scope,
            error="too early",
            failed_at=NOW,
        )

    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.state = WorkflowHandoffState.RESUMED
        persisted.resumed_at = NOW
        persisted.terminal_event_published_at = NOW
    assert (
        repository.reconcile_resumed_terminal_failure(
            handoff_id=handoff.id,
            generation=handoff.generation,
            scope=scope,
            error="duplicate publish failure",
            failed_at=NOW + timedelta(seconds=1),
        )
        is None
    )


def test_terminal_outbox_records_processing_failure_until_publish_succeeds(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)
    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
        error="runtime failed",
        failed_at=NOW + timedelta(seconds=1),
    )
    assert event is not None

    assert not repository.record_terminal_processing_failure(
        handoff_id="missing",
        generation=1,
        error="ignored",
    )
    assert repository.record_terminal_processing_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        error="redis unavailable",
    )
    failed_publish = repository.get(handoff.id)
    assert failed_publish is not None
    assert failed_publish.terminal_attempts == 2
    assert failed_publish.terminal_last_error == "redis unavailable"
    assert repository.mark_terminal_event_published(
        handoff_id=handoff.id,
        generation=handoff.generation,
        published_at=NOW + timedelta(seconds=2),
    )
    published = repository.get(handoff.id)
    assert published is not None
    assert published.terminal_attempts == 3
    assert published.terminal_last_error is None
    assert not repository.record_terminal_processing_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        error="too late",
    )


def test_trigger_terminal_compensation_marks_log_failed_with_timing(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(
        repository,
        resume_route=WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW,
    )
    trigger_log_id = str(uuid4())
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert persisted is not None
        assert workflow_run is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        persisted.last_error = "resume attempts exhausted"
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.finished_at = NOW
        workflow_run.error = "resume attempts exhausted"
        workflow_run.total_tokens = 11
        session.execute(
            WORKFLOW_TRIGGER_LOG_TABLE.insert(),
            {
                "id": trigger_log_id,
                "tenant_id": workflow_run.tenant_id,
                "app_id": workflow_run.app_id,
                "workflow_id": workflow_run.workflow_id,
                "workflow_run_id": workflow_run.id,
                "trigger_metadata": "{}",
                "trigger_type": AppTriggerType.TRIGGER_WEBHOOK,
                "trigger_data": "{}",
                "inputs": "{}",
                "status": WorkflowTriggerStatus.RUNNING,
                "queue_name": "workflow",
                "created_by_role": CreatorUserRole.ACCOUNT,
                "created_by": str(uuid4()),
                "retry_count": 0,
            },
        )

    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW,
    )
    with repository._session_factory() as session:
        trigger_log = session.get(WorkflowTriggerLog, trigger_log_id)
        assert trigger_log is not None
        assert trigger_log.status == WorkflowTriggerStatus.FAILED
        assert trigger_log.error == "resume attempts exhausted"
        assert trigger_log.finished_at == NOW
        assert trigger_log.elapsed_time == 60.0
        assert trigger_log.total_tokens == 11


def test_rag_terminal_compensation_stops_running_parent_without_document(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository, resume_route=WorkflowHandoffResumeRoute.RAG_PIPELINE)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        persisted.last_error = "RAG resume was exhausted"

    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW + timedelta(seconds=1),
    )
    workflow_run = _get_workflow_run(repository)
    assert workflow_run.status == WorkflowExecutionStatus.STOPPED
    assert workflow_run.error == "RAG resume was exhausted"
    persisted = repository.get(handoff.id)
    assert persisted is not None
    assert persisted.terminal_compensated_at == NOW + timedelta(seconds=1)
    assert persisted.rag_document_error_marked_at is None


def test_advanced_chat_terminal_compensation_preserves_partial_answer(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(
        repository,
        resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT,
    )
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert persisted is not None
        assert workflow_run is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        persisted.last_error = "resume attempts exhausted"
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.finished_at = NOW
        workflow_run.error = "resume attempts exhausted"
        session.execute(
            CONVERSATION_TABLE.insert(),
            {
                "id": conversation_id,
                "app_id": APP_ID,
                "mode": AppMode.ADVANCED_CHAT,
                "name": "conversation",
                "inputs": {},
                "status": "normal",
                "from_source": ConversationFromSource.CONSOLE,
                "dialogue_count": 1,
            },
        )
        session.execute(
            MESSAGE_TABLE.insert(),
            {
                "id": message_id,
                "app_id": APP_ID,
                "conversation_id": conversation_id,
                "inputs": {},
                "query": "hello",
                "message": {},
                "message_unit_price": 0,
                "answer": "partial answer",
                "answer_unit_price": 0,
                "currency": "USD",
                "status": MessageStatus.NORMAL,
                "from_source": ConversationFromSource.CONSOLE,
                "workflow_run_id": RUN_ID,
                "app_mode": AppMode.ADVANCED_CHAT,
            },
        )

    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW,
    )
    with repository._session_factory() as session:
        message = session.get(Message, message_id)
        assert message is not None
        assert message.status == MessageStatus.ERROR
        assert message.error == "resume attempts exhausted"
        assert message.answer == "partial answer"
    events = repository.list_pending_terminal_events(limit=10)
    assert len(events) == 1
    assert events[0].message_id == message_id


def test_advanced_chat_terminal_event_loads_local_upload_metadata(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handoff = _create_prepared(repository, resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT)
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    upload_file_id = str(uuid4())
    message_file_id = str(uuid4())
    creator_id = str(uuid4())
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert persisted is not None
        assert workflow_run is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        persisted.last_error = "resume attempts exhausted"
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.finished_at = NOW
        workflow_run.error = "resume attempts exhausted"
        session.execute(
            CONVERSATION_TABLE.insert(),
            {
                "id": conversation_id,
                "app_id": APP_ID,
                "mode": AppMode.ADVANCED_CHAT,
                "name": "conversation",
                "inputs": {},
                "status": "normal",
                "from_source": ConversationFromSource.CONSOLE,
                "dialogue_count": 1,
            },
        )
        session.execute(
            MESSAGE_TABLE.insert(),
            {
                "id": message_id,
                "app_id": APP_ID,
                "conversation_id": conversation_id,
                "inputs": {},
                "query": "summarize attachment",
                "message": {},
                "message_unit_price": 0,
                "answer": "partial answer",
                "answer_unit_price": 0,
                "currency": "USD",
                "status": MessageStatus.NORMAL,
                "from_source": ConversationFromSource.CONSOLE,
                "workflow_run_id": RUN_ID,
                "app_mode": AppMode.ADVANCED_CHAT,
            },
        )
        session.execute(
            UPLOAD_FILE_TABLE.insert(),
            {
                "id": upload_file_id,
                "tenant_id": TENANT_ID,
                "storage_type": "local",
                "key": "uploads/report.txt",
                "name": "report.txt",
                "size": 12,
                "extension": "txt",
                "mime_type": "text/plain",
                "created_by_role": CreatorUserRole.ACCOUNT,
                "created_by": creator_id,
                "created_at": NOW,
                "used": True,
                "source_url": "",
            },
        )
        session.execute(
            MESSAGE_FILE_TABLE.insert(),
            {
                "id": message_file_id,
                "message_id": message_id,
                "type": FileType.DOCUMENT,
                "transfer_method": FileTransferMethod.LOCAL_FILE,
                "created_by_role": CreatorUserRole.ACCOUNT,
                "created_by": creator_id,
                "upload_file_id": upload_file_id,
                "created_at": NOW,
            },
        )

    observed_uploads: list[tuple[str, str]] = []

    def prepare_file(message_file: MessageFile, upload_files_map: dict[str, UploadFile]) -> dict[str, str]:
        observed_uploads.append((message_file.id, upload_files_map[upload_file_id].name))
        return {"related_id": message_file.id, "filename": upload_files_map[upload_file_id].name}

    monkeypatch.setattr(handoff_repository_module, "prepare_file_dict", prepare_file)
    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW,
    )
    events = repository.list_pending_terminal_events(limit=10)

    assert len(events) == 1
    assert observed_uploads == [(message_file_id, "report.txt")]
    assert events[0].message_files == ({"related_id": message_file_id, "filename": "report.txt"},)


def test_cancelled_pre_ack_advanced_chat_compensation_keeps_message_normal(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(
        repository,
        resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT,
    )
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    with repository._session_factory.begin() as session:
        session.execute(
            CONVERSATION_TABLE.insert(),
            {
                "id": conversation_id,
                "app_id": APP_ID,
                "mode": AppMode.ADVANCED_CHAT,
                "name": "conversation",
                "inputs": {},
                "status": "normal",
                "from_source": ConversationFromSource.CONSOLE,
                "dialogue_count": 1,
            },
        )
        session.execute(
            MESSAGE_TABLE.insert(),
            {
                "id": message_id,
                "app_id": APP_ID,
                "conversation_id": conversation_id,
                "inputs": {},
                "query": "hello",
                "message": {},
                "message_unit_price": 0,
                "answer": "partial before stop",
                "answer_unit_price": 0,
                "currency": "USD",
                "status": MessageStatus.NORMAL,
                "from_source": ConversationFromSource.CONSOLE,
                "workflow_run_id": RUN_ID,
                "app_mode": AppMode.ADVANCED_CHAT,
            },
        )

    assert (
        repository.request_cancel_by_task_id(
            task_id=handoff.task_id,
            requested_at=NOW,
            reason="stopped by user",
            scope_tenant_id=TENANT_ID,
            scope_app_id=APP_ID,
        )
        == 1
    )
    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW + timedelta(seconds=1),
    )

    with repository._session_factory() as session:
        message = session.get(Message, message_id)
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert message is not None
        assert persisted is not None
        assert persisted.cancel_requested_at == NOW
        assert message.status == MessageStatus.NORMAL
        assert message.error is None
        assert message.answer == "partial before stop"


def test_resumed_runtime_failure_atomically_stops_owned_latest_generation(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
        error="resumed queue exploded",
        failed_at=NOW + timedelta(seconds=10),
    )

    assert event is not None
    assert event.status == WorkflowExecutionStatus.STOPPED
    assert event.error == "resumed queue exploded"
    persisted = repository.get(handoff.id, handoff.generation)
    assert persisted is not None
    assert persisted.state == WorkflowHandoffState.FAILED
    assert persisted.failed_at == NOW + timedelta(seconds=10)
    assert persisted.terminal_compensated_at == NOW + timedelta(seconds=10)
    workflow_run = _get_workflow_run(repository)
    assert workflow_run.status == WorkflowExecutionStatus.STOPPED
    assert workflow_run.error == "resumed queue exploded"
    assert workflow_run.finished_at == NOW + timedelta(seconds=10)
    assert workflow_run.exceptions_count == 1
    pending = repository.list_pending_terminal_events(limit=10)
    assert [item.handoff_id for item in pending] == [handoff.id]


def test_resumed_runtime_failure_is_fenced_by_owner_and_newer_generation(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)

    wrong_scope = WorkflowHandoffTerminalScope(
        workflow_run_id=RUN_ID,
        task_id="task-1",
        tenant_id=str(uuid4()),
        app_id=APP_ID,
        workflow_id=WORKFLOW_ID,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
    )
    with pytest.raises(WorkflowHandoffTerminalOwnershipError, match="ownership changed"):
        repository.reconcile_resumed_terminal_failure(
            handoff_id=handoff.id,
            generation=handoff.generation,
            scope=wrong_scope,
            error="stale worker",
            failed_at=NOW + timedelta(seconds=1),
        )

    newer = _create_prepared(repository, object_key="workflow-handoffs/run/newer.bin")
    with pytest.raises(WorkflowHandoffTerminalOwnershipError, match="newer workflow handoff"):
        repository.reconcile_resumed_terminal_failure(
            handoff_id=handoff.id,
            generation=handoff.generation,
            scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
            error="late stale worker failure",
            failed_at=NOW + timedelta(seconds=2),
        )

    assert newer.generation == handoff.generation + 1
    assert repository.get(handoff.id, handoff.generation).state == WorkflowHandoffState.RESUMED  # type: ignore[union-attr]
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.RUNNING


def test_resumed_trigger_failure_reconciles_trigger_log_in_same_terminal_transaction(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository, resume_route=WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW)
    _mark_resumed(repository, handoff)
    trigger_log_id = str(uuid4())
    with repository._session_factory.begin() as session:
        session.execute(
            WORKFLOW_TRIGGER_LOG_TABLE.insert(),
            {
                "id": trigger_log_id,
                "tenant_id": TENANT_ID,
                "app_id": APP_ID,
                "workflow_id": WORKFLOW_ID,
                "workflow_run_id": RUN_ID,
                "trigger_type": AppTriggerType.TRIGGER_WEBHOOK,
                "trigger_data": "{}",
                "trigger_metadata": "{}",
                "inputs": "{}",
                "status": WorkflowTriggerStatus.RUNNING,
                "queue_name": "workflow",
                "created_by_role": CreatorUserRole.ACCOUNT,
                "created_by": str(uuid4()),
                "retry_count": 0,
            },
        )

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW),
        error="trigger resume failed",
        failed_at=NOW + timedelta(seconds=10),
    )

    assert event is not None
    with repository._session_factory() as session:
        trigger_log = session.get(WorkflowTriggerLog, trigger_log_id)
        assert trigger_log is not None
        assert trigger_log.status == WorkflowTriggerStatus.FAILED
        assert trigger_log.error == "trigger resume failed"
        assert trigger_log.finished_at == NOW + timedelta(seconds=10)


def test_resumed_advanced_chat_failure_persists_segment_partial_answer(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository, resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT)
    _mark_resumed(repository, handoff)
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    with repository._session_factory.begin() as session:
        session.execute(
            CONVERSATION_TABLE.insert(),
            {
                "id": conversation_id,
                "app_id": APP_ID,
                "mode": AppMode.ADVANCED_CHAT,
                "name": "conversation",
                "inputs": {},
                "status": "normal",
                "from_source": ConversationFromSource.CONSOLE,
                "dialogue_count": 1,
            },
        )
        session.execute(
            MESSAGE_TABLE.insert(),
            {
                "id": message_id,
                "app_id": APP_ID,
                "conversation_id": conversation_id,
                "inputs": {},
                "query": "hello",
                "message": {},
                "message_unit_price": 0,
                "answer": "pre-handoff answer",
                "answer_unit_price": 0,
                "currency": "USD",
                "status": MessageStatus.NORMAL,
                "from_source": ConversationFromSource.CONSOLE,
                "workflow_run_id": RUN_ID,
                "app_mode": AppMode.ADVANCED_CHAT,
            },
        )

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.ADVANCED_CHAT),
        error="chat resume queue failed",
        failed_at=NOW + timedelta(seconds=10),
        message_answer_replacement="pre-handoff answer + replacement",
        message_answer_delta=" + final delta",
    )

    assert event is not None
    assert event.message_answer == "pre-handoff answer + replacement + final delta"
    with repository._session_factory() as session:
        message = session.get(Message, message_id)
        assert message is not None
        assert message.answer == "pre-handoff answer + replacement + final delta"
        assert message.status == MessageStatus.ERROR
        assert message.error == "chat resume queue failed"


def test_user_stop_wins_resumed_advanced_chat_failure_race_and_keeps_partial_answer(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository, resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT)
    _mark_resumed(repository, handoff)
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.error = "stopped by user"
        workflow_run.finished_at = NOW + timedelta(seconds=5)
        session.execute(
            CONVERSATION_TABLE.insert(),
            {
                "id": conversation_id,
                "app_id": APP_ID,
                "mode": AppMode.ADVANCED_CHAT,
                "name": "conversation",
                "inputs": {},
                "status": "normal",
                "from_source": ConversationFromSource.CONSOLE,
                "dialogue_count": 1,
            },
        )
        session.execute(
            MESSAGE_TABLE.insert(),
            {
                "id": message_id,
                "app_id": APP_ID,
                "conversation_id": conversation_id,
                "inputs": {},
                "query": "hello",
                "message": {},
                "message_unit_price": 0,
                "answer": "pre-handoff answer",
                "answer_unit_price": 0,
                "currency": "USD",
                "status": MessageStatus.ERROR,
                "error": "late queue error",
                "from_source": ConversationFromSource.CONSOLE,
                "workflow_run_id": RUN_ID,
                "app_mode": AppMode.ADVANCED_CHAT,
            },
        )

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.ADVANCED_CHAT),
        error="late queue error",
        failed_at=NOW + timedelta(seconds=6),
        message_answer_delta=" + streamed before stop",
    )

    assert event is not None
    assert event.status == WorkflowExecutionStatus.STOPPED
    assert event.error == "stopped by user"
    assert event.message_answer == "pre-handoff answer + streamed before stop"
    with repository._session_factory() as session:
        message = session.get(Message, message_id)
        assert message is not None
        assert message.status == MessageStatus.NORMAL
        assert message.error is None
        assert message.answer == "pre-handoff answer + streamed before stop"
    assert _get_workflow_run(repository).error == "stopped by user"


def test_resumed_rag_failure_atomically_marks_owned_document_error(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    metadata = RagPipelineHandoffGroupMetadata(
        source_batch_id="source-batch-1",
        tenant_id=TENANT_ID,
        queue_kind=RagPipelineQueueKind.REGULAR,
        dataset_id=dataset_id,
        document_id=document_id,
        tenant_isolated=True,
    )
    handoff = _create_ready(
        repository,
        resume_route=WorkflowHandoffResumeRoute.RAG_PIPELINE,
        rag_group_metadata=metadata,
    )
    _mark_resumed(repository, handoff)
    with repository._session_factory.begin() as session:
        session.execute(
            DOCUMENT_TABLE.insert(),
            {
                "id": document_id,
                "tenant_id": TENANT_ID,
                "dataset_id": dataset_id,
                "position": 1,
                "data_source_type": "upload_file",
                "data_source_info": "{}",
                "batch": "batch",
                "name": "source.txt",
                "created_from": "rag-pipeline",
                "created_by": str(uuid4()),
                "doc_form": "text_model",
                "indexing_status": IndexingStatus.WAITING,
            },
        )

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.RAG_PIPELINE),
        error="rag resume failed",
        failed_at=NOW + timedelta(seconds=10),
    )

    assert event is not None
    with repository._session_factory() as session:
        document = session.get(Document, document_id)
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert document is not None
        assert document.indexing_status == IndexingStatus.ERROR
        assert document.error == "rag resume failed"
        assert document.stopped_at == NOW + timedelta(seconds=10)
        assert persisted is not None
        assert persisted.rag_document_error_marked_at == NOW + timedelta(seconds=10)


def test_resumed_rag_failure_does_not_overwrite_completed_document(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    metadata = RagPipelineHandoffGroupMetadata(
        source_batch_id="source-batch-completed",
        tenant_id=TENANT_ID,
        queue_kind=RagPipelineQueueKind.REGULAR,
        dataset_id=dataset_id,
        document_id=document_id,
        tenant_isolated=True,
    )
    handoff = _create_ready(
        repository,
        resume_route=WorkflowHandoffResumeRoute.RAG_PIPELINE,
        rag_group_metadata=metadata,
    )
    _mark_resumed(repository, handoff)
    with repository._session_factory.begin() as session:
        session.execute(
            DOCUMENT_TABLE.insert(),
            {
                "id": document_id,
                "tenant_id": TENANT_ID,
                "dataset_id": dataset_id,
                "position": 1,
                "data_source_type": "upload_file",
                "data_source_info": "{}",
                "batch": "batch",
                "name": "completed.txt",
                "created_from": "rag-pipeline",
                "created_by": str(uuid4()),
                "doc_form": "text_model",
                "indexing_status": IndexingStatus.COMPLETED,
            },
        )

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.RAG_PIPELINE),
        error="late RAG publisher failure",
        failed_at=NOW + timedelta(seconds=10),
    )

    assert event is not None
    with repository._session_factory() as session:
        document = session.get(Document, document_id)
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert document is not None
        assert persisted is not None
        assert document.indexing_status == IndexingStatus.COMPLETED
        assert document.error is None
        assert document.stopped_at is None
        assert persisted.rag_document_error_marked_at == NOW + timedelta(seconds=10)


def test_resumed_rag_failure_rolls_back_when_document_ownership_is_incomplete(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    metadata = RagPipelineHandoffGroupMetadata(
        source_batch_id="source-batch-wrong-owner",
        tenant_id=str(uuid4()),
        queue_kind=RagPipelineQueueKind.REGULAR,
        dataset_id=str(uuid4()),
        document_id=str(uuid4()),
        tenant_isolated=True,
    )
    handoff = _create_ready(
        repository,
        resume_route=WorkflowHandoffResumeRoute.RAG_PIPELINE,
        rag_group_metadata=metadata,
    )
    _mark_resumed(repository, handoff)

    with pytest.raises(WorkflowHandoffTerminalOwnershipError, match="metadata is incomplete"):
        repository.reconcile_resumed_terminal_failure(
            handoff_id=handoff.id,
            generation=handoff.generation,
            scope=_terminal_scope(WorkflowHandoffResumeRoute.RAG_PIPELINE),
            error="must roll back",
            failed_at=NOW + timedelta(seconds=10),
        )

    persisted = repository.get(handoff.id)
    assert persisted is not None
    assert persisted.state == WorkflowHandoffState.RESUMED
    assert persisted.failed_at is None
    assert persisted.terminal_compensated_at is None
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.RUNNING


def test_resumed_terminal_publish_failure_preserves_real_completed_status_as_outbox(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_run.finished_at = NOW + timedelta(seconds=5)

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
        error="redis publish failed",
        failed_at=NOW + timedelta(seconds=6),
    )

    assert event is not None
    assert event.status == WorkflowExecutionStatus.SUCCEEDED
    persisted = repository.get(handoff.id, handoff.generation)
    assert persisted is not None
    assert persisted.state == WorkflowHandoffState.RESUMED
    assert persisted.terminal_compensated_at == NOW + timedelta(seconds=6)
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.SUCCEEDED
    assert [item.status for item in repository.list_pending_terminal_events(limit=10)] == [
        WorkflowExecutionStatus.SUCCEEDED
    ]


def test_resumed_pause_publish_failure_defers_to_durable_pause_reconnect_snapshot(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)
    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        assert workflow_run is not None
        workflow_run.status = WorkflowExecutionStatus.PAUSED

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=handoff.id,
        generation=handoff.generation,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
        error="workflow_paused publish failed",
        failed_at=NOW + timedelta(seconds=6),
    )

    assert event is None
    persisted = repository.get(handoff.id, handoff.generation)
    assert persisted is not None
    assert persisted.state == WorkflowHandoffState.RESUMED
    assert persisted.terminal_compensated_at == NOW + timedelta(seconds=6)
    assert persisted.terminal_event_published_at == NOW + timedelta(seconds=6)
    assert repository.list_pending_terminal_events(limit=10) == []
    assert _get_workflow_run(repository).status == WorkflowExecutionStatus.PAUSED


def test_snapshot_gc_deletes_resumed_snapshot_and_marks_outbox_once(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    claim = repository.claim(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=NOW,
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=handoff.id,
        generation=handoff.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=NOW,
    )
    assert [record.snapshot_object_key for record in repository.list_snapshot_gc_candidates(now=NOW, limit=10)] == [
        handoff.snapshot_object_key
    ]
    deleted: list[str] = []

    outcome = repository.delete_snapshot_if_unreferenced(
        snapshot_object_key=handoff.snapshot_object_key,
        deleted_at=NOW,
        delete_object=lambda key: not deleted.append(key),
    )

    assert outcome.value == "deleted"
    assert deleted == [handoff.snapshot_object_key]
    assert repository.list_snapshot_gc_candidates(now=NOW, limit=10) == []
    assert (
        repository.delete_snapshot_if_unreferenced(
            snapshot_object_key=handoff.snapshot_object_key,
            deleted_at=NOW,
            delete_object=lambda _key: True,
        ).value
        == "already_deleted"
    )


def test_snapshot_gc_is_blocked_by_any_active_shared_reference(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository)
    assert repository.list_snapshot_gc_candidates(now=NOW, limit=10) == []
    callback_calls: list[str] = []
    outcome = repository.delete_snapshot_if_unreferenced(
        snapshot_object_key=handoff.snapshot_object_key,
        deleted_at=NOW,
        delete_object=lambda key: not callback_calls.append(key),
    )
    assert outcome.value == "blocked"
    assert callback_calls == []


def test_snapshot_gc_failure_is_retried_and_fenced_after_delete(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    _mark_resumed(repository, handoff)
    retry_at = NOW + timedelta(seconds=30)

    assert (
        repository.delete_snapshot_if_unreferenced(
            snapshot_object_key="workflow-handoffs/missing.bin",
            deleted_at=NOW,
            delete_object=lambda _key: True,
        ).value
        == "blocked"
    )
    assert repository.record_snapshot_gc_failure(
        snapshot_object_key=handoff.snapshot_object_key,
        error="object store unavailable",
        retry_at=retry_at,
    )
    assert repository.list_snapshot_gc_candidates(now=NOW, limit=10) == []
    assert [
        record.snapshot_object_key for record in repository.list_snapshot_gc_candidates(now=retry_at, limit=10)
    ] == [handoff.snapshot_object_key]
    with repository._session_factory() as session:
        gc_record = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
            )
        )
        assert gc_record is not None
        assert gc_record.attempts == 1
        assert gc_record.next_retry_at == retry_at
        assert gc_record.last_error == "object store unavailable"

    assert (
        repository.delete_snapshot_if_unreferenced(
            snapshot_object_key=handoff.snapshot_object_key,
            deleted_at=retry_at,
            delete_object=lambda _key: True,
        ).value
        == "deleted"
    )
    assert not repository.record_snapshot_gc_failure(
        snapshot_object_key=handoff.snapshot_object_key,
        error="too late",
        retry_at=retry_at + timedelta(seconds=30),
    )


def test_reused_snapshot_key_rearms_completed_gc_outbox(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    object_key = "workflow-handoffs/reused-content-address.bin"
    with repository._session_factory.begin() as session:
        session.add(
            WorkflowHandoffSnapshotGC(
                snapshot_object_key=object_key,
                upload_completed_at=NOW - timedelta(days=2),
                deleted_at=NOW - timedelta(days=1),
                attempts=3,
                next_retry_at=NOW,
                last_error="old deletion retry",
            )
        )

    preparing = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-reusing-content-address",
        snapshot_object_key=object_key,
        snapshot_schema_version="graph-runtime-state/v1",
        snapshot_checksum="sha256:reused-content-address",
        snapshot_size_bytes=128,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    with repository._session_factory() as session:
        rearmed = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(WorkflowHandoffSnapshotGC.snapshot_object_key == object_key)
        )
        assert rearmed is not None
        assert rearmed.deleted_at is None
        assert rearmed.upload_completed_at is None
        assert rearmed.attempts == 0
        assert rearmed.next_retry_at is None
        assert rearmed.last_error is None

    prepared = repository.finish_preparing(handoff_id=preparing.id, generation=preparing.generation)
    assert prepared is not None
    with repository._session_factory() as session:
        completed = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(WorkflowHandoffSnapshotGC.snapshot_object_key == object_key)
        )
        assert completed is not None
        assert completed.upload_completed_at is not None
        assert completed.deleted_at is None


def test_never_uploaded_preparing_snapshot_is_gc_missing_after_terminalization(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = repository.create_preparing(
        workflow_run_id=RUN_ID,
        task_id="task-preparing",
        snapshot_object_key="workflow-handoffs/run/never-uploaded.bin",
        snapshot_schema_version="v1",
        snapshot_checksum="checksum",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    failed_at = handoff.created_at + timedelta(minutes=10)
    assert (
        repository.fail_stale_prepared(
            now=failed_at,
            stale_before=failed_at,
            error="checkpoint upload timed out",
            limit=10,
        )
        == 1
    )
    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=failed_at,
    )
    assert repository.mark_terminal_event_published(
        handoff_id=handoff.id,
        generation=handoff.generation,
        published_at=failed_at,
    )
    with repository._session_factory() as session:
        gc_record = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
            )
        )
        assert gc_record is not None
        assert gc_record.upload_completed_at is None

    outcome = repository.delete_snapshot_if_unreferenced(
        snapshot_object_key=handoff.snapshot_object_key,
        deleted_at=failed_at,
        delete_object=lambda _key: False,
    )
    assert outcome.value == "missing"


def test_missing_workflow_run_does_not_orphan_snapshot_gc_reference(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_prepared(repository)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = NOW
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == RUN_ID))

    assert repository.compensate_failed_terminal(
        handoff_id=handoff.id,
        generation=handoff.generation,
        compensated_at=NOW,
    )
    compensated = repository.get(handoff.id)
    assert compensated is not None
    assert compensated.terminal_compensated_at == NOW
    assert compensated.terminal_event_published_at == NOW
    candidates = repository.list_snapshot_gc_candidates(now=NOW, limit=10)
    assert [record.snapshot_object_key for record in candidates] == [handoff.snapshot_object_key]


def test_cleanup_expired_cancellation_tombstones_is_bounded(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    with repository._session_factory.begin() as session:
        session.add_all(
            [
                WorkflowHandoffCancellation(
                    task_id=f"task-{index}",
                    requested_at=NOW - timedelta(minutes=2),
                    expires_at=NOW - timedelta(minutes=1),
                    reason="stop",
                )
                for index in range(3)
            ]
        )
        session.add(
            WorkflowHandoffCancellation(
                task_id="task-live",
                requested_at=NOW,
                expires_at=NOW + timedelta(minutes=1),
                reason="stop",
            )
        )

    assert repository.cleanup_expired_cancellations(now=NOW, limit=2) == 2
    assert repository.cleanup_expired_cancellations(now=NOW, limit=2) == 1
    assert repository.cleanup_expired_cancellations(now=NOW, limit=2) == 0
    with repository._session_factory() as session:
        remaining = list(session.scalars(sa.select(WorkflowHandoffCancellation)))
        assert [record.task_id for record in remaining] == ["task-live"]


def test_terminal_retention_safety_rechecks_every_terminal_and_rag_fence(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository)
    retention_before = NOW

    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)

    handoff.state = WorkflowHandoffState.RESUMED
    handoff.resumed_at = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.resumed_at = retention_before + timedelta(microseconds=1)
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.resumed_at = retention_before
    handoff.terminal_compensated_at = retention_before
    handoff.terminal_event_published_at = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.terminal_event_published_at = retention_before
    assert repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)

    handoff.state = WorkflowHandoffState.FAILED
    handoff.failed_at = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.failed_at = retention_before + timedelta(microseconds=1)
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.failed_at = retention_before
    handoff.terminal_compensated_at = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.terminal_compensated_at = retention_before
    handoff.terminal_event_published_at = retention_before
    handoff.rag_document_id = "document-id"
    handoff.rag_document_error_marked_at = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.rag_document_error_marked_at = retention_before
    assert repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)

    handoff.state = WorkflowHandoffState.RESUMED
    handoff.resumed_at = retention_before
    handoff.resume_route = WorkflowHandoffResumeRoute.RAG_PIPELINE
    handoff.rag_source_batch_id = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.rag_source_batch_id = "source-batch"
    handoff.rag_tenant_id = None
    assert not repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)
    handoff.rag_tenant_id = TENANT_ID
    handoff.rag_queue_kind = RagPipelineQueueKind.REGULAR
    handoff.rag_dataset_id = str(uuid4())
    handoff.rag_tenant_isolated = True
    handoff.rag_group_sealed_at = retention_before
    handoff.rag_tenant_slot_released_at = retention_before
    assert repository._terminal_handoff_is_retention_safe(handoff, terminal_before=retention_before)


def test_cleanup_terminal_handoffs_requires_age_nonrunning_parent_and_deleted_snapshot(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    old_handoffs: list[WorkflowRunHandoff] = []
    for index in range(3):
        handoff = _create_ready(
            repository,
            object_key=f"workflow-handoffs/run/retention-{index}.bin",
        )
        _mark_resumed(repository, handoff)
        old_handoffs.append(handoff)
    recent = _create_ready(repository, object_key="workflow-handoffs/run/retention-recent.bin")
    _mark_resumed(repository, recent)

    retention_before = NOW - timedelta(days=7)
    with repository._session_factory.begin() as session:
        for index, handoff in enumerate(old_handoffs):
            persisted = session.get(WorkflowRunHandoff, handoff.id)
            snapshot_gc = session.scalar(
                sa.select(WorkflowHandoffSnapshotGC).where(
                    WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
                )
            )
            assert persisted is not None
            assert snapshot_gc is not None
            persisted.resumed_at = retention_before - timedelta(seconds=index + 1)
            snapshot_gc.deleted_at = retention_before - timedelta(days=1)
        persisted_recent = session.get(WorkflowRunHandoff, recent.id)
        recent_gc = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == recent.snapshot_object_key
            )
        )
        assert persisted_recent is not None
        assert recent_gc is not None
        persisted_recent.resumed_at = retention_before + timedelta(seconds=1)
        recent_gc.deleted_at = retention_before - timedelta(days=1)

    # The parent run is still RUNNING, so even fully aged rows stay available.
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=2) == 0

    with repository._session_factory.begin() as session:
        workflow_run = session.get(WorkflowRun, RUN_ID)
        first_gc = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == old_handoffs[0].snapshot_object_key
            )
        )
        assert workflow_run is not None
        assert first_gc is not None
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.finished_at = NOW
        # A terminal row remains the durable reference until blob deletion is
        # durably recorded, even when every other retention fence is satisfied.
        first_gc.deleted_at = None

    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=1) == 1
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 1
    with repository._session_factory() as session:
        remaining_ids = set(session.scalars(sa.select(WorkflowRunHandoff.id)))
    assert old_handoffs[0].id in remaining_ids
    assert recent.id in remaining_ids
    assert old_handoffs[1].id not in remaining_ids
    assert old_handoffs[2].id not in remaining_ids


def test_cleanup_failed_rag_handoff_waits_for_every_terminal_and_group_fence(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    metadata = RagPipelineHandoffGroupMetadata(
        source_batch_id="source-batch-retention",
        tenant_id=TENANT_ID,
        queue_kind=RagPipelineQueueKind.REGULAR,
        dataset_id=str(uuid4()),
        document_id=str(uuid4()),
        tenant_isolated=True,
    )
    handoff = _create_ready(
        repository,
        object_key="workflow-handoffs/run/rag-retention.bin",
        resume_route=WorkflowHandoffResumeRoute.RAG_PIPELINE,
        rag_group_metadata=metadata,
    )
    retention_before = NOW - timedelta(days=7)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        snapshot_gc = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
            )
        )
        assert persisted is not None
        assert workflow_run is not None
        assert snapshot_gc is not None
        persisted.state = WorkflowHandoffState.FAILED
        persisted.failed_at = retention_before - timedelta(days=1)
        persisted.last_error = "resume exhausted"
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.finished_at = NOW
        snapshot_gc.deleted_at = retention_before - timedelta(days=1)

    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 0
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.terminal_compensated_at = retention_before - timedelta(hours=3)
        persisted.terminal_event_published_at = retention_before - timedelta(hours=2)
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 0
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.rag_group_sealed_at = retention_before - timedelta(hours=1)
        persisted.rag_tenant_slot_released_at = retention_before - timedelta(minutes=30)
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 0
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.rag_document_error_marked_at = retention_before - timedelta(minutes=15)

    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 1
    assert repository.get(handoff.id) is None


def test_cleanup_resumed_handoff_waits_for_pending_terminal_outbox(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository, object_key="workflow-handoffs/run/resumed-outbox.bin")
    _mark_resumed(repository, handoff)
    retention_before = NOW - timedelta(days=7)
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        workflow_run = session.get(WorkflowRun, RUN_ID)
        snapshot_gc = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
            )
        )
        assert persisted is not None
        assert workflow_run is not None
        assert snapshot_gc is not None
        persisted.resumed_at = retention_before - timedelta(days=1)
        persisted.terminal_compensated_at = retention_before - timedelta(hours=1)
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_run.finished_at = NOW
        snapshot_gc.deleted_at = retention_before - timedelta(days=1)

    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 0
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.terminal_event_published_at = retention_before - timedelta(minutes=30)
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 1


def test_cleanup_completed_snapshot_gc_is_aged_unreferenced_and_bounded(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> None:
    handoff = _create_ready(repository, object_key="workflow-handoffs/run/still-referenced.bin")
    _mark_resumed(repository, handoff)
    retention_before = NOW - timedelta(days=7)
    old_records = [
        WorkflowHandoffSnapshotGC(snapshot_object_key=f"workflow-handoffs/orphan/{index}.bin") for index in range(3)
    ]
    recent_record = WorkflowHandoffSnapshotGC(snapshot_object_key="workflow-handoffs/orphan/recent.bin")
    with repository._session_factory.begin() as session:
        referenced_gc = session.scalar(
            sa.select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
            )
        )
        assert referenced_gc is not None
        referenced_gc.deleted_at = retention_before - timedelta(days=1)
        for index, record in enumerate(old_records):
            record.deleted_at = retention_before - timedelta(seconds=index + 1)
            session.add(record)
        recent_record.deleted_at = retention_before + timedelta(seconds=1)
        session.add(recent_record)

    assert repository.cleanup_completed_snapshot_gc(deleted_before=retention_before, limit=2) == 2
    assert repository.cleanup_completed_snapshot_gc(deleted_before=retention_before, limit=2) == 1
    assert repository.cleanup_completed_snapshot_gc(deleted_before=retention_before, limit=2) == 0
    with repository._session_factory() as session:
        remaining_keys = set(session.scalars(sa.select(WorkflowHandoffSnapshotGC.snapshot_object_key)))
    assert remaining_keys == {handoff.snapshot_object_key, recent_record.snapshot_object_key}

    # A missing parent is safe only after the terminal row itself passes all
    # fences; once removed, the aged GC outbox row can be pruned in the same scan.
    with repository._session_factory.begin() as session:
        persisted = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted is not None
        persisted.resumed_at = retention_before - timedelta(days=1)
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == RUN_ID))
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 1
    assert repository.cleanup_completed_snapshot_gc(deleted_before=retention_before, limit=10) == 1
