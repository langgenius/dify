import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from services.datasource_provider_service import DatasourceProviderService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def document_indexing_sync_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_sync_task.delay(dataset_id, document_id)
    """
    logger.info(click.style(f"Start sync document: {document_id}", fg="green"))
    start_at = time.perf_counter()
    tenant_id = None

    with session_factory.create_session() as session, session.begin():
        document = session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()

        if not document:
            logger.info(click.style(f"Document not found: {document_id}", fg="red"))
            return

        if document.indexing_status == "parsing":
            logger.info(click.style(f"Document {document_id} is already being processed, skipping", fg="yellow"))
            return

        dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
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

        workspace_id = data_source_info["notion_workspace_id"]
        page_id = data_source_info["notion_page_id"]
        page_type = data_source_info["type"]
        page_edited_time = data_source_info["last_edited_time"]
        credential_id = data_source_info.get("credential_id")
        tenant_id = document.tenant_id
        index_type = document.doc_form

        segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
        index_node_ids = [segment.index_node_id for segment in segments]

    # Get credentials from datasource provider
    datasource_provider_service = DatasourceProviderService()
    credential = datasource_provider_service.get_datasource_credentials(
        tenant_id=tenant_id,
        credential_id=credential_id,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    if not credential:
        logger.error(
            "Datasource credential not found for document %s, tenant_id: %s, credential_id: %s",
            document_id,
            tenant_id,
            credential_id,
        )

        with session_factory.create_session() as session, session.begin():
            document = session.query(Document).filter_by(id=document_id).first()
            if document:
                document.indexing_status = "error"
                document.error = "Datasource credential not found. Please reconnect your Notion workspace."
                document.stopped_at = naive_utc_now()
        return

    loader = NotionExtractor(
        notion_workspace_id=workspace_id,
        notion_obj_id=page_id,
        notion_page_type=page_type,
        notion_access_token=credential.get("integration_secret"),
        tenant_id=tenant_id,
    )

    last_edited_time = loader.get_notion_last_edited_time()
    if last_edited_time == page_edited_time:
        logger.info(click.style(f"Document {document_id} content unchanged, skipping sync", fg="yellow"))
        return

    logger.info(click.style(f"Document {document_id} content changed, starting sync", fg="green"))

    try:
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        with session_factory.create_session() as session:
            dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
            if dataset:
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)
        logger.info(click.style(f"Cleaned vector index for document {document_id}", fg="green"))
    except Exception:
        logger.exception("Failed to clean vector index for document %s", document_id)

    with session_factory.create_session() as session, session.begin():
        document = session.query(Document).filter_by(id=document_id).first()
        if not document:
            logger.warning(click.style(f"Document {document_id} not found during sync", fg="yellow"))
            return

        data_source_info = document.data_source_info_dict
        data_source_info["last_edited_time"] = last_edited_time
        document.data_source_info = data_source_info

        document.indexing_status = "parsing"
        document.processing_started_at = naive_utc_now()

        segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.document_id == document_id)
        session.execute(segment_delete_stmt)

        logger.info(click.style(f"Deleted segments for document {document_id}", fg="green"))

    try:
        indexing_runner = IndexingRunner()
        with session_factory.create_session() as session:
            document = session.query(Document).filter_by(id=document_id).first()
            if document:
                indexing_runner.run([document])
        end_at = time.perf_counter()
        logger.info(click.style(f"Sync completed for document {document_id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception as e:
        logger.exception("document_indexing_sync_task failed for document_id: %s", document_id)
        with session_factory.create_session() as session, session.begin():
            document = session.query(Document).filter_by(id=document_id).first()
            if document:
                document.indexing_status = "error"
                document.error = str(e)
                document.stopped_at = naive_utc_now()
