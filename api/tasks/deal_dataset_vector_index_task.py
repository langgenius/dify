import logging
import time

import click
from celery import shared_task

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument


@shared_task(queue='dataset')
def deal_dataset_vector_index_task(dataset_id: str, action: str):
    """
    Async deal dataset from index
    :param dataset_id: dataset_id
    :param action: action
    Usage: deal_dataset_vector_index_task.delay(dataset_id, action)
    """
    logging.info(click.style('Start deal dataset vector index: {}'.format(dataset_id), fg='green'))
    start_at = time.perf_counter()

    try:
        dataset = Dataset.query.filter_by(
            id=dataset_id
        ).first()

        if not dataset:
            raise Exception('Dataset not found')
        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        if action == "remove":
            index_processor.clean(dataset, None, with_keywords=False)
        elif action == "add":
            dataset_documents = db.session.query(DatasetDocument).filter(
                DatasetDocument.dataset_id == dataset_id,
                DatasetDocument.indexing_status == 'completed',
                DatasetDocument.enabled == True,
                DatasetDocument.archived == False,
            ).all()

            if dataset_documents:
                documents = []
                for dataset_document in dataset_documents:
                    # delete from vector index
                    segments = db.session.query(DocumentSegment).filter(
                        DocumentSegment.document_id == dataset_document.id,
                        DocumentSegment.enabled == True
                    ) .order_by(DocumentSegment.position.asc()).all()
                    for segment in segments:
                        document = Document(
                            page_content=segment.content,
                            metadata={
                                "doc_id": segment.index_node_id,
                                "doc_hash": segment.index_node_hash,
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                            }
                        )

                        documents.append(document)

                # save vector index
                index_processor.load(dataset, documents, with_keywords=False)
        elif action == 'update':
            # clean index
            index_processor.clean(dataset, None, with_keywords=False)
            dataset_documents = db.session.query(DatasetDocument).filter(
                DatasetDocument.dataset_id == dataset_id,
                DatasetDocument.indexing_status == 'completed',
                DatasetDocument.enabled == True,
                DatasetDocument.archived == False,
            ).all()
            # add new index
            if dataset_documents:
                documents = []
                for dataset_document in dataset_documents:
                    # delete from vector index
                    segments = db.session.query(DocumentSegment).filter(
                        DocumentSegment.document_id == dataset_document.id,
                        DocumentSegment.enabled == True
                    ).order_by(DocumentSegment.position.asc()).all()
                    for segment in segments:
                        document = Document(
                            page_content=segment.content,
                            metadata={
                                "doc_id": segment.index_node_id,
                                "doc_hash": segment.index_node_hash,
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                            }
                        )

                        documents.append(document)

                # save vector index
                index_processor.load(dataset, documents, with_keywords=False)

        end_at = time.perf_counter()
        logging.info(
            click.style('Deal dataset vector index: {} latency: {}'.format(dataset_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("Deal dataset vector index failed")
