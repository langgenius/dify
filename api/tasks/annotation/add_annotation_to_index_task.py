import logging
import time

import click
from celery import shared_task
from flask import current_app

from core.index.index import IndexBuilder
from core.index.vector_index.vector_index import VectorIndex
from extensions.ext_database import db
from models.dataset import DocumentSegment, Dataset, DatasetKeywordTable, DatasetQuery, DatasetProcessRule, \
    AppDatasetJoin, Document
from services.dataset_service import DatasetCollectionBindingService


@shared_task(queue='dataset')
def add_annotation_to_index_task(annotation_id: str, question: str, tenant_id: str, app_id: str,
                                 embedding_provider_name: str, embedding_model_name: str):
    """
    Add annotation to index.
    :param annotation_id: annotation id
    :param question: question
    :param tenant_id: tenant id
    :param app_id: app id
    :param embedding_provider_name: embedding provider name
    :param embedding_model_name: embedding model name

    Usage: clean_dataset_task.delay(dataset_id, tenant_id, indexing_technique, index_struct)
    """
    logging.info(click.style('Start build index for annotation: {}'.format(annotation_id), fg='green'))
    start_at = time.perf_counter()

    try:
        dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
            embedding_provider_name,
            embedding_model_name
        )

        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique='high_quality',
            embedding_model_provider=embedding_provider_name,
            embedding_model=embedding_model_name,
            collection_binding_id=dataset_collection_binding.id
        )

        document = Document(
            page_content=question,
            metadata={
                "annotation_id": annotation_id,
                "app_id": app_id,
            }
        )
        index = IndexBuilder.get_index(dataset, 'high_quality')
        if index:
            index.add_texts([document])
        end_at = time.perf_counter()
        logging.info(
            click.style(
                'Build index successful for annotation: {} latency: {}'.format(annotation_id, end_at - start_at),
                fg='green'))
    except Exception:
        logging.exception("Build index for annotation failed")
