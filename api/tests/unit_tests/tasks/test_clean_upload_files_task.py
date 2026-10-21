import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import NoReturn, Protocol, cast
from uuid import uuid4

import pytest
from celery.exceptions import Reject
from sqlalchemy import Table, event, insert
from sqlalchemy.orm import Session

import tasks.clean_upload_files_task as task_module
from configs import dify_config
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole, DataSourceType
from models.model import KnowledgeUploadFileReference, UploadFile
from repositories.knowledge.upload_file_repository import (
    claim_orphan_upload_files,
    guard_knowledge_owner_upload_references,
)
from services.knowledge.indexing.cleanup import UploadFileCleanup, UploadFilePendingDeletionError
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from tasks.clean_upload_files_task import (
    _clean_upload_files,
    defer_started_upload_file_cleanup_if_disabled,
)
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_document


@dataclass
class RecordingStorage:
    failures_remaining: int = 0
    attempts: list[str] = field(default_factory=list)

    def delete(self, key: str) -> None:
        self.attempts.append(key)
        if self.failures_remaining:
            self.failures_remaining -= 1
            raise RuntimeError("storage unavailable")


class CleanupTaskConfig(Protocol):
    dont_autoretry_for: tuple[type[Exception], ...]


class RequeueReject(Protocol):
    requeue: bool


@dataclass
class ForbiddenTaskCall:
    name: str
    calls: int = 0

    def __call__(self, *_args: object, **_kwargs: object) -> NoReturn:
        self.calls += 1
        raise AssertionError(f"Reject must not call Celery {self.name}")


@dataclass
class RecordingExecution:
    deferred: list[tuple[str, int]] = field(default_factory=list)
    failure: Exception | None = None

    def defer(self, *, error: str, delay_seconds: int) -> NoReturn:
        self.deferred.append((error, delay_seconds))
        if self.failure is not None:
            raise self.failure
        raise AssertionError("defer was expected to terminate delivery")


def _upload(*, tenant_id: str, key: str) -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name="source.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=datetime.now(UTC),
        used=True,
    )


@contextmanager
def _registered_document_upload_guard() -> Generator[None]:
    was_registered = event.contains(Document, "before_insert", guard_knowledge_owner_upload_references)
    if not was_registered:
        event.listen(Document, "before_insert", guard_knowledge_owner_upload_references)
    try:
        yield
    finally:
        if not was_registered and event.contains(Document, "before_insert", guard_knowledge_owner_upload_references):
            event.remove(Document, "before_insert", guard_knowledge_owner_upload_references)


@pytest.fixture(autouse=True)
def _enable_physical_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)


def test_file_cleanup_recovers_claim_after_storage_failure(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    upload = _upload(tenant_id=tenant_id, key="documents/retry.txt")
    sqlite_session.add(upload)
    sqlite_session.commit()
    upload_id = upload.id
    recorder = RecordingStorage(failures_remaining=1)
    monkeypatch.setattr(task_module, "storage", recorder)

    with pytest.raises(RuntimeError, match="storage unavailable"):
        _clean_upload_files(tenant_id=tenant_id, file_ids=[upload_id])

    sqlite_session.expire_all()
    pending = sqlite_session.get(UploadFile, upload_id)
    assert pending is not None
    assert pending.knowledge_cleanup_started_at is not None

    _clean_upload_files(tenant_id=tenant_id, file_ids=[upload_id])

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, upload_id) is None
    assert recorder.attempts == ["documents/retry.txt", "documents/retry.txt"]


