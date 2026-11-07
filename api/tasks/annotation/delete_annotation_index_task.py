import logging
import time

import click
from celery import shared_task

from core.db.session_factory import session_factory
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.dataset import Dataset
from repositories.knowledge.dataset_read_repository import get_dataset_collection_binding

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_annotation_index_task(annotation_id: str, app_id: str, tenant_id: str, collection_binding_id: str):
    """
    Async delete annotation index task
    """
    logger.info(click.style(f"Start delete app annotation index: {app_id}", fg="green"))
    start_at = time.perf_counter()
    try:
        with session_factory.create_session() as session:
            dataset_collection_binding = get_dataset_collection_binding(
                session,
                binding_id=collection_binding_id,
                collection_type="annotation",
            )
            if dataset_collection_binding is None:
                raise ValueError("Dataset collection binding not found")

        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            collection_binding_id=dataset_collection_binding.id,
        )

        try:
            with session_factory.create_session() as session:
                vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"], session=session)
            vector.delete_by_metadata_field("annotation_id", annotation_id)
        except Exception:
            logger.exception("Delete annotation index failed when annotation deleted.")
        end_at = time.perf_counter()
        logger.info(click.style(f"App annotations index deleted : {app_id} latency: {end_at - start_at}", fg="green"))
    except Exception:
        logger.exception("Annotation deleted index failed")
