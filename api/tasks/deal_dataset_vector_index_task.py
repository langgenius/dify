import logging
import time
from functools import partial

import click
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import IndexingStatus
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.segment_query_repository import get_segment_child_chunks
from repositories.knowledge.segment_read_adapter import get_segment_attachments
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter
from repositories.knowledge.task_outbox_repository import enqueue_knowledge_task
from services.api_token_service import ApiTokenCache
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError, KnowledgeTaskKind
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


class DatasetVectorIndexingError(RuntimeError):
    """One or more documents did not reach the requested dataset index state."""


class DatasetVectorLeaseLostError(KnowledgeIndexingLeaseLostError):
    """The vector task lost its lease after resolving the trusted dataset owner."""

    def __init__(self, dataset_ref: DatasetRef) -> None:
        super().__init__(f"Dataset vector indexing lease lost for {dataset_ref.dataset_id}")
        self.dataset_ref = dataset_ref


def _build_index_materials(
    *,
    session: Session,
    dataset: Dataset,
    dataset_document: DatasetDocument,
    segments: list[DocumentSegment],
) -> tuple[list[Document], list[AttachmentDocument]]:
    """Build the same text, child, and attachment inputs for every rebuild action."""

    documents: list[Document] = []
    attachments_by_id: dict[str, AttachmentDocument] = {}
    for segment in segments:
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
            },
        )
        if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
            document.children = [
                ChildDocument(
                    page_content=child_chunk.content,
                    metadata={
                        "doc_id": child_chunk.index_node_id,
                        "doc_hash": child_chunk.index_node_hash,
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
                    },
                )
                for child_chunk in get_segment_child_chunks(segment, session=session)
            ]
        if dataset.is_multimodal:
            for attachment in get_segment_attachments(segment, session=session):
                attachment_id = attachment["id"]
                attachments_by_id[attachment_id] = AttachmentDocument(
                    page_content=attachment["name"],
                    metadata={
                        "doc_id": attachment_id,
                        "doc_hash": "",
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
                        "doc_type": DocType.IMAGE,
                    },
                )
        documents.append(document)
    return documents, list(attachments_by_id.values())


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(KnowledgeIndexingLockBusyError, KnowledgeIndexingLeaseLostError, DatasetVectorIndexingError),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def deal_dataset_vector_index_task(
    dataset_id: str,
    action: str,
    expected_indexing_technique: str | None = None,
    expected_embedding_model_provider: str | None = None,
    expected_embedding_model: str | None = None,
    regenerate_summary_vectors: bool = False,
    outbox_id: str | None = None,
    tenant_id: str | None = None,
) -> None:
    """
    Async deal dataset from index
    :param dataset_id: dataset_id
    :param action: action
    Usage: deal_dataset_vector_index_task.delay(dataset_id, action)
    """
    if (
        outbox_id is None
        and tenant_id is None
        and expected_indexing_technique is None
        and expected_embedding_model_provider is None
        and expected_embedding_model is None
    ):
        datasets = SQLAlchemyDatasetRepository(
            session_factory=session_factory.get_session_maker(),
            wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
            revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
        )
        converted = datasets.convert_legacy_vector_index_delivery(dataset_id)
        logger.info(
            "Legacy dataset vector delivery reconciled dataset_id=%s legacy_action=%s converted=%s",
            dataset_id,
            action,
            converted,
        )
        return

    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        execution.assert_owned()
        if execution.recovered_execution:
            if tenant_id is None:
                raise ValueError("Recovered dataset vector delivery requires a tenant owner")
            datasets = SQLAlchemyDatasetRepository(
                session_factory=session_factory.get_session_maker(),
                wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
                revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
            )
            repaired = datasets.enqueue_current_vector_repair(DatasetRef(tenant_id, dataset_id))
            logger.warning(
                "Recovered dataset vector execution scheduled current repair dataset_id=%s repaired=%s",
                dataset_id,
                repaired,
            )
            return
        _run_dataset_vector_index_task(
            dataset_id=dataset_id,
            action=action,
            expected_indexing_technique=expected_indexing_technique,
            expected_embedding_model_provider=expected_embedding_model_provider,
            expected_embedding_model=expected_embedding_model,
            regenerate_summary_vectors=regenerate_summary_vectors,
            tenant_id=tenant_id,
        )