def test_recovery_isolates_failed_candidate_and_finalizes_later_file(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    failed = _upload(tenant_id=tenant_id, key="documents/a-fails.txt")
    succeeded = _upload(tenant_id=tenant_id, key="documents/b-succeeds.txt")
    sqlite_session.add_all([failed, succeeded])
    sqlite_session.flush()
    failed_id = failed.id
    succeeded_id = succeeded.id
    now = datetime.now(UTC).replace(tzinfo=None)
    failed.knowledge_cleanup_started_at = now - timedelta(minutes=1)
    succeeded.knowledge_cleanup_started_at = now
    sqlite_session.commit()

    class SelectiveFailureStorage:
        def __init__(self) -> None:
            self.attempts: list[str] = []

        def delete(self, key: str) -> None:
            self.attempts.append(key)
            if key == "documents/a-fails.txt":
                raise RuntimeError("storage unavailable for first candidate")

    recorder = SelectiveFailureStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    task_module.recover_claimed_upload_file_cleanup_task.run()

    sqlite_session.expire_all()
    failed_after_recovery = sqlite_session.get(UploadFile, failed_id)
    assert failed_after_recovery is not None
    assert failed_after_recovery.knowledge_cleanup_started_at is not None
    assert sqlite_session.get(UploadFile, succeeded_id) is None
    assert recorder.attempts == ["documents/a-fails.txt", "documents/b-succeeds.txt"]


def test_file_cleanup_keeps_candidate_referenced_again_before_claim(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    upload = _upload(tenant_id=tenant_id, key="documents/reused.txt")
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=str(uuid4()),
    )
    document = make_document(
        document_id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        created_by=str(uuid4()),
    )
    sqlite_session.add_all([dataset, document, upload])
    sqlite_session.flush()
    sqlite_session.add(
        KnowledgeUploadFileReference(
            tenant_id=tenant_id,
            upload_file_id=upload.id,
            dataset_id=dataset_id,
            document_id=document_id,
            kind="document_source",
            resource_id=document_id,
        )
    )
    sqlite_session.commit()
    upload_id = upload.id
    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    _clean_upload_files(tenant_id=tenant_id, file_ids=[upload_id])

    sqlite_session.expire_all()
    retained = sqlite_session.get(UploadFile, upload_id)
    assert retained is not None
    assert retained.knowledge_cleanup_started_at is None
    assert recorder.attempts == []


def test_file_cleanup_retry_releases_claim_after_unindexed_reference_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    upload = _upload(tenant_id=tenant_id, key="documents/reused-by-old-worker.txt")
    sqlite_session.add(upload)
    sqlite_session.flush()
    upload_id = upload.id
    candidate = (UploadFileCleanup(id=upload_id, key=upload.key),)
    claimed = claim_orphan_upload_files(sqlite_session, tenant_id=tenant_id, files=candidate)
    assert claimed == candidate
    sqlite_session.commit()

    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=str(uuid4()),
    )
    sqlite_session.add(dataset)
    sqlite_session.commit()
    document = make_document(
        document_id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        data_source_type=DataSourceType.LOCAL_FILE,
        data_source_info=json.dumps({"related_id": upload_id}),
        created_by=str(uuid4()),
    )
    legacy_document_values = {
        "id": document.id,
        "tenant_id": document.tenant_id,
        "dataset_id": document.dataset_id,
        "position": document.position,
        "data_source_type": document.data_source_type,
        "data_source_info": document.data_source_info,
        "batch": document.batch,
        "name": document.name,
        "created_from": document.created_from,
        "created_by": document.created_by,
    }

    with _registered_document_upload_guard():
        sqlite_session.add(document)
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()

        # This row models a reference committed by a legacy writer that predates
        # mapper fences. Core insertion deliberately bypasses ORM writer events.
        sqlite_session.execute(insert(cast(Table, Document.__table__)).values(**legacy_document_values))
        sqlite_session.commit()

    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    _clean_upload_files(tenant_id=tenant_id, file_ids=[upload_id])

    sqlite_session.expire_all()
    retained = sqlite_session.get(UploadFile, upload_id)
    assert retained is not None
    assert retained.knowledge_cleanup_started_at is None
    assert recorder.attempts == []


