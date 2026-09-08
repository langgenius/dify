import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from models.dataset import Dataset, Document, SegmentAttachmentBinding
from models.model import UploadFile

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_segment_from_index_task(
    index_node_ids: list, dataset_id: str, document_id: str, segment_ids: list, child_node_ids: list | None = None
):
    """Remove segment index data and durable attachment records asynchronously.

    :param index_node_ids:
    :param dataset_id:
    :param document_id:

    Usage: delete_segment_from_index_task.delay(index_node_ids, dataset_id, document_id)
    """
    logger.info(click.style("Start delete segment from index", fg="green"))
    start_at = time.perf_counter()
    with session_factory.create_session() as session:
        try:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if not dataset:
                logging.warning("Dataset %s not found, skipping index cleanup", dataset_id)
                return

            dataset_document = session.scalar(select(Document).where(Document.id == document_id).limit(1))
            if not dataset_document:
                return

            document_allows_index_cleanup = (
                dataset_document.enabled
                and not dataset_document.archived
                and dataset_document.indexing_status == "completed"
            )
            index_processor = None
            if document_allows_index_cleanup:
                doc_form = dataset_document.doc_form

                # Proceed with index cleanup using the index_node_ids directly.
                # For actual deletion, delete summaries instead of only disabling them.
                index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                index_processor.clean(
                    dataset,
                    index_node_ids,
                    with_keywords=True,
                    delete_child_chunks=True,
                    precomputed_child_node_ids=child_node_ids,
                    delete_summaries=True,
                    session=session,
                )
                session.commit()
            else:
                logging.info("Document not in valid state for index operations, skipping index cleanup")

            if dataset.is_multimodal:
                # delete segment attachment binding
                segment_attachment_bindings = session.scalars(
                    select(SegmentAttachmentBinding).where(
                        SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset.id,
                        SegmentAttachmentBinding.document_id == document_id,
                        SegmentAttachmentBinding.segment_id.in_(segment_ids),
                    )
                ).all()
                if segment_attachment_bindings:
                    attachment_ids = [binding.attachment_id for binding in segment_attachment_bindings]
                    if index_processor is not None:
                        index_processor.clean(
                            session=session, dataset=dataset, node_ids=attachment_ids, with_keywords=False
                        )
                    segment_attachment_bind_ids = [i.id for i in segment_attachment_bindings]

                    for i in range(0, len(segment_attachment_bind_ids), 1000):
                        segment_attachment_bind_delete_stmt = delete(SegmentAttachmentBinding).where(
                            SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                            SegmentAttachmentBinding.dataset_id == dataset.id,
                            SegmentAttachmentBinding.document_id == document_id,
                            SegmentAttachmentBinding.id.in_(segment_attachment_bind_ids[i : i + 1000]),
                        )
                        session.execute(segment_attachment_bind_delete_stmt)

                    # delete upload file
                    session.execute(
                        delete(UploadFile).where(
                            UploadFile.tenant_id == dataset.tenant_id,
                            UploadFile.id.in_(attachment_ids),
                        )
                    )
                    session.commit()

            end_at = time.perf_counter()
            logger.info(click.style(f"Segment deleted from index latency: {end_at - start_at}", fg="green"))
        except Exception:
            session.rollback()
            logger.exception("delete segment from index failed")
