import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset
from models.model import App, AppAnnotationSetting, MessageAnnotation
from services.dataset_service import DatasetCollectionBindingService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def enable_annotation_reply_task(
    job_id: str,
    app_id: str,
    user_id: str,
    tenant_id: str,
    score_threshold: float,
    embedding_provider_name: str,
    embedding_model_name: str,
):
    """
    Async enable annotation reply task
    """
    logger.info(click.style(f"Start add app annotation to index: {app_id}", fg="green"))
    start_at = time.perf_counter()
    # get app info
    with session_factory.create_session() as session:
        app = session.query(App).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal").first()

        if not app:
            logger.info(click.style(f"App not found: {app_id}", fg="red"))
            return

        annotations = session.scalars(select(MessageAnnotation).where(MessageAnnotation.app_id == app_id)).all()
        enable_app_annotation_key = f"enable_app_annotation_{str(app_id)}"
        enable_app_annotation_job_key = f"enable_app_annotation_job_{str(job_id)}"

        try:
            documents = []
            dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                embedding_provider_name, embedding_model_name, "annotation"
            )
            annotation_setting = (
                session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
            )
            if annotation_setting:
                if dataset_collection_binding.id != annotation_setting.collection_binding_id:
                    old_dataset_collection_binding = (
                        DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
                            annotation_setting.collection_binding_id, "annotation"
                        )
                    )
                    if old_dataset_collection_binding and annotations:
                        old_dataset = Dataset(
                            id=app_id,
                            tenant_id=tenant_id,
                            indexing_technique="high_quality",
                            embedding_model_provider=old_dataset_collection_binding.provider_name,
                            embedding_model=old_dataset_collection_binding.model_name,
                            collection_binding_id=old_dataset_collection_binding.id,
                        )

                        old_vector = Vector(old_dataset, attributes=["doc_id", "annotation_id", "app_id"])
                        try:
                            old_vector.delete()
                        except Exception as e:
                            logger.info(click.style(f"Delete annotation index error: {str(e)}", fg="red"))
                annotation_setting.score_threshold = score_threshold
                annotation_setting.collection_binding_id = dataset_collection_binding.id
                annotation_setting.updated_user_id = user_id
                annotation_setting.updated_at = naive_utc_now()
                session.add(annotation_setting)
            else:
                new_app_annotation_setting = AppAnnotationSetting(
                    app_id=app_id,
                    score_threshold=score_threshold,
                    collection_binding_id=dataset_collection_binding.id,
                    created_user_id=user_id,
                    updated_user_id=user_id,
                )
                session.add(new_app_annotation_setting)

            dataset = Dataset(
                id=app_id,
                tenant_id=tenant_id,
                indexing_technique="high_quality",
                embedding_model_provider=embedding_provider_name,
                embedding_model=embedding_model_name,
                collection_binding_id=dataset_collection_binding.id,
            )
            if annotations:
                for annotation in annotations:
                    document = Document(
                        page_content=annotation.question_text,
                        metadata={"annotation_id": annotation.id, "app_id": app_id, "doc_id": annotation.id},
                    )
                    documents.append(document)

                vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
                try:
                    vector.delete_by_metadata_field("app_id", app_id)
                except Exception as e:
                    logger.info(click.style(f"Delete annotation index error: {str(e)}", fg="red"))
                vector.create(documents)
            session.commit()
            redis_client.setex(enable_app_annotation_job_key, 600, "completed")
            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"App annotations added to index: {app_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except Exception as e:
            logger.exception("Annotation batch created index failed")
            redis_client.setex(enable_app_annotation_job_key, 600, "error")
            enable_app_annotation_error_key = f"enable_app_annotation_error_{str(job_id)}"
            redis_client.setex(enable_app_annotation_error_key, 600, str(e))
            session.rollback()
        finally:
            redis_client.delete(enable_app_annotation_key)
