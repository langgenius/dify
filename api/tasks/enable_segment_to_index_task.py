import datetime
import logging
import time

import click
from celery import shared_task  # type: ignore
from werkzeug.exceptions import NotFound

from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import ChildDocument, Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment


@shared_task(queue="dataset")
def enable_segment_to_index_task(segment_id: str):
    """
    Async enable segment to index
    :param segment_id:

    Usage: enable_segment_to_index_task.delay(segment_id)
    """
    logging.info(click.style("Start enable segment to index: {}".format(segment_id), fg="green"))
    start_at = time.perf_counter()

    segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_id).first()
    if not segment:
        raise NotFound("Segment not found")

    if segment.status != "completed":
        raise NotFound("Segment is not completed, enable action is not allowed.")

    indexing_cache_key = "segment_{}_indexing".format(segment.id)

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
            logging.info(click.style("Segment {} has no dataset, pass.".format(segment.id), fg="cyan"))
            return

        dataset_document = segment.document

        if not dataset_document:
            logging.info(click.style("Segment {} has no document, pass.".format(segment.id), fg="cyan"))
            return

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            logging.info(click.style("Segment {} document status is invalid, pass.".format(segment.id), fg="cyan"))
            return

        index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()
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
                            "document_id": segment.document_id,
                            "dataset_id": segment.dataset_id,
                        },
                    )
                    child_documents.append(child_document)
                document.children = child_documents
        # save vector index
        index_processor.load(dataset, [document])

        end_at = time.perf_counter()
        logging.info(
            click.style("Segment enabled to index: {} latency: {}".format(segment.id, end_at - start_at), fg="green")
        )
    except Exception as e:
        logging.exception("enable segment to index failed")
        segment.enabled = False
        segment.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        segment.status = "error"
        segment.error = str(e)
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
