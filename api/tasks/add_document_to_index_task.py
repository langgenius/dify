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
from models.dataset import DatasetAutoDisableLog, DocumentSegment
from models.dataset import Document as DatasetDocument


@shared_task(queue="dataset")
def add_document_to_index_task(dataset_document_id: str):
    """
    Async Add document to index
    :param dataset_document_id:

    Usage: add_document_to_index.delay(dataset_document_id)
    """
    logging.info(click.style("Start add document to index: {}".format(dataset_document_id), fg="green"))
    start_at = time.perf_counter()

    dataset_document = db.session.query(DatasetDocument).filter(DatasetDocument.id == dataset_document_id).first()
    if not dataset_document:
        raise NotFound("Document not found")

    if dataset_document.indexing_status != "completed":
        return

    indexing_cache_key = "document_{}_indexing".format(dataset_document.id)

    try:
        segments = (
            db.session.query(DocumentSegment)
            .filter(
                DocumentSegment.document_id == dataset_document.id,
                DocumentSegment.enabled == False,
                DocumentSegment.status == "completed",
            )
            .order_by(DocumentSegment.position.asc())
            .all()
        )

        documents = []
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
            documents.append(document)

        dataset = dataset_document.dataset

        if not dataset:
            raise Exception("Document has no dataset")

        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        index_processor.load(dataset, documents)

        # delete auto disable log
        db.session.query(DatasetAutoDisableLog).filter(
            DatasetAutoDisableLog.document_id == dataset_document.id
        ).delete()

        # update segment to enable
        db.session.query(DocumentSegment).filter(DocumentSegment.document_id == dataset_document.id).update(
            {
                DocumentSegment.enabled: True,
                DocumentSegment.disabled_at: None,
                DocumentSegment.disabled_by: None,
                DocumentSegment.updated_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            }
        )
        db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Document added to index: {} latency: {}".format(dataset_document.id, end_at - start_at), fg="green"
            )
        )
    except Exception as e:
        logging.exception("add document to index failed")
        dataset_document.enabled = False
        dataset_document.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        dataset_document.status = "error"
        dataset_document.error = str(e)
        db.session.commit()
    finally:
        redis_client.delete(indexing_cache_key)
