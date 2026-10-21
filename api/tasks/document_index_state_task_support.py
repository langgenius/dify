"""Shared execution boundary for document index add/remove tasks."""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select

from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from models.dataset import Document
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)

_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10
DocumentIndexStateAction = Literal["add", "remove"]


@dataclass(frozen=True)
class DocumentIndexStateTaskContext:
    ref: DocumentRef
    expected_generation: str | None
    delivery: KnowledgeTaskExecutionLease
    dataset_lease: KnowledgeIndexingLease
    document_lease: KnowledgeIndexingLease
    documents: SQLAlchemyDocumentRepository
    action: DocumentIndexStateAction

    def assert_owned(self) -> None:
        self.delivery.assert_owned()
        self.dataset_lease.assert_owned()
        self.document_lease.assert_owned()
        self.documents.assert_document_index_state_generation(
            self.ref,
            self.expected_generation,
            action=self.action,
        )

    @property
    def indexing_execution(self) -> DocumentIndexingExecution:
        return DocumentIndexingExecution(
            self.expected_generation,
            self.assert_owned,
            task_intent_id=self.delivery.intent_id,
            task_execution_id=self.delivery.execution_id,
        )

    def enqueue_current_repair(self) -> None:
        self.documents.enqueue_current_indexing_repairs(self.ref.dataset, [self.ref.document_id])


def _snapshot_document_state_task(
    document_id: str,
    expected_generation: str | None,
    *,
    generation_was_supplied: bool,
) -> tuple[DocumentRef | None, str | None]:
    with session_factory.create_session() as session:
        conditions = [Document.id == document_id]
        if generation_was_supplied:
            conditions.append(Document.indexing_generation == expected_generation)
        row = session.execute(
            select(Document.tenant_id, Document.dataset_id, Document.indexing_generation).where(*conditions).limit(1)
        ).one_or_none()
    if row is None:
        return None, None
    return DatasetRef(row.tenant_id, row.dataset_id).document(document_id), row.indexing_generation


@contextmanager
def document_index_state_task_execution(
    document_id: str,
    expected_generation: str | None,
    outbox_id: str | None,
    *,
    action: DocumentIndexStateAction,
) -> Generator[DocumentIndexStateTaskContext | None]:
    """Claim shared locks, delivery ownership, and the exact desired document generation."""

    if outbox_id is None and expected_generation is None:
        documents = SQLAlchemyDocumentRepository(
            session_factory=session_factory.get_session_maker(),
            wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        )
        converted = documents.convert_legacy_index_state_delivery(document_id)
        logger.info(
            "Legacy document index-state delivery reconciled document_id=%s legacy_action=%s converted=%s",
            document_id,
            action,
            converted,
        )
        yield None
        return

    ref, current_generation = _snapshot_document_state_task(
        document_id,
        expected_generation,
        generation_was_supplied=outbox_id is not None or expected_generation is not None,
    )
    if ref is None:
        if outbox_id is not None:
            with knowledge_task_execution(outbox_id):
                pass
        yield None
        return

    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    documents = SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    try:
        with locks.hold(
            dataset_index_lock_name(ref.dataset.dataset_id),
            timeout=_LEASE_TIMEOUT_SECONDS,
            blocking_timeout=30,
        ) as dataset_lease:
            with locks.hold(
                document_index_lock_name(ref.document_id),
                timeout=_LEASE_TIMEOUT_SECONDS,
            ) as document_lease:
                with knowledge_task_execution(outbox_id) as delivery:
                    if delivery is None:
                        yield None
                        return
                    task_context = DocumentIndexStateTaskContext(
                        ref=ref,
                        expected_generation=current_generation,
                        delivery=delivery,
                        dataset_lease=dataset_lease,
                        document_lease=document_lease,
                        documents=documents,
                        action=action,
                    )
                    if delivery.recovered_execution:
                        task_context.enqueue_current_repair()
                        yield None
                        return
                    try:
                        task_context.assert_owned()
                        yield task_context
                    except DocumentIndexingGenerationChangedError:
                        task_context.enqueue_current_repair()
                    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
                        task_context.enqueue_current_repair()
                        raise
    except KnowledgeIndexingLockBusyError as error:
        if outbox_id is None:
            raise
        if not defer_knowledge_task_before_execution(
            outbox_id,
            error=str(error),
            delay=_LOCK_RETRY_DELAY_SECONDS,
        ):
            logger.info("Skipping duplicate or terminal document state delivery: %s", outbox_id)
            yield None
            return
        raise KnowledgeTaskRequeuedError(
            f"document state task {outbox_id} was deferred while its indexing lock is held"
        ) from error