def test_gate_defers_durable_delivery_before_execution_budget_is_claimed(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=False)
    deferred: list[tuple[str, str, int]] = []

    def defer(intent_id: str, *, error: str, delay: int) -> bool:
        deferred.append((intent_id, error, delay))
        return True

    def execute(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("gated delivery must not claim execution")

    monkeypatch.setattr(task_module, "defer_knowledge_task_before_execution", defer)
    monkeypatch.setattr(task_module, "knowledge_task_execution", execute)

    task_module.clean_upload_files_task.run(["file-1"], "tenant-1", "intent-1")

    assert deferred == [
        (
            "intent-1",
            "Upload-file physical cleanup is disabled by the deployment gate",
            dify_config.UPLOAD_FILE_CLEANUP_DEFER_SECONDS,
        )
    ]


def test_gate_requeues_original_legacy_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=False)

    def fail_if_called(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("Reject must preserve the original delivery")

    execute = fail_if_called
    retry = fail_if_called
    apply_async = fail_if_called
    monkeypatch.setattr(task_module, "knowledge_task_execution", execute)
    monkeypatch.setattr(task_module.clean_upload_files_task, "retry", retry)
    monkeypatch.setattr(task_module.clean_upload_files_task, "apply_async", apply_async)

    with pytest.raises(Reject) as raised:
        task_module.clean_upload_files_task.run(["file-1"], "tenant-1")

    assert cast(RequeueReject, raised.value).requeue is True


def test_all_legacy_cleanup_task_wrappers_preserve_rejected_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    from tasks.batch_clean_document_task import batch_clean_document_task
    from tasks.clean_dataset_task import clean_dataset_task
    from tasks.clean_document_task import clean_document_task
    from tasks.delete_segment_from_index_task import delete_segment_from_index_task

    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=False)

    def assert_task_rejects_delivery(task: object, invoke: Callable[[], object]) -> None:
        retry = ForbiddenTaskCall("retry")
        apply_async = ForbiddenTaskCall("apply_async")
        monkeypatch.setattr(task, "retry", retry)
        monkeypatch.setattr(task, "apply_async", apply_async)

        with pytest.raises(Reject) as raised:
            invoke()

        assert cast(RequeueReject, raised.value).requeue is True
        assert Reject in cast(CleanupTaskConfig, task).dont_autoretry_for
        assert retry.calls == 0
        assert apply_async.calls == 0

    assert_task_rejects_delivery(
        task_module.clean_upload_files_task,
        lambda: task_module.clean_upload_files_task.run(["file-1"], "tenant-1"),
    )
    assert_task_rejects_delivery(
        clean_document_task,
        lambda: clean_document_task.run("document-1", "dataset-1", "text_model", None),
    )
    assert_task_rejects_delivery(
        batch_clean_document_task,
        lambda: batch_clean_document_task.run(["document-1"], "dataset-1", "text_model", []),
    )
    assert_task_rejects_delivery(
        clean_dataset_task,
        lambda: clean_dataset_task.run("dataset-1", "tenant-1", None, None, None, None),
    )
    assert_task_rejects_delivery(
        delete_segment_from_index_task,
        lambda: delete_segment_from_index_task.run(["node-1"], "dataset-1", "document-1", ["segment-1"]),
    )


def test_gate_closing_after_claim_uses_execution_deferral(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=False)
    execution = RecordingExecution(failure=RuntimeError("delivery deferred"))

    with pytest.raises(RuntimeError, match="delivery deferred"):
        defer_started_upload_file_cleanup_if_disabled(
            cast(KnowledgeTaskExecutionLease, execution), outbox_id="intent-1"
        )

    assert execution.deferred == [
        (
            "Upload-file physical cleanup is disabled by the deployment gate",
            dify_config.UPLOAD_FILE_CLEANUP_DEFER_SECONDS,
        )
    ]


def test_gate_closing_after_legacy_claim_requeues_original_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=False)
    execution = RecordingExecution()

    with pytest.raises(Reject) as raised:
        defer_started_upload_file_cleanup_if_disabled(cast(KnowledgeTaskExecutionLease, execution), outbox_id=None)

    assert cast(RequeueReject, raised.value).requeue is True
    assert execution.deferred == []
