import logging
import time
from typing import Optional

import click
from celery import shared_task  # type: ignoreq

from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import ChildDocument, Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import (
    Document as DatasetDocument,
)
from models.dataset import (
    DocumentSegment,
)
from services.dataset_service import DatasetService


@shared_task(queue="dataset")
def update_documents_metadata_task(
    dataset_id: str,
    document_ids: list[str],
    lock_key: Optional[str] = None,
):
    """
    Update documents metadata.
    :param dataset_id: dataset id
    :param document_ids: document ids

    Usage: update_documents_metadata_task.delay(dataset_id, document_ids)
    """
    logging.info(click.style("Start update documents metadata: {}".format(dataset_id), fg="green"))
    start_at = time.perf_counter()

    try:
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError("Dataset not found.")
        documents = (
            db.session.query(DatasetDocument)
            .filter(
                DatasetDocument.dataset_id == dataset_id,
                DatasetDocument.id.in_(document_ids),
                DatasetDocument.enabled == True,
                DatasetDocument.indexing_status == "completed",
                DatasetDocument.archived == False,
            )
            .all()
        )
        if not documents:
            raise ValueError("Documents not found.")
        for dataset_document in documents:
            index_processor = IndexProcessorFactory(dataset_document.doc_form).init_index_processor()

            segments = (
                db.session.query(DocumentSegment)
                .filter(
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == dataset_document.id,
                    DocumentSegment.enabled == True,
                )
                .all()
            )
            if not segments:
                continue
            # delete all documents in vector index
            index_node_ids = [segment.index_node_id for segment in segments]
            index_processor.clean(dataset, index_node_ids, with_keywords=False, delete_child_chunks=True)
            # update documents metadata
            documents = []
            for segment in segments:
                document = Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": segment.index_node_id,
                        "doc_hash": segment.index_node_hash,
                        "document_id": dataset_document.id,
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
                                    "document_id": dataset_document.id,
                                    "dataset_id": dataset_id,
                                },
                            )
                            if dataset.built_in_field_enabled:
                                child_document.metadata[BuiltInField.uploader] = dataset_document.created_by
                                child_document.metadata[BuiltInField.upload_date] = dataset_document.created_at
                                child_document.metadata[BuiltInField.last_update_date] = dataset_document.updated_at
                                child_document.metadata[BuiltInField.source] = dataset_document.data_source_type
                                child_document.metadata[BuiltInField.original_filename] = dataset_document.name
                            if dataset_document.doc_metadata:
                                child_document.metadata.update(dataset_document.doc_metadata)
                            child_documents.append(child_document)
                        document.children = child_documents
                documents.append(document)  # noqa: B909
            # save vector index
            index_processor.load(dataset, documents)
        end_at = time.perf_counter()
        logging.info(
            click.style("Updated documents metadata: {} latency: {}".format(dataset_id, end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("Updated documents metadata failed")
    finally:
        if lock_key:
            redis_client.delete(lock_key)
