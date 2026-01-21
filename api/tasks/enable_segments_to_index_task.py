import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def enable_segments_to_index_task(segment_ids: list, dataset_id: str, document_id: str):
    """
    Async enable segments to index
    :param segment_ids: list of segment ids
    :param dataset_id: dataset id
    :param document_id: document id

    Usage: enable_segments_to_index_task.delay(segment_ids, dataset_id, document_id)
    """
    start_at = time.perf_counter()
    with session_factory.create_session() as session:
        dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            logger.info(click.style(f"Dataset {dataset_id} not found, pass.", fg="cyan"))
            return

        dataset_document = session.query(DatasetDocument).where(DatasetDocument.id == document_id).first()

        if not dataset_document:
            logger.info(click.style(f"Document {document_id} not found, pass.", fg="cyan"))
            return
        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logger.info(click.style(f"Document {document_id} status is invalid, pass.", fg="cyan"))
            return
        # sync index processor
        index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()

        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
            )
        ).all()
        if not segments:
            logger.info(click.style(f"Segments not found: {segment_ids}", fg="cyan"))
            return

        try:
            documents = []
            multimodal_documents = []
            for segment in segments:
                document = Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": segment.index_node_id,
                        "doc_hash": segment.index_node_hash,
                        "document_id": document_id,
                        "dataset_id": dataset_id,
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
                                    "document_id": document_id,
                                    "dataset_id": dataset_id,
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
            # save vector index
            index_processor.load(dataset, documents, multimodal_documents=multimodal_documents)

            end_at = time.perf_counter()
            logger.info(click.style(f"Segments enabled to index latency: {end_at - start_at}", fg="green"))
        except Exception as e:
            logger.exception("enable segments to index failed")
            # update segment error msg
            session.query(DocumentSegment).where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
            ).update(
                {
                    "error": str(e),
                    "status": "error",
                    "disabled_at": naive_utc_now(),
                    "enabled": False,
                }
            )
            session.commit()
        finally:
            for segment in segments:
                indexing_cache_key = f"segment_{segment.id}_indexing"
                redis_client.delete(indexing_cache_key)
