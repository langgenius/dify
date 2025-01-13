import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.datasource.vdb.vector_factory import Vector
from models.dataset import Dataset
from services.dataset_service import DatasetCollectionBindingService


@shared_task(queue="dataset")
def delete_annotation_index_task(annotation_id: str, app_id: str, tenant_id: str, collection_binding_id: str):
    """
    Async delete annotation index task
    """
    logging.info(click.style("Start delete app annotation index: {}".format(app_id), fg="green"))
    start_at = time.perf_counter()
    try:
        dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
            collection_binding_id, "annotation"
        )

        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            collection_binding_id=dataset_collection_binding.id,
        )

        try:
            vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
            vector.delete_by_metadata_field("annotation_id", annotation_id)
        except Exception:
            logging.exception("Delete annotation index failed when annotation deleted.")
        end_at = time.perf_counter()
        logging.info(
            click.style("App annotations index deleted : {} latency: {}".format(app_id, end_at - start_at), fg="green")
        )
    except Exception as e:
        logging.exception("Annotation deleted index failed")
