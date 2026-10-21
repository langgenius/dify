"""Durable document-index deliveries must not spend retry budget on lock contention."""

import pytest
from sqlalchemy.orm import Session

from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionDeferredError,
    KnowledgeTaskKind,
)
from tasks.document_indexing_task import normal_document_indexing_task, priority_document_indexing_task
from tasks.duplicate_document_indexing_task import (
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)


@pytest.mark.parametrize(
    ("task", "task_kind", "delegate_path"),
    [
        pytest.param(
            normal_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_CREATE,
            "tasks.document_indexing_task._document_indexing_with_tenant_queue",
            id="normal-create",
        ),
        pytest.param(
            priority_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_CREATE,
            "tasks.document_indexing_task._document_indexing_with_tenant_queue",
            id="priority-create",
        ),
        pytest.param(
            normal_duplicate_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE,
            "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue",
            id="normal-duplicate",
        ),
        pytest.param(
            priority_duplicate_document_indexing_task,
            KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE,
            "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue",
            id="priority-duplicate",
        ),
    ],
)
def test_repeated_lock_contention_does_not_spend_outbox_execution_budget(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    task: object,
    task_kind: KnowledgeTaskKind,
    delegate_path: str,
) -> None:
    tenant_id = "tenant-lock-deferral"
    dataset_id = "dataset-lock-deferral"
    document_id = "document-lock-deferral"
    intent = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        task_kind=task_kind.value,
        payload={},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()

    def lock_busy(*_args: object, **_kwargs: object) -> None:
        raise KnowledgeIndexingLockBusyError("dataset lock is held")

    monkeypatch.setattr(delegate_path, lock_busy)
    monkeypatch.setattr("tasks.knowledge_task_outbox_task.wake_knowledge_task_dispatcher", lambda: True)

    # The durable budget is ten attempts. More than ten lock deferrals must
    # leave the intent runnable because no provider/index execution began.
    for _ in range(12):
        with pytest.raises(KnowledgeTaskExecutionDeferredError, match="durably deferred"):
            task.run(  # type: ignore[attr-defined]
                tenant_id,
                dataset_id,
                [document_id],
                {document_id: "generation-1"},
                intent.id,
            )

        sqlite_session.expire_all()
        persisted = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert persisted is not None
        assert persisted.status == "pending"
        assert persisted.execution_attempts == 0
        assert persisted.last_error == "dataset lock is held"

        # Model the existing dispatcher publishing the deferred intent again.
        persisted.status = "dispatched"
        sqlite_session.commit()

    successful_calls: list[str] = []

    def succeed(*_args: object, **_kwargs: object) -> None:
        successful_calls.append(document_id)

    monkeypatch.setattr(delegate_path, succeed)
    task.run(  # type: ignore[attr-defined]
        tenant_id,
        dataset_id,
        [document_id],
        {document_id: "generation-1"},
        intent.id,
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert persisted is not None
    assert persisted.status == "completed"
    assert persisted.execution_attempts == 1
    assert successful_calls == [document_id]
