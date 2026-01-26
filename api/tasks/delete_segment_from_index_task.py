import logging
import time

import click
from celery import shared_task

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from models.dataset import Dataset, Document, SegmentAttachmentBinding
from models.model import UploadFile

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_segment_from_index_task(
    index_node_ids: list, dataset_id: str, document_id: str, segment_ids: list, child_node_ids: list | None = None
):
    """
    Async Remove segment from index
    :param index_node_ids:
    :param dataset_id:
    :param document_id:

    Usage: delete_segment_from_index_task.delay(index_node_ids, dataset_id, document_id)
    """
    logger.info(click.style("Start delete segment from index", fg="green"))
    start_at = time.perf_counter()
    with session_factory.create_session() as session:
        try:
            dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
            if not dataset:
                logging.warning("Dataset %s not found, skipping index cleanup", dataset_id)
                return

            dataset_document = session.query(Document).where(Document.id == document_id).first()
            if not dataset_document:
                return

            if (
                not dataset_document.enabled
                or dataset_document.archived
                or dataset_document.indexing_status != "completed"
            ):
                logging.info("Document not in valid state for index operations, skipping")
                return
            doc_form = dataset_document.doc_form

            # Proceed with index cleanup using the index_node_ids directly
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.clean(
                dataset,
                index_node_ids,
                with_keywords=True,
                delete_child_chunks=True,
                precomputed_child_node_ids=child_node_ids,
            )
            if dataset.is_multimodal:
                # delete segment attachment binding
                segment_attachment_bindings = (
                    session.query(SegmentAttachmentBinding)
                    .where(SegmentAttachmentBinding.segment_id.in_(segment_ids))
                    .all()
                )
                if segment_attachment_bindings:
                    attachment_ids = [binding.attachment_id for binding in segment_attachment_bindings]
                    index_processor.clean(dataset=dataset, node_ids=attachment_ids, with_keywords=False)
                    for binding in segment_attachment_bindings:
                        session.delete(binding)
                    # delete upload file
                    session.query(UploadFile).where(UploadFile.id.in_(attachment_ids)).delete(synchronize_session=False)
                    session.commit()

            end_at = time.perf_counter()
            logger.info(click.style(f"Segment deleted from index latency: {end_at - start_at}", fg="green"))
        except Exception:
            logger.exception("delete segment from index failed")
