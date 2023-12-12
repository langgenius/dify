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
def enable_annotation_reply_task(job_id: str, app_id: str, tenant_id: str,
                                 embedding_provider_name: str, embedding_model_name: str):
    """
    Async enable annotation reply task
    """
    logging.info(click.style('Start add app annotation to index: {}'.format(app_id), fg='green'))
    start_at = time.perf_counter()
    # get app info
    app = db.session.query(App).filter(
        App.id == app_id,
        App.tenant_id == tenant_id,
        App.status == 'normal'
    ).first()

    if not app:
        raise NotFound("App not found")

    annotations = db.session.query(MessageAnnotation).filter(MessageAnnotation.app_id == app_id).all()
    enable_app_annotation_key = 'enable_app_annotation_{}'.format(str(app_id))
    enable_app_annotation_job_key = 'enable_app_annotation_job_{}'.format(str(job_id))

    try:
        documents = []
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
        for annotation in annotations:
            document = Document(
                page_content=annotation.question,
                metadata={
                    "annotation_id": annotation.id,
                    "app_id": app_id,
                }
            )
            documents.append(document)
        index = IndexBuilder.get_index(dataset, 'high_quality')
        if index:
            index.delete_by_metadata_field('app_id', app_id)
            index.add_texts(documents)
        end_at = time.perf_counter()
        logging.info(
            click.style('App annotations added to index: {} latency: {}'.format(app_id, end_at - start_at),
                        fg='green'))
    except Exception as e:
        logging.exception("Annotation batch created index failed:{}".format(str(e)))
        redis_client.setex(enable_app_annotation_job_key, 600, 'error')
        enable_app_annotation_error_key = 'enable_app_annotation_error_{}'.format(str(job_id))
        redis_client.setex(enable_app_annotation_error_key, 600, str(e))
    finally:
        redis_client.delete(enable_app_annotation_key)
