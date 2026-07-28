from collections.abc import Callable
from datetime import datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.workflow import WorkflowRun
from models.workflow_handoff import (
    WorkflowHandoffCancellation,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffSnapshotGC,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from services.workflow_handoff_service import (
    WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
    UnsupportedWorkflowHandoffSnapshotVersionError,
    WorkflowHandoffPreparationCancelledError,
    WorkflowHandoffService,
    WorkflowHandoffSnapshotIntegrityError,
)


class _MemoryStorage:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.save_calls = 0

    def save(self, filename: str, data: bytes) -> None:
        self.save_calls += 1
        self.objects[filename] = data

    def load_once(self, filename: str) -> bytes:
        return self.objects[filename]

    def delete(self, filename: str) -> None:
        del self.objects[filename]


class _CallbackMemoryStorage(_MemoryStorage):
    def __init__(self, on_save: Callable[[], None]):
        super().__init__()
        self._on_save = on_save

    def save(self, filename: str, data: bytes) -> None:
        super().save(filename, data)
        self._on_save()


def _sql_repository() -> tuple[SQLAlchemyWorkflowRunHandoffRepository, str]:
    engine = sa.create_engine("sqlite:///:memory:")
    WorkflowRun.__table__.create(engine)
    WorkflowRunHandoff.__table__.create(engine)
    WorkflowHandoffCancellation.__table__.create(engine)
    WorkflowHandoffSnapshotGC.__table__.create(engine)
    run_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(
            WorkflowRun.__table__.insert(),
            {
                "id": run_id,
                "tenant_id": str(uuid4()),
                "app_id": str(uuid4()),
                "workflow_id": str(uuid4()),
                "type": "workflow",
                "triggered_from": "app-run",
                "version": "1",
                "status": WorkflowExecutionStatus.RUNNING,
                "created_by_role": "account",
                "created_by": str(uuid4()),
            },
        )
    return (
        SQLAlchemyWorkflowRunHandoffRepository(sessionmaker(bind=engine, class_=Session, expire_on_commit=False)),
        run_id,
    )


def _handoff(**updates: object) -> WorkflowRunHandoff:
    handoff = WorkflowRunHandoff(
        workflow_run_id="run-1",
        generation=1,
        task_id="task-1",
        snapshot_object_key="workflow-run-handoffs/run-1/checksum.json",
        snapshot_schema_version=WORKFLOW_HANDOFF_SNAPSHOT_SCHEMA_VERSION,
        snapshot_checksum="checksum",
        snapshot_size_bytes=5,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    for name, value in updates.items():
        setattr(handoff, name, value)
    return handoff


def test_create_prepared_commits_intent_before_upload_then_finalizes() -> None:
    storage = _MemoryStorage()
    repository = Mock()
    created: dict[str, WorkflowRunHandoff] = {}

    def _create_intent(**kwargs: object) -> WorkflowRunHandoff:
        assert kwargs["snapshot_object_key"] not in storage.objects
        intent = _handoff(**kwargs, state=WorkflowHandoffState.PREPARING)
        created["intent"] = intent
        return intent

    def _finish_intent(**kwargs: object) -> WorkflowRunHandoff:
        intent = created["intent"]
        assert kwargs == {"handoff_id": intent.id, "generation": intent.generation}
        assert intent.snapshot_object_key in storage.objects
        intent.state = WorkflowHandoffState.PREPARED
        return intent

    repository.create_preparing.side_effect = _create_intent
    repository.finish_preparing.side_effect = _finish_intent
    service = WorkflowHandoffService(repository=repository, storage=storage)

    handoff = service.create_prepared_from_state(
        workflow_run_id="run-1",
        task_id="task-1",
        serialized_state='{"state": "ready"}',
        resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT,
        source_worker_id="worker-old",
    )

    assert handoff.snapshot_object_key in storage.objects
    assert storage.objects[handoff.snapshot_object_key] == b'{"state": "ready"}'
    create_args = repository.create_preparing.call_args.kwargs
    assert create_args["task_id"] == "task-1"
    assert create_args["snapshot_object_key"].startswith("workflow-run-handoffs/run-1/")
    assert create_args["snapshot_size_bytes"] == len(b'{"state": "ready"}')
    assert create_args["snapshot_checksum"] in create_args["snapshot_object_key"]


def test_create_prepared_does_not_upload_when_intent_commit_fails() -> None:
    storage = _MemoryStorage()
    repository = Mock()
    repository.create_preparing.side_effect = RuntimeError("database unavailable")
    service = WorkflowHandoffService(repository=repository, storage=storage)

    with pytest.raises(RuntimeError, match="database unavailable"):
        service.create_prepared_from_state(
            workflow_run_id="run-1",
            task_id="task-1",
            serialized_state=b"state",
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id="worker-old",
        )

    assert storage.objects == {}
    repository.finish_preparing.assert_not_called()


def test_stop_during_storage_save_wins_and_upload_never_becomes_prepared() -> None:
    repository, run_id = _sql_repository()
    requested_at = datetime(2026, 7, 28, 12, 0, 0)
    storage = _CallbackMemoryStorage(
        lambda: repository.request_cancel_by_task_id(
            task_id="task-stop-during-save",
            requested_at=requested_at,
        )
    )
    service = WorkflowHandoffService(repository=repository, storage=storage)

    with pytest.raises(WorkflowHandoffPreparationCancelledError):
        service.create_prepared_from_state(
            workflow_run_id=run_id,
            task_id="task-stop-during-save",
            serialized_state=b"state",
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id="worker-old",
        )

    handoff = repository.get_latest_by_run(run_id)
    assert handoff is not None
    assert handoff.state == WorkflowHandoffState.FAILED
    assert handoff.cancel_requested_at == requested_at
    assert storage.save_calls == 1


def test_stop_after_upload_before_finish_wins() -> None:
    repository, run_id = _sql_repository()
    requested_at = datetime(2026, 7, 28, 12, 0, 0)
    wrapped_repository = Mock(wraps=repository)

    def _stop_before_finish(**kwargs: object) -> WorkflowRunHandoff | None:
        assert (
            repository.request_cancel_by_task_id(
                task_id="task-stop-before-finish",
                requested_at=requested_at,
            )
            == 1
        )
        return repository.finish_preparing(**kwargs)  # type: ignore[arg-type]

    wrapped_repository.finish_preparing.side_effect = _stop_before_finish
    storage = _MemoryStorage()
    service = WorkflowHandoffService(repository=wrapped_repository, storage=storage)

    with pytest.raises(WorkflowHandoffPreparationCancelledError):
        service.create_prepared_from_state(
            workflow_run_id=run_id,
            task_id="task-stop-before-finish",
            serialized_state=b"state",
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id="worker-old",
        )

    handoff = repository.get_latest_by_run(run_id)
    assert handoff is not None
    assert handoff.state == WorkflowHandoffState.FAILED
    assert storage.save_calls == 1


def test_finish_commit_ambiguity_replays_without_second_upload_or_generation() -> None:
    repository, run_id = _sql_repository()
    wrapped_repository = Mock(wraps=repository)

    def _commit_then_disconnect(**kwargs: object) -> WorkflowRunHandoff:
        prepared = repository.finish_preparing(**kwargs)  # type: ignore[arg-type]
        assert prepared is not None
        raise RuntimeError("database commit outcome unknown")

    wrapped_repository.finish_preparing.side_effect = _commit_then_disconnect
    storage = _MemoryStorage()
    service = WorkflowHandoffService(repository=wrapped_repository, storage=storage)
    arguments = {
        "workflow_run_id": run_id,
        "task_id": "task-ambiguous-finish",
        "serialized_state": b"state",
        "resume_route": WorkflowHandoffResumeRoute.WORKFLOW,
        "source_worker_id": "worker-old",
    }

    with pytest.raises(RuntimeError, match="commit outcome unknown"):
        service.create_prepared_from_state(**arguments)

    committed = repository.get_latest_by_run(run_id)
    assert committed is not None
    assert committed.state == WorkflowHandoffState.PREPARED
    replay = service.create_prepared_from_state(**arguments)
    assert replay.id == committed.id
    assert replay.generation == 1
    assert storage.save_calls == 1
    assert wrapped_repository.finish_preparing.call_count == 1


def test_snapshot_key_is_stable_for_callback_replay_and_scoped_to_worker_and_route() -> None:
    storage = _MemoryStorage()
    repository = Mock()
    created: dict[str, WorkflowRunHandoff] = {}

    def _create_intent(**kwargs: object) -> WorkflowRunHandoff:
        intent = _handoff(**kwargs, state=WorkflowHandoffState.PREPARING)
        created["intent"] = intent
        return intent

    def _finish_intent(**kwargs: object) -> WorkflowRunHandoff:
        intent = created["intent"]
        assert kwargs == {"handoff_id": intent.id, "generation": intent.generation}
        intent.state = WorkflowHandoffState.PREPARED
        return intent

    repository.create_preparing.side_effect = _create_intent
    repository.finish_preparing.side_effect = _finish_intent
    service = WorkflowHandoffService(repository=repository, storage=storage)
    arguments = {
        "workflow_run_id": "run-1",
        "task_id": "task-1",
        "serialized_state": b"state",
        "resume_route": WorkflowHandoffResumeRoute.WORKFLOW,
    }

    first = service.create_prepared_from_state(**arguments, source_worker_id="worker-a")
    replay = service.create_prepared_from_state(**arguments, source_worker_id="worker-a")
    next_worker = service.create_prepared_from_state(**arguments, source_worker_id="worker-b")
    alternate_route = service.create_prepared_from_state(
        workflow_run_id="run-1",
        task_id="task-1",
        serialized_state=b"state",
        resume_route=WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW,
        source_worker_id="worker-a",
    )

    assert replay.snapshot_object_key == first.snapshot_object_key
    assert next_worker.snapshot_object_key != first.snapshot_object_key
    assert alternate_route.snapshot_object_key != first.snapshot_object_key


def test_load_and_verify_state_rejects_size_checksum_and_schema_mismatches() -> None:
    storage = _MemoryStorage()
    repository = Mock()
    service = WorkflowHandoffService(repository=repository, storage=storage)
    payload = b"state"
    checksum = "4ba69735ca53765ed6a709edb56c6ea236b7193a3b29a6b390c346f0f4340e4e"
    handoff = _handoff(snapshot_checksum=checksum)
    storage.objects[handoff.snapshot_object_key] = payload

    assert service.load_and_verify_state(handoff) == payload

    with pytest.raises(WorkflowHandoffSnapshotIntegrityError, match="size mismatch"):
        service.load_and_verify_state(_handoff(snapshot_checksum=checksum, snapshot_size_bytes=4))
    with pytest.raises(WorkflowHandoffSnapshotIntegrityError, match="checksum mismatch"):
        service.load_and_verify_state(_handoff(snapshot_checksum="0" * 64))
    with pytest.raises(UnsupportedWorkflowHandoffSnapshotVersionError):
        service.load_and_verify_state(_handoff(snapshot_schema_version="future/v2"))


def test_delete_terminal_snapshot_rejects_active_handoff() -> None:
    storage = _MemoryStorage()
    repository = Mock()
    service = WorkflowHandoffService(repository=repository, storage=storage)
    active = _handoff()
    storage.objects[active.snapshot_object_key] = b"state"

    with pytest.raises(ValueError, match="active handoff"):
        service.delete_terminal_snapshot(active)

    active.state = WorkflowHandoffState.RESUMED
    service.delete_terminal_snapshot(active)
    assert storage.objects == {}
