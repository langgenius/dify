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
from models.dataset import DocumentSegment

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def enable_segment_to_index_task(segment_id: str):
    """
    Async enable segment to index
    :param segment_id:

    Usage: enable_segment_to_index_task.delay(segment_id)
    """
    logger.info(click.style(f"Start enable segment to index: {segment_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        segment = session.query(DocumentSegment).where(DocumentSegment.id == segment_id).first()
        if not segment:
            logger.info(click.style(f"Segment not found: {segment_id}", fg="red"))
            return

        if segment.status != "completed":
            logger.info(click.style(f"Segment is not completed, enable is not allowed: {segment_id}", fg="red"))
            return

        indexing_cache_key = f"segment_{segment.id}_indexing"

        try:
            document = Document(
                page_content=segment.content,
                metadata={
                    "doc_id": segment.index_node_id,
                    "doc_hash": segment.index_node_hash,
                    "document_id": segment.document_id,
                    "dataset_id": segment.dataset_id,
                },
            )

            dataset = segment.dataset

            if not dataset:
                logger.info(click.style(f"Segment {segment.id} has no dataset, pass.", fg="cyan"))
                return

            dataset_document = segment.document

            if not dataset_document:
                logger.info(click.style(f"Segment {segment.id} has no document, pass.", fg="cyan"))
                return

            if (
                not dataset_document.enabled
                or dataset_document.archived
                or dataset_document.indexing_status != "completed"
            ):
                logger.info(click.style(f"Segment {segment.id} document status is invalid, pass.", fg="cyan"))
                return

            index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()
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
            multimodel_documents = []
            if dataset.is_multimodal:
                for attachment in segment.attachments:
                    multimodel_documents.append(
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

            # save vector index
            index_processor.load(dataset, [document], multimodal_documents=multimodel_documents)

            end_at = time.perf_counter()
            logger.info(click.style(f"Segment enabled to index: {segment.id} latency: {end_at - start_at}", fg="green"))
        except Exception as e:
            logger.exception("enable segment to index failed")
            segment.enabled = False
            segment.disabled_at = naive_utc_now()
            segment.status = "error"
            segment.error = str(e)
            session.commit()
        finally:
            redis_client.delete(indexing_cache_key)
