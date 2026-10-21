import json
import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import get_session_maker, session_factory
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.application_services.data_sources import build_data_source_credentials
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_repository import (
    SQLAlchemyDocumentRepository,
    require_owned_indexing_document,
)
from repositories.knowledge.segment_repository import (
    delete_document_segments_for_replacement,
    enqueue_upload_file_cleanup,
)
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError, DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.document_execution_recovery import repair_recovered_document_execution
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)
_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10


def _indexing_lock() -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(redis=redis_client)


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def document_indexing_sync_task(dataset_id: str, document_id: str) -> None:
    """Convert a deployed two-argument Notion sync delivery to durable current-state work."""

    SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    ).convert_legacy_notion_sync_delivery(dataset_id, document_id)


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def sync_notion_document_indexing_task(
    dataset_id: str,
    document_id: str,
    expected_generation: str,
    outbox_id: str,
) -> None:
    _run_document_indexing_sync_task(dataset_id, document_id, expected_generation, outbox_id)


def _run_document_indexing_sync_task(
    dataset_id: str,
    document_id: str,
    expected_generation: str,
    outbox_id: str | None,
) -> None:
    """Synchronize a Notion document under one generation and renewable indexing leases."""
    logger.info(click.style(f"Start sync document: {document_id}", fg="green"))
    started_at = time.perf_counter()
    document_ref: DocumentRef | None = None
    indexing_execution: DocumentIndexingExecution | None = None
    side_effect_started = False
    documents = SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    locks = _indexing_lock()

    try:
        with locks.hold(
            dataset_index_lock_name(dataset_id), timeout=_LEASE_TIMEOUT_SECONDS, blocking_timeout=30
        ) as dataset_lease:
            with (
                locks.hold(document_index_lock_name(document_id), timeout=_LEASE_TIMEOUT_SECONDS) as document_lease,
                knowledge_task_execution(outbox_id) as delivery_execution,
            ):
                if delivery_execution is None:
                    return
                if delivery_execution.recovered_execution:
                    dataset_ref = _get_document_dataset_ref(dataset_id, document_id)
                    if dataset_ref is not None:
                        repair_recovered_document_execution(
                            delivery_execution,
                            documents=documents,
                            ref=dataset_ref,
                            document_ids=[document_id],
                        )
                    return
                delivery_execution.assert_owned()
                dataset_lease.assert_owned()
                document_lease.assert_owned()
                with session_factory.create_session() as session, session.begin():
                    dataset = session.scalar(
                        select(Dataset).where(Dataset.id == dataset_id).with_for_update(of=Dataset).limit(1)
                    )
                    if dataset is None:
                        raise ValueError("Dataset not found")
                    document = session.scalar(
                        select(Document)
                        .where(
                            Document.id == document_id,
                            Document.tenant_id == dataset.tenant_id,
                            Document.dataset_id == dataset.id,
                        )
                        .with_for_update(of=Document)
                        .limit(1)
                    )
                    if document is None:
                        logger.info(click.style(f"Document not found: {document_id}", fg="red"))
                        return
                    if document.archived or not document.enabled or document.is_paused:
                        logger.info("Skipping ineligible Notion sync generation for document %s", document_id)
                        return
                    if document.indexing_status == IndexingStatus.PARSING:
                        logger.info(
                            click.style(f"Document {document_id} is already being processed, skipping", fg="yellow")
                        )
                        return
                    if document.data_source_type != "notion_import":
                        logger.info(
                            click.style(f"Document {document_id} is not a notion_import, skipping", fg="yellow")
                        )
                        return

                    data_source_info = document.data_source_info_dict
                    if (
                        not data_source_info
                        or "notion_page_id" not in data_source_info
                        or "notion_workspace_id" not in data_source_info
                    ):
                        raise ValueError("no notion page found")

                    current_generation = document.indexing_generation
                    if current_generation != expected_generation:
                        logger.info("Skipping stale Notion sync generation for document %s", document_id)
                        return
                    ref = DatasetRef(dataset.tenant_id, dataset.id).document(document.id)
                    document_ref = ref
                    tenant_id = dataset.tenant_id
                    workspace_id = str(data_source_info["notion_workspace_id"])
                    page_id = str(data_source_info["notion_page_id"])
                    page_type = str(data_source_info["type"])
                    page_edited_time = data_source_info["last_edited_time"]
                    credential_id = data_source_info.get("credential_id")
                    index_type = document.doc_form
                    index_node_ids = [
                        str(node_id)
                        for node_id in session.scalars(
                            select(DocumentSegment.index_node_id).where(
                                DocumentSegment.tenant_id == dataset.tenant_id,
                                DocumentSegment.dataset_id == dataset.id,
                                DocumentSegment.document_id == document.id,
                                DocumentSegment.index_node_id.is_not(None),
                            )
                        ).all()
                    ]

                def assert_owned(
                    *,
                    dataset_execution: KnowledgeIndexingLease = dataset_lease,
                    document_execution: KnowledgeIndexingLease = document_lease,
                ) -> None:
                    delivery_execution.assert_owned()
                    dataset_execution.assert_owned()
                    document_execution.assert_owned()
                    documents.assert_indexing_generation(ref, current_generation)

                indexing_execution = DocumentIndexingExecution(
                    current_generation,
                    assert_owned,
                    task_intent_id=delivery_execution.intent_id,
                    task_execution_id=delivery_execution.execution_id,
                )
                assert_owned()

                datasource_provider_service = build_data_source_credentials(
                    database_client=get_session_maker()
                ).providers
                credential = datasource_provider_service.get_datasource_credentials(
                    tenant_id=tenant_id,
                    credential_id=credential_id,
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                )
                assert_owned()

                if not credential:
                    logger.error(
                        "Datasource credential not found for document %s, tenant_id: %s, credential_id: %s",
                        document_id,
                        tenant_id,
                        credential_id,
                    )
                    documents.fail_indexing(
                        ref,
                        "Datasource credential not found. Please reconnect your Notion workspace.",
                        execution=indexing_execution,
                    )
                    return

                loader = NotionExtractor(
                    notion_token_loader=lambda: datasource_provider_service.get_stored_notion_access_token(
                        tenant_id=tenant_id, credential_id=credential_id
                    ),
                    notion_workspace_id=workspace_id,
                    notion_obj_id=page_id,
                    notion_page_type=page_type,
                    notion_access_token=credential.get("integration_secret"),
                    tenant_id=tenant_id,
                )
                last_edited_time = loader.get_notion_last_edited_time()
                assert_owned()
                if last_edited_time == page_edited_time:
                    logger.info(click.style(f"Document {document_id} content unchanged, skipping sync", fg="yellow"))
                    documents.complete_unchanged_notion_sync(ref, execution=indexing_execution)
                    return

                logger.info(click.style(f"Document {document_id} content changed, starting sync", fg="green"))
                if index_node_ids:
                    with session_factory.create_session() as session:
                        dataset = session.scalar(
                            select(Dataset).where(
                                Dataset.id == ref.dataset.dataset_id,
                                Dataset.tenant_id == ref.dataset.tenant_id,
                            )
                        )
                        if dataset is None:
                            raise DocumentIndexingGenerationChangedError(document_id)
                        require_owned_indexing_document(session, ref, execution=indexing_execution)
                        try:
                            side_effect_started = True
                            IndexProcessorFactory(index_type).init_index_processor().clean(
                                dataset,
                                index_node_ids,
                                with_keywords=True,
                                delete_child_chunks=False,
                                session=session,
                            )
                            documents.commit_indexing_phase(session, ref, execution=indexing_execution)
                            logger.info(click.style(f"Cleaned vector index for document {document_id}", fg="green"))
                        except Exception:
                            logger.exception("Failed to clean vector index for document %s", document_id)
                            session.rollback()
                    assert_owned()

                side_effect_started = True
                with session_factory.create_session() as session:
                    if lock_dataset_for_child_write(session, ref.dataset) is None:
                        raise DocumentIndexingGenerationChangedError(ref.document_id)
                    document = require_owned_indexing_document(session, ref, execution=indexing_execution, lock=True)
                    updated_source_info = document.data_source_info_dict
                    updated_source_info["last_edited_time"] = last_edited_time
                    document.data_source_info = json.dumps(updated_source_info)
                    document.indexing_status = IndexingStatus.PARSING
                    document.processing_started_at = naive_utc_now()
                    cleanup_file_ids = delete_document_segments_for_replacement(session, ref, owner_locks_held=True)
                    if enqueue_upload_file_cleanup(session, ref, cleanup_file_ids) is not None:
                        wake_knowledge_task_dispatcher_after_commit(session)
                    assert_owned()
                    documents.commit_indexing_phase(session, ref, execution=indexing_execution)

                logger.info(click.style(f"Deleted segments for document {document_id}", fg="green"))
                indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
                indexing_service.run([ref], executions={ref.document_id: indexing_execution})
                assert_owned()
                logger.info(
                    click.style(
                        f"Sync completed for document {document_id} latency: {time.perf_counter() - started_at}",
                        fg="green",
                    )
                )
    except DocumentIndexingGenerationChangedError:
        logger.info("Notion sync generation changed for document %s", document_id)
        if side_effect_started and document_ref is not None:
            documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_ref.document_id])
    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
        if document_ref is not None:
            documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_ref.document_id])
        raise
    except KnowledgeIndexingLockBusyError as error:
        if outbox_id is None:
            raise
        if not defer_knowledge_task_before_execution(outbox_id, error=str(error), delay=_LOCK_RETRY_DELAY_SECONDS):
            logger.info("Skipping duplicate or terminal Notion sync delivery: %s", outbox_id)
            return
        raise KnowledgeTaskRequeuedError(
            f"Notion sync {outbox_id} was deferred while its indexing lock is held"
        ) from error
    except DocumentIsPausedError as error:
        logger.info(click.style(str(error), fg="yellow"))
        if outbox_id is not None:
            raise
    except Exception as error:
        logger.exception("document_indexing_sync_task failed for document_id: %s", document_id)
        if document_ref is None or indexing_execution is None:
            raise
        try:
            indexing_execution.assert_owned()
        except DocumentIndexingGenerationChangedError:
            if side_effect_started:
                documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_ref.document_id])
            return
        except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
            documents.enqueue_current_indexing_repairs(document_ref.dataset, [document_ref.document_id])
            raise
        documents.fail_indexing(document_ref, str(error), execution=indexing_execution)
        if outbox_id is not None:
            raise


def _get_document_dataset_ref(dataset_id: str, document_id: str) -> DatasetRef | None:
    with session_factory.create_session() as session:
        tenant_id = session.scalar(
            select(Document.tenant_id).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
        )
    if tenant_id is None:
        return None
    return DatasetRef(tenant_id, dataset_id)
