from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from types import ModuleType
from typing import Protocol, cast, override

import pytest

from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from services.rag_pipeline.payload_recovery import PipelinePayloadRecoveryMetadataMissingError
from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskClaimAlreadyActiveError,
    RagPipelineTaskCompletion,
    RagPipelineTaskExecutionBudgetExhaustedError,
)
from tasks.rag_pipeline import priority_rag_pipeline_run_task as priority_worker
from tasks.rag_pipeline import rag_pipeline_run_task as regular_worker


class _BatchHelper(Protocol):
    def __call__(
        self,
        rag_pipeline_invoke_entities_file_id: str,
        tenant_id: str,
        *,
        tenant_queue_receipt: str | None,
    ) -> None: ...


class _WorkerTask(Protocol):
    queue: str

    def run(
        self,
        rag_pipeline_invoke_entities_file_id: str,
        tenant_id: str,
        *,
        tenant_queue_receipt: str | None,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class _Target:
    module: ModuleType
    helper_name: str
    helper: _BatchHelper
    task: _WorkerTask
    v2_task: _WorkerTask
    expected_v2_queue: str


TARGETS = (
    pytest.param(
        _Target(
            module=regular_worker,
            helper_name="_run_rag_pipeline_batch",
            helper=regular_worker._run_rag_pipeline_batch,
            task=cast("_WorkerTask", regular_worker.rag_pipeline_run_task),
            v2_task=cast("_WorkerTask", regular_worker.rag_pipeline_run_task_v2),
            expected_v2_queue="pipeline_v2",
        ),
        id="regular",
    ),
    pytest.param(
        _Target(
            module=priority_worker,
            helper_name="_run_priority_rag_pipeline_batch",
            helper=priority_worker._run_priority_rag_pipeline_batch,
            task=cast("_WorkerTask", priority_worker.priority_rag_pipeline_run_task),
            v2_task=cast("_WorkerTask", priority_worker.priority_rag_pipeline_run_task_v2),
            expected_v2_queue="priority_pipeline_v2",
        ),
        id="priority",
    ),
)


@dataclass
class _InputFile:
    fail_read: bool = False
    read_error: Exception | None = None
    content: bytes = b"[]"
    deleted: list[str] = field(default_factory=list)
    reads: list[str] = field(default_factory=list)

    def get_file_content(self, file_id: str) -> bytes:
        self.reads.append(file_id)
        if self.read_error is not None:
            raise self.read_error
        if self.fail_read:
            raise RuntimeError("storage unavailable")
        assert file_id == "file-1"
        return self.content

    def delete_file(self, file_id: str) -> None:
        self.deleted.append(file_id)


@dataclass
class _TenantQueue:
    completed: list[str] = field(default_factory=list)
    dead_lettered: list[tuple[str, str]] = field(default_factory=list)
    released: list[str] = field(default_factory=list)
    deferred: list[tuple[str, int]] = field(default_factory=list)
    exhausted_deferred: list[tuple[str, int, str, bool]] = field(default_factory=list)

    @contextmanager
    def maintain(self, _receipt: str) -> Generator[None]:
        yield

    def complete(self, receipt: str, *, concurrency: int) -> RagPipelineTaskCompletion:
        assert concurrency == 1
        self.completed.append(receipt)
        return RagPipelineTaskCompletion(owned=True, next_claims=())

    def release(self, receipt: str) -> bool:
        self.released.append(receipt)
        return True

    def defer(self, receipt: str, *, delay_seconds: int) -> bool:
        self.deferred.append((receipt, delay_seconds))
        return True

    def defer_exhausted(
        self,
        receipt: str,
        *,
        delay_seconds: int,
        error: str,
        refund_attempt: bool = False,
    ) -> bool:
        self.exhausted_deferred.append((receipt, delay_seconds, error, refund_attempt))
        return True

    def dead_letter(self, receipt: str, *, concurrency: int, error: str) -> RagPipelineTaskCompletion:
        assert concurrency == 1
        self.dead_lettered.append((receipt, error))
        return RagPipelineTaskCompletion(owned=True, next_claims=())


class _ActiveTenantQueue:
    @contextmanager
    def maintain(self, receipt: str) -> Generator[None]:
        raise RagPipelineTaskClaimAlreadyActiveError(receipt)
        yield


class _BudgetExhaustedTenantQueue(_TenantQueue):
    @override
    @contextmanager
    def maintain(self, _receipt: str) -> Generator[None]:
        raise RagPipelineTaskExecutionBudgetExhaustedError(_receipt)
        yield


class _LegacyExhaustedOnceTenantQueue(_TenantQueue):
    exhausted = True

    @override
    @contextmanager
    def maintain(self, _receipt: str) -> Generator[None]:
        if self.exhausted:
            self.exhausted = False
            raise RagPipelineTaskExecutionBudgetExhaustedError(_receipt)
        yield


@dataclass
class _Session:
    closed: bool = False

    def close(self) -> None:
        self.closed = True


@dataclass(frozen=True)
class _Database:
    session: _Session
    engine: object = field(default_factory=object)


class _FlaskApp:
    def _get_current_object(self) -> _FlaskApp:
        return self


@pytest.mark.parametrize("target", TARGETS)
def test_success_acknowledges_before_deleting_input(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile()
    tenant_queue = _TenantQueue()
    session = _Session()
    dispatched: list[tuple[object, ...]] = []

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(
        target.module,
        "dispatch_rag_pipeline_claims",
        lambda **kwargs: dispatched.append(tuple(kwargs)),
    )
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", _Database(session=session))

    target.helper("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert tenant_queue.completed == ["receipt-1"]
    assert tenant_queue.released == []
    assert input_file.deleted == ["file-1"]
    assert len(dispatched) == 1
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_failure_requeues_claim_and_preserves_input(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile(fail_read=True)
    tenant_queue = _TenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", _Database(session=session))

    with pytest.raises(RuntimeError, match="storage unavailable"):
        target.helper("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert tenant_queue.completed == []
    assert tenant_queue.released == ["receipt-1"]
    assert input_file.deleted == []
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_lock_contention_defers_without_spending_budget_or_releasing_payload(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile(read_error=KnowledgeIndexingLockBusyError("document busy"))
    tenant_queue = _TenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", _Database(session=session))

    target.task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert tenant_queue.deferred == [("receipt-1", 10)]
    assert tenant_queue.released == []
    assert tenant_queue.completed == []
    assert tenant_queue.dead_lettered == []
    assert input_file.deleted == []
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_duplicate_receipt_does_not_enter_worker_body(monkeypatch: pytest.MonkeyPatch, target: _Target) -> None:
    calls: list[tuple[object, ...]] = []
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: _ActiveTenantQueue())
    monkeypatch.setattr(target.module, target.helper_name, lambda *args, **kwargs: calls.append((args, kwargs)))

    target.task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert calls == []


@pytest.mark.parametrize("target", TARGETS)
def test_v2_worker_failure_releases_claim_and_preserves_snapshot_input(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile(fail_read=True)
    tenant_queue = _TenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", _Database(session=session))

    with pytest.raises(RuntimeError, match="storage unavailable"):
        target.v2_task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-v2")

    assert target.v2_task.queue == target.expected_v2_queue
    assert tenant_queue.completed == []
    assert tenant_queue.released == ["receipt-v2"]
    assert input_file.deleted == []
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_invalid_payload_is_dead_lettered_and_input_is_cleaned(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile(content=b"not-json")
    tenant_queue = _TenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", _Database(session=session))
    monkeypatch.setattr(target.module, "dispatch_rag_pipeline_claims", lambda **_kwargs: 0)
    monkeypatch.setattr(target.module, "_persist_claim_recovery", lambda *_args: None)

    target.helper("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert tenant_queue.completed == []
    assert tenant_queue.released == []
    assert tenant_queue.dead_lettered == [("receipt-1", "RAG pipeline batch payload is invalid")]
    assert input_file.deleted == ["file-1"]
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_execution_budget_exhaustion_dead_letters_without_running_batch(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile()
    tenant_queue = _BudgetExhaustedTenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "db", _Database(session=session))
    monkeypatch.setattr(target.module, "dispatch_rag_pipeline_claims", lambda **_kwargs: 0)
    recovered: list[tuple[object, ...]] = []
    monkeypatch.setattr(target.module, "_persist_claim_recovery", lambda *args: recovered.append(args))
    monkeypatch.setattr(
        target.module,
        target.helper_name,
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("batch must not run")),
    )

    target.task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert tenant_queue.dead_lettered == [("receipt-1", "execution budget exhausted")]
    assert recovered == [(tenant_queue, "receipt-1", "tenant-1")]
    assert input_file.deleted == ["file-1"]
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_execution_budget_exhaustion_retains_payload_until_document_recovery_is_durable(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile()
    tenant_queue = _BudgetExhaustedTenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "db", _Database(session=session))
    monkeypatch.setattr(
        target.module,
        "_persist_claim_recovery",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("repair database unavailable")),
    )

    target.task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-1")

    assert tenant_queue.dead_lettered == []
    assert tenant_queue.exhausted_deferred == [
        ("receipt-1", 60, "pipeline payload recovery pending: repair database unavailable", False)
    ]
    assert input_file.deleted == []
    assert session.closed is True


@pytest.mark.parametrize("target", TARGETS)
def test_legacy_exhausted_claim_refunds_budget_then_reads_restored_payload(
    monkeypatch: pytest.MonkeyPatch,
    target: _Target,
) -> None:
    input_file = _InputFile()
    tenant_queue = _LegacyExhaustedOnceTenantQueue()
    session = _Session()

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "RagPipelineTenantTaskQueue", lambda _tenant_id: tenant_queue)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", _Database(session=session))
    monkeypatch.setattr(target.module, "dispatch_rag_pipeline_claims", lambda **_kwargs: 0)
    monkeypatch.setattr(
        target.module,
        "_persist_claim_recovery",
        lambda *_args: (_ for _ in ()).throw(
            PipelinePayloadRecoveryMetadataMissingError("legacy claim has no recovery manifest")
        ),
    )

    target.task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-exhausted")

    assert input_file.reads == []
    assert tenant_queue.exhausted_deferred == [
        (
            "receipt-exhausted",
            60,
            "legacy pipeline payload retry pending: legacy claim has no recovery manifest",
            True,
        )
    ]
    assert input_file.deleted == []

    target.task.run("file-1", "tenant-1", tenant_queue_receipt="receipt-recovered")

    assert input_file.reads == ["file-1"]
    assert tenant_queue.completed == ["receipt-recovered"]
    assert input_file.deleted == ["file-1"]
