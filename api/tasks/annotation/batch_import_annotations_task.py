import json
import logging
import time

import click
from celery import shared_task
from flask import current_app

from core.index.index import IndexBuilder
from core.index.vector_index.vector_index import VectorIndex
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment, Dataset, DatasetKeywordTable, DatasetQuery, DatasetProcessRule, \
    AppDatasetJoin, Document
from models.model import MessageAnnotation, App
from services.dataset_service import DatasetCollectionBindingService


@shared_task(queue='dataset')
def batch_import_annotations_task(job_id: str, content_list: list[dict], app_id: str, tenant_id: str,
                                  user_id: str):
    """
    Add annotation to index.
    :param job_id: job_id
    :param content_list: content list
    :param tenant_id: tenant id
    :param app_id: app id
    :param user_id: user_id

    """
    logging.info(click.style('Start batch import annotation: {}'.format(job_id), fg='green'))
    start_at = time.perf_counter()
    indexing_cache_key = 'app_annotation_batch_import_{}'.format(str(job_id))
    # get app info
    app = db.session.query(App).filter(
        App.id == app_id,
        App.tenant_id == tenant_id,
        App.status == 'normal'
    ).first()

    if app:
        try:
            documents = []
            for content in content_list:
                annotation = MessageAnnotation(
                    app_id=app.id,
                    content=content['answer'],
                    question=content['question'],
                    account_id=user_id
                )
                db.session.add(annotation)
                db.session.flush()

                document = Document(
                    page_content=content['question'],
                    metadata={
                        "annotation_id": annotation.id,
                        "app_id": app_id,
                    }
                )
                documents.append(document)
            # if annotation reply is enabled , batch add annotations' index
            app_model_config = app.app_model_config
            if app_model_config:
                if app_model_config.annotation_reply:
                    annotation_reply_config = json.loads(app_model_config.annotation_reply)
                    if annotation_reply_config['enabled']:

                        dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                            annotation_reply_config['embedding_model']['embedding_provider_name'],
                            annotation_reply_config['embedding_model']['embedding_model_name']
                        )

                        dataset = Dataset(
                            id=app_id,
                            tenant_id=tenant_id,
                            indexing_technique='high_quality',
                            embedding_model_provider=annotation_reply_config[
                                'embedding_model']['embedding_provider_name'],
                            embedding_model=annotation_reply_config['embedding_model']['embedding_model_name'],
                            collection_binding_id=dataset_collection_binding.id
                        )

                        index = IndexBuilder.get_index(dataset, 'high_quality')
                        if index:
                            index.add_texts([documents])
            db.session.commit()
            redis_client.setex(indexing_cache_key, 600, 'completed')
            end_at = time.perf_counter()
            logging.info(
                click.style(
                    'Build index successful for batch import annotation: {} latency: {}'.format(job_id, end_at - start_at),
                    fg='green'))
        except Exception as e:
            db.session.rollback()
            redis_client.setex(indexing_cache_key, 600, 'error')
            indexing_error_msg_key = 'app_annotation_batch_import_error_msg_{}'.format(str(job_id))
            redis_client.setex(indexing_error_msg_key, 600, str(e))
            logging.exception("Build index for batch import annotations failed")
