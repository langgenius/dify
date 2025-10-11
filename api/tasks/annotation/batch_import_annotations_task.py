import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset
from models.model import App, AppAnnotationSetting, MessageAnnotation
from services.dataset_service import DatasetCollectionBindingService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def batch_import_annotations_task(job_id: str, content_list: list[dict], app_id: str, tenant_id: str, user_id: str):
    """
    Add annotation to index.
    :param job_id: job_id
    :param content_list: content list
    :param app_id: app id
    :param tenant_id: tenant id
    :param user_id: user_id

    """
    logger.info(click.style(f"Start batch import annotation: {job_id}", fg="green"))
    start_at = time.perf_counter()
    indexing_cache_key = f"app_annotation_batch_import_{str(job_id)}"
    # get app info
    app = db.session.query(App).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal").first()

    if app:
        try:
            documents = []
            for content in content_list:
                annotation = MessageAnnotation(
                    app_id=app.id, content=content["answer"], question=content["question"], account_id=user_id
                )
                db.session.add(annotation)
                db.session.flush()

                document = Document(
                    page_content=content["question"],
                    metadata={"annotation_id": annotation.id, "app_id": app_id, "doc_id": annotation.id},
                )
                documents.append(document)
            # if annotation reply is enabled , batch add annotations' index
            app_annotation_setting = (
                db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
            )

            if app_annotation_setting:
                dataset_collection_binding = (
                    DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
                        app_annotation_setting.collection_binding_id, "annotation"
                    )
                )
                if not dataset_collection_binding:
                    raise NotFound("App annotation setting not found")
                dataset = Dataset(
                    id=app_id,
                    tenant_id=tenant_id,
                    indexing_technique="high_quality",
                    embedding_model_provider=dataset_collection_binding.provider_name,
                    embedding_model=dataset_collection_binding.model_name,
                    collection_binding_id=dataset_collection_binding.id,
                )

                vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
                vector.create(documents, duplicate_check=True)

            db.session.commit()
            redis_client.setex(indexing_cache_key, 600, "completed")
            end_at = time.perf_counter()
            logger.info(
                click.style(
                    "Build index successful for batch import annotation: {} latency: {}".format(
                        job_id, end_at - start_at
                    ),
                    fg="green",
                )
            )
        except Exception as e:
            db.session.rollback()
            redis_client.setex(indexing_cache_key, 600, "error")
            indexing_error_msg_key = f"app_annotation_batch_import_error_msg_{str(job_id)}"
            redis_client.setex(indexing_error_msg_key, 600, str(e))
            logger.exception("Build index for batch import annotations failed")
        finally:
            db.session.close()
