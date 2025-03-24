import datetime
import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import ChildDocument, Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument


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
    dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        logging.info(click.style("Dataset {} not found, pass.".format(dataset_id), fg="cyan"))
        return

    dataset_document = db.session.query(DatasetDocument).filter(DatasetDocument.id == document_id).first()

    if not dataset_document:
        logging.info(click.style("Document {} not found, pass.".format(document_id), fg="cyan"))
        return
    if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
        logging.info(click.style("Document {} status is invalid, pass.".format(document_id), fg="cyan"))
        return
    # sync index processor
    index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()

    segments = (
        db.session.query(DocumentSegment)
        .filter(
            DocumentSegment.id.in_(segment_ids),
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
        )
        .all()
    )
    if not segments:
        return

    try:
        documents = []
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

            if dataset_document.doc_form == IndexType.PARENT_CHILD_INDEX:
                child_chunks = segment.child_chunks
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
            documents.append(document)
        # save vector index
        index_processor.load(dataset, documents)

        end_at = time.perf_counter()
        logging.info(click.style("Segments enabled to index latency: {}".format(end_at - start_at), fg="green"))
    except Exception as e:
        logging.exception("enable segments to index failed")
        # update segment error msg
        db.session.query(DocumentSegment).filter(
            DocumentSegment.id.in_(segment_ids),
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
        ).update(
            {
                "error": str(e),
                "status": "error",
                "disabled_at": datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                "enabled": False,
            }
        )
        db.session.commit()
    finally:
        for segment in segments:
            indexing_cache_key = "segment_{}_indexing".format(segment.id)
            redis_client.delete(indexing_cache_key)
