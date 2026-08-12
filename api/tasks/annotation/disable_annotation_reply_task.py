import logging
import time

import click
from celery import shared_task
from sqlalchemy import exists, select

from core.db.session_factory import session_factory
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_redis import redis_client
from models.dataset import Dataset
from models.model import App, AppAnnotationSetting, MessageAnnotation
from services.annotation_job_service import AnnotationReplyJob, AnnotationReplyJobCoordinator

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def disable_annotation_reply_task(job_id: str, app_id: str, tenant_id: str):
    """
    Async enable annotation reply task
    """
    logger.info(click.style(f"Start delete app annotations index: {app_id}", fg="green"))
    start_at = time.perf_counter()
    job = AnnotationReplyJob(action="disable", app_id=app_id, job_id=job_id)
    coordinator = AnnotationReplyJobCoordinator(redis_client)
    if not coordinator.start(job):
        logger.info("Skip stale annotation reply job %s for app %s", job_id, app_id)
        return

    with session_factory.create_session() as session:
        try:
            app = session.scalar(
                select(App).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal").limit(1)
            )
            if not app:
                logger.info(click.style(f"App not found: {app_id}", fg="red"))
                coordinator.fail(job, "App not found")
                return

            annotations_exists = session.scalar(select(exists().where(MessageAnnotation.app_id == app_id)))
            app_annotation_setting = session.scalar(
                select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1)
            )
            if not app_annotation_setting:
                logger.info(click.style(f"App annotation setting not found: {app_id}", fg="red"))
                coordinator.complete(job)
                return

            dataset = Dataset(
                id=app_id,
                tenant_id=tenant_id,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                collection_binding_id=app_annotation_setting.collection_binding_id,
            )

            try:
                if annotations_exists:
                    vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"], session=session)
                    vector.delete()
            except Exception:
                logger.exception("Delete annotation index failed when annotation deleted.")

            # delete annotation setting
            session.delete(app_annotation_setting)
            session.commit()
            coordinator.complete(job)

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"App annotations index deleted : {app_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except Exception as e:
            logger.exception("Annotation batch deleted index failed")
            session.rollback()
            coordinator.fail(job, str(e))