def _run_dataset_vector_index_task(
    *,
    dataset_id: str,
    action: str,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    regenerate_summary_vectors: bool,
    tenant_id: str | None,
) -> None:
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    datasets = SQLAlchemyDatasetRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
    )
    repair_ref = DatasetRef(tenant_id, dataset_id) if tenant_id is not None else None
    try:
        with locks.hold(dataset_index_lock_name(dataset_id), timeout=600, blocking_timeout=30) as lease:
            state_matched, loaded_ref = _deal_dataset_vector_index(
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                action=action,
                expected_indexing_technique=expected_indexing_technique,
                expected_embedding_model_provider=expected_embedding_model_provider,
                expected_embedding_model=expected_embedding_model,
                regenerate_summary_vectors=regenerate_summary_vectors,
                lease=lease,
            )
            repair_ref = loaded_ref or repair_ref
        if not state_matched:
            logger.warning(
                "Stale dataset vector delivery may have completed external work; scheduling repair: %s", dataset_id
            )
            if repair_ref is not None:
                datasets.enqueue_current_vector_repair(repair_ref)
    except KnowledgeIndexingLeaseLostError as error:
        logger.exception("Dataset vector update lost its lease; scheduling convergence repair: %s", dataset_id)
        if isinstance(error, DatasetVectorLeaseLostError):
            repair_ref = error.dataset_ref
        if repair_ref is None:
            raise
        datasets.enqueue_current_vector_repair(repair_ref)


