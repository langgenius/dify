import datetime
import logging
import time

import click
from celery import shared_task
from langchain.schema import Document
from werkzeug.exceptions import NotFound

from core.index.index import IndexBuilder
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset
from models.model import MessageAnnotation, App
from services.dataset_service import DatasetCollectionBindingService


@shared_task(queue='dataset')
def delete_annotation_index_task(annotation_id: str, app_id: str, tenant_id: str,
                                 embedding_provider_name: str, embedding_model_name: str):
    """
    Async delete annotation index task
    """
    logging.info(click.style('Start delete app annotation index: {}'.format(app_id), fg='green'))
    start_at = time.perf_counter()
    try:
        dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
            embedding_provider_name,
            embedding_model_name,
            'annotation'
        )

        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique='high_quality',
            collection_binding_id=dataset_collection_binding.id
        )

        vector_index = IndexBuilder.get_default_high_quality_index(dataset)
        if vector_index:
            try:
                vector_index.delete_by_metadata_field('annotation_id', annotation_id)
            except Exception:
                logging.exception("Delete annotation index failed when annotation deleted.")
        end_at = time.perf_counter()
        logging.info(
            click.style('App annotations index deleted : {} latency: {}'.format(app_id, end_at - start_at),
                        fg='green'))
    except Exception as e:
        logging.exception("Annotation deleted index failed:{}".format(str(e)))

