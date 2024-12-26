import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.models.document import Document
from models.dataset import Dataset
from services.dataset_service import DatasetCollectionBindingService


@shared_task(queue="dataset")
def add_annotation_to_index_task(
    annotation_id: str, question: str, tenant_id: str, app_id: str, collection_binding_id: str
):
    """
    Add annotation to index.
    :param annotation_id: annotation id
    :param question: question
    :param tenant_id: tenant id
    :param app_id: app id
    :param collection_binding_id: embedding binding id

    Usage: clean_dataset_task.delay(dataset_id, tenant_id, indexing_technique, index_struct)
    """
    logging.info(click.style("Start build index for annotation: {}".format(annotation_id), fg="green"))
    start_at = time.perf_counter()

    try:
        dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
            collection_binding_id, "annotation"
        )
        dataset = Dataset(
            id=app_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            embedding_model_provider=dataset_collection_binding.provider_name,
            embedding_model=dataset_collection_binding.model_name,
            collection_binding_id=dataset_collection_binding.id,
        )

        document = Document(
            page_content=question, metadata={"annotation_id": annotation_id, "app_id": app_id, "doc_id": annotation_id}
        )
        vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
        vector.create([document], duplicate_check=True)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Build index successful for annotation: {} latency: {}".format(annotation_id, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("Build index for annotation failed")