def _deal_dataset_vector_index(
    *,
    dataset_id: str,
    tenant_id: str | None,
    action: str,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    regenerate_summary_vectors: bool,
    lease: KnowledgeIndexingLease,
) -> tuple[bool, DatasetRef | None]:
    logger.info(click.style(f"Start deal dataset vector index: {dataset_id}", fg="green"))
    start_at = time.perf_counter()
    dataset_ref: DatasetRef | None = None

    with session_factory.create_session() as session:
        try:
            dataset_statement = select(Dataset).where(Dataset.id == dataset_id)
            if tenant_id is not None:
                dataset_statement = dataset_statement.where(Dataset.tenant_id == tenant_id)
            dataset = session.scalar(dataset_statement.limit(1))

            if not dataset:
                logger.info("Skipping dataset vector intent because dataset no longer exists: %s", dataset_id)
                return True, None
            dataset_ref = DatasetRef(dataset.tenant_id, dataset.id)
            if not _matches_expected_state(
                dataset,
                expected_indexing_technique=expected_indexing_technique,
                expected_embedding_model_provider=expected_embedding_model_provider,
                expected_embedding_model=expected_embedding_model,
            ):
                logger.info("Skipping stale dataset vector intent for %s", dataset_id)
                return False, dataset_ref
            if action not in {"add", "remove", "update"}:
                raise ValueError(f"Unsupported dataset vector action: {action}")
            failed_documents: list[tuple[str, str]] = []
            index_type = get_dataset_doc_form(dataset, session=session) or IndexStructureType.PARAGRAPH_INDEX
            index_processor = IndexProcessorFactory(
                index_type,
                attachment_writer=SQLAlchemySegmentAttachmentWriter(),
            ).init_index_processor()
            if action == "remove":
                lease.assert_owned()
                index_processor.clean(dataset, None, with_keywords=False, session=session)
                lease.assert_owned()
            elif action == "add":
                dataset_documents = session.scalars(
                    select(DatasetDocument).where(
                        DatasetDocument.dataset_id == dataset_id,
                        DatasetDocument.tenant_id == dataset.tenant_id,
                        DatasetDocument.indexing_status == IndexingStatus.COMPLETED,
                        DatasetDocument.enabled.is_(True),
                        DatasetDocument.archived.is_(False),
                    )
                ).all()

                # Rebuild from an empty collection so redelivery and an older
                # same-state intent converge instead of duplicating vectors.
                lease.assert_owned()
                index_processor.clean(dataset, None, with_keywords=False, delete_child_chunks=False, session=session)
                lease.assert_owned()

                if dataset_documents:
                    for dataset_document in dataset_documents:
                        try:
                            # add from vector index
                            segments = session.scalars(
                                select(DocumentSegment)
                                .where(
                                    DocumentSegment.document_id == dataset_document.id,
                                    DocumentSegment.tenant_id == dataset.tenant_id,
                                    DocumentSegment.dataset_id == dataset.id,
                                    DocumentSegment.enabled.is_(True),
                                )
                                .order_by(DocumentSegment.position.asc())
                            ).all()
                            if segments:
                                documents, multimodal_documents = _build_index_materials(
                                    session=session,
                                    dataset=dataset,
                                    dataset_document=dataset_document,
                                    segments=list(segments),
                                )
                                # save vector index
                                lease.assert_owned()
                                index_processor.load(
                                    dataset,
                                    documents,
                                    multimodal_documents=multimodal_documents,
                                    with_keywords=False,
                                    session=session,
                                )
                                lease.assert_owned()
                            lease.assert_owned()
                            session.commit()
                        except KnowledgeIndexingLeaseLostError:
                            session.rollback()
                            raise
                        except Exception as error:
                            session.rollback()
                            lease.assert_owned()
                            failed_documents.append((dataset_document.id, str(error)))
                            logger.exception("Failed to add vector index for document %s", dataset_document.id)
                    if failed_documents:
                        raise DatasetVectorIndexingError(
                            "Failed to add vector indexes: "
                            + "; ".join(f"{document_id}: {error}" for document_id, error in failed_documents)
                        )
            elif action == "update":
                dataset_documents = session.scalars(
                    select(DatasetDocument).where(
                        DatasetDocument.dataset_id == dataset_id,
                        DatasetDocument.tenant_id == dataset.tenant_id,
                        DatasetDocument.indexing_status == IndexingStatus.COMPLETED,
                        DatasetDocument.enabled.is_(True),
                        DatasetDocument.archived.is_(False),
                    )
                ).all()
                # add new index
                if dataset_documents:
                    # clean index
                    lease.assert_owned()
                    index_processor.clean(
                        dataset, None, with_keywords=False, delete_child_chunks=False, session=session
                    )
                    lease.assert_owned()

                    for dataset_document in dataset_documents:
                        # update from vector index
                        try:
                            segments = session.scalars(
                                select(DocumentSegment)
                                .where(
                                    DocumentSegment.document_id == dataset_document.id,
                                    DocumentSegment.tenant_id == dataset.tenant_id,
                                    DocumentSegment.dataset_id == dataset.id,
                                    DocumentSegment.enabled.is_(True),
                                )
                                .order_by(DocumentSegment.position.asc())
                            ).all()
                            if segments:
                                documents, multimodal_documents = _build_index_materials(
                                    session=session,
                                    dataset=dataset,
                                    dataset_document=dataset_document,
                                    segments=list(segments),
                                )
                                # save vector index
                                lease.assert_owned()
                                index_processor.load(
                                    dataset,
                                    documents,
                                    multimodal_documents=multimodal_documents,
                                    with_keywords=False,
                                    session=session,
                                )
                                lease.assert_owned()
                            lease.assert_owned()
                            session.commit()
                        except KnowledgeIndexingLeaseLostError:
                            session.rollback()
                            raise
                        except Exception as error:
                            session.rollback()
                            lease.assert_owned()
                            failed_documents.append((dataset_document.id, str(error)))
                            logger.exception("Failed to rebuild vector index for document %s", dataset_document.id)
                else:
                    # clean collection
                    lease.assert_owned()
                    index_processor.clean(
                        dataset, None, with_keywords=False, delete_child_chunks=False, session=session
                    )
                    lease.assert_owned()

                if failed_documents:
                    raise DatasetVectorIndexingError(
                        "Failed to rebuild vector indexes: "
                        + "; ".join(f"{document_id}: {error}" for document_id, error in failed_documents)
                    )
            if action in {"add", "update"} and (action == "add" or regenerate_summary_vectors):
                _enqueue_summary_vector_regeneration(session, dataset)
                wake_knowledge_task_dispatcher_after_commit(session)
                lease.assert_owned()
                session.commit()

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Deal dataset vector index: {dataset_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
            return True, dataset_ref
        except KnowledgeIndexingLeaseLostError as error:
            if dataset_ref is None:
                raise
            raise DatasetVectorLeaseLostError(dataset_ref) from error
        except Exception:
            logger.exception("Deal dataset vector index failed")
            raise


def _enqueue_summary_vector_regeneration(session: Session, dataset: Dataset) -> None:
    enqueue_knowledge_task(
        session,
        kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        resource_id=dataset.id,
        payload={
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "regenerate_reason": "embedding_model_changed",
            "regenerate_vectors_only": True,
            "expected_indexing_technique": str(dataset.indexing_technique),
            "expected_embedding_model_provider": dataset.embedding_model_provider,
            "expected_embedding_model": dataset.embedding_model,
            "expected_summary_index_setting": (
                dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None
            ),
        },
    )


def _matches_expected_state(
    dataset: Dataset,
    *,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
) -> bool:
    if expected_indexing_technique is None:
        return True
    return (
        str(dataset.indexing_technique) == expected_indexing_technique
        and dataset.embedding_model_provider == expected_embedding_model_provider
        and dataset.embedding_model == expected_embedding_model
    )
