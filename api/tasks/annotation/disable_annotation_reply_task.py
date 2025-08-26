import logging
import time

import click
from celery import shared_task
from sqlalchemy import exists, select

from core.rag.datasource.vdb.vector_factory import Vector
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset
from models.model import App, AppAnnotationSetting, MessageAnnotation

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def disable_annotation_reply_task(job_id: str, app_id: str, tenant_id: str):
    """
    Async enable annotation reply task
    """
    logger.info(click.style(f"Start delete app annotations index: {app_id}", fg="green"))
    start_at = time.perf_counter()
    # get app info
    app = db.session.query(App).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal").first()
    annotations_exists = db.session.scalar(select(exists().where(MessageAnnotation.app_id == app_id)))
    if not app:
        logger.info(click.style(f"App not found: {app_id}", fg="red"))
        db.session.close()
        return

    app_annotation_setting = db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()

    if not app_annotation_setting:
        logger.info(click.style(f"App annotation setting not found: {app_id}", fg="red"))
        db.session.close()
        return

    disable_app_annotation_key = f"disable_app_annotation_{str(app_id)}"
    disable_app_annotation_job_key = f"disable_app_annotation_job_{str(job_id)}"

    try:
        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            collection_binding_id=app_annotation_setting.collection_binding_id,
        )

        try:
            if annotations_exists:
                vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
                vector.delete()
        except Exception:
            logger.exception("Delete annotation index failed when annotation deleted.")
        redis_client.setex(disable_app_annotation_job_key, 600, "completed")

        # delete annotation setting
        db.session.delete(app_annotation_setting)
        db.session.commit()

        end_at = time.perf_counter()
        logger.info(click.style(f"App annotations index deleted : {app_id} latency: {end_at - start_at}", fg="green"))
    except Exception as e:
        logger.exception("Annotation batch deleted index failed")
        redis_client.setex(disable_app_annotation_job_key, 600, "error")
        disable_app_annotation_error_key = f"disable_app_annotation_error_{str(job_id)}"
        redis_client.setex(disable_app_annotation_error_key, 600, str(e))
    finally:
        redis_client.delete(disable_app_annotation_key)
        db.session.close()
