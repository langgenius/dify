import logging
import time

import click
from celery import shared_task

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import DatasetAutoDisableLog, DocumentSegment
from models.dataset import Document as DatasetDocument

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def add_document_to_index_task(dataset_document_id: str):
    """
    Async Add document to index
    :param dataset_document_id:

    Usage: add_document_to_index_task.delay(dataset_document_id)
    """
    logger.info(click.style(f"Start add document to index: {dataset_document_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        dataset_document = session.query(DatasetDocument).where(DatasetDocument.id == dataset_document_id).first()
        if not dataset_document:
            logger.info(click.style(f"Document not found: {dataset_document_id}", fg="red"))
            return

        if dataset_document.indexing_status != "completed":
            return

        indexing_cache_key = f"document_{dataset_document.id}_indexing"

        try:
            dataset = dataset_document.dataset
            if not dataset:
                raise Exception(f"Document {dataset_document.id} dataset {dataset_document.dataset_id} doesn't exist.")

            segments = (
                session.query(DocumentSegment)
                .where(
                    DocumentSegment.document_id == dataset_document.id,
                    DocumentSegment.status == "completed",
                )
                .order_by(DocumentSegment.position.asc())
                .all()
            )

            documents = []
            multimodal_documents = []
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
                    child_chunks = segment.get_child_chunks()
                    if child_chunks:
                        child_documents = []
                        for child_chunk in child_chunks:
                            child_document = ChildDocument(
                                page_content=child_chunk.content,
                                metadata={
                                    "doc_id": child_chunk.index_node_id,
                                    "doc_hash": child_chunk.index_node_hash,
                                    "document_id": segment.document_id,
                                    "dataset_id": segment.dataset_id,
                                },
                            )
                            child_documents.append(child_document)
                        document.children = child_documents
                if dataset.is_multimodal:
                    for attachment in segment.attachments:
                        multimodal_documents.append(
                            AttachmentDocument(
                                page_content=attachment["name"],
                                metadata={
                                    "doc_id": attachment["id"],
                                    "doc_hash": "",
                                    "document_id": segment.document_id,
                                    "dataset_id": segment.dataset_id,
                                    "doc_type": DocType.IMAGE,
                                },
                            )
                        )
                documents.append(document)

            index_type = dataset.doc_form
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            index_processor.load(dataset, documents, multimodal_documents=multimodal_documents)

            # delete auto disable log
            session.query(DatasetAutoDisableLog).where(
                DatasetAutoDisableLog.document_id == dataset_document.id
            ).delete()

            # update segment to enable
            session.query(DocumentSegment).where(DocumentSegment.document_id == dataset_document.id).update(
                {
                    DocumentSegment.enabled: True,
                    DocumentSegment.disabled_at: None,
                    DocumentSegment.disabled_by: None,
                    DocumentSegment.updated_at: naive_utc_now(),
                }
            )
            session.commit()

            end_at = time.perf_counter()
            logger.info(
                click.style(f"Document added to index: {dataset_document.id} latency: {end_at - start_at}", fg="green")
            )
        except Exception as e:
            logger.exception("add document to index failed")
            dataset_document.enabled = False
            dataset_document.disabled_at = naive_utc_now()
            dataset_document.indexing_status = "error"
            dataset_document.error = str(e)
            session.commit()
        finally:
            redis_client.delete(indexing_cache_key)
