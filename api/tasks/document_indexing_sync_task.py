import logging
import time

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import delete, select

from core.db.session_factory import get_session_maker, session_factory
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.index_processor.index_processor import IndexProcessorFactory
from extensions.application_services.data_sources import build_data_source_credentials
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    document_index_lock_name,
)

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    autoretry_for=(KnowledgeIndexingLockBusyError, KnowledgeIndexingLeaseLostError, RedisError),
    retry_backoff=True,
    max_retries=10,
)
def document_indexing_sync_task(dataset_id: str, document_id: str) -> None:
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_sync_task.delay(dataset_id, document_id)
    """
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(
        document_index_lock_name(document_id),
        timeout=600,
        blocking_timeout=5,
    ) as lease:
        _run_document_indexing_sync_task(dataset_id, document_id, lease=lease)


def _run_document_indexing_sync_task(
    dataset_id: str,
    document_id: str,
    *,
    lease: KnowledgeIndexingLease,
) -> None:
    logger.info(click.style(f"Start sync document: {document_id}", fg="green"))
    start_at = time.perf_counter()
    tenant_id = None

    with session_factory.create_session() as session, session.begin():
        document = session.scalar(
            select(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
        )

        if not document:
            logger.info(click.style(f"Document not found: {document_id}", fg="red"))
            return

        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if not dataset:
            raise Exception("Dataset not found")

        data_source_info = document.data_source_info_dict
        if document.data_source_type != "notion_import":
            logger.info(click.style(f"Document {document_id} is not a notion_import, skipping", fg="yellow"))
            return

        if (
            not data_source_info
            or "notion_page_id" not in data_source_info
            or "notion_workspace_id" not in data_source_info
        ):
            raise ValueError("no notion page found")

        page_id = data_source_info["notion_page_id"]
        page_type = data_source_info["type"]
        page_edited_time = data_source_info["last_edited_time"]
        credential_id = data_source_info.get("credential_id")
        tenant_id = document.tenant_id
        index_type = document.doc_form
        resume_status = document.indexing_status
        document_ref = DatasetRef(tenant_id, dataset_id).document(document_id)

        segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
        index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]

    # The document lease excludes an active indexer. An in-progress phase here
    # belongs to an interrupted attempt, whose source may already be unchanged
    # even though its index has not been published yet.
    if resume_status in {
        IndexingStatus.PARSING,
        IndexingStatus.CLEANING,
        IndexingStatus.SPLITTING,
        IndexingStatus.INDEXING,
    }:
        indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
        try:
            if resume_status == IndexingStatus.INDEXING:
                indexing_service.run_in_indexing_status(document_ref, owned_lease=lease)
            elif resume_status == IndexingStatus.SPLITTING:
                indexing_service.run_in_splitting_status(document_ref, owned_lease=lease)
            else:
                indexing_service.run([document_ref], owned_leases={document_id: lease})
        except DocumentIsPausedError as error:
            logger.info(click.style(str(error), fg="yellow"))
        return

    # Resolve the persisted credential before constructing the extractor. An
    # explicit credential ID fails closed; only legacy sources without an ID
    # may use the configured integration token.
    datasource_provider_service = build_data_source_credentials(database_client=get_session_maker()).providers
    try:
        notion_access_token = datasource_provider_service.get_stored_notion_access_token(
            tenant_id=tenant_id, credential_id=credential_id
        )
    except ValueError:
        logger.exception(
            "Datasource credential not found for document %s, tenant_id: %s, credential_id: %s",
            document_id,
            tenant_id,
            credential_id,
        )

        with session_factory.create_session() as session, session.begin():
            document = session.scalar(select(Document).where(Document.id == document_id).limit(1))
            if document:
                document.indexing_status = IndexingStatus.ERROR
                document.error = "Datasource credential not found. Please reconnect your Notion workspace."
                document.stopped_at = naive_utc_now()
        return

    loader = NotionExtractor(
        notion_obj_id=page_id,
        notion_page_type=page_type,
        notion_access_token=notion_access_token,
    )

    last_edited_time = loader.get_notion_last_edited_time()
    requires_initial_indexing = False
    if last_edited_time == page_edited_time:
        document_ref = DatasetRef(tenant_id, dataset_id).document(document_id)
        document_repository = SQLAlchemyDocumentRepository(session_factory=session_factory.get_session_maker())
        unchanged_outcome = document_repository.complete_unchanged_notion_sync(
            document_ref,
            expected_source_info=dict(data_source_info),
        )
        if unchanged_outcome == "completed":
            logger.info(click.style(f"Document {document_id} content unchanged, skipping sync", fg="yellow"))
            return
        if unchanged_outcome == "stale":
            logger.info(click.style(f"Document {document_id} sync request is stale, skipping", fg="yellow"))
            return
        requires_initial_indexing = True
        logger.info(
            click.style(
                f"Document {document_id} has no completed index; indexing the unchanged source",
                fg="green",
            )
        )
    else:
        logger.info(click.style(f"Document {document_id} content changed, starting sync", fg="green"))

    try:
        indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
        with session_factory.create_session() as session:
            document = session.scalar(select(Document).where(Document.id == document_id).limit(1))
            if not document:
                logger.warning(click.style(f"Document {document_id} not found during sync", fg="yellow"))
                return

            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            # End the read transaction before the external vector cleanup.
            session.commit()
            if dataset and (not requires_initial_indexing or index_node_ids):
                try:
                    index_processor = IndexProcessorFactory(index_type).init_index_processor()
                    lease.assert_owned()
                    index_processor.clean(
                        dataset,
                        index_node_ids,
                        with_keywords=True,
                        delete_child_chunks=True,
                        session=session,
                    )
                    lease.assert_owned()
                    session.commit()
                    logger.info(click.style(f"Cleaned vector index for document {document_id}", fg="green"))
                except KnowledgeIndexingLeaseLostError:
                    session.rollback()
                    raise
                except Exception:
                    logger.exception("Failed to clean vector index for document %s", document_id)
                    session.rollback()
                    document = session.scalar(select(Document).where(Document.id == document_id).limit(1))
                    if not document:
                        logger.warning(click.style(f"Document {document_id} not found during sync", fg="yellow"))
                        return

            document.indexing_status = IndexingStatus.PARSING
            document.processing_started_at = naive_utc_now()

            segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.document_id == document_id)
            lease.assert_owned()
            session.execute(segment_delete_stmt)
            document_refs = [DatasetRef(document.tenant_id, document.dataset_id).document(document.id)]
            # Make the parsing state and segment deletion visible before extraction.
            session.commit()

            logger.info(click.style(f"Deleted segments for document {document_id}", fg="green"))

            indexing_service.run(document_refs, owned_leases={document.id: lease})
        end_at = time.perf_counter()
        logger.info(click.style(f"Sync completed for document {document_id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except KnowledgeIndexingLeaseLostError:
        raise
    except Exception as e:
        logger.exception("document_indexing_sync_task failed for document_id: %s", document_id)
        with session_factory.create_session() as session:
            document = session.scalar(select(Document).where(Document.id == document_id).limit(1))
            if document:
                document.indexing_status = IndexingStatus.ERROR
                document.error = str(e)
                document.stopped_at = naive_utc_now()
                session.commit()
