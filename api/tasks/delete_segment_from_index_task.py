import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from models.dataset import Dataset, Document, SegmentAttachmentBinding
from models.model import UploadFile
from services.vector_service import VectorService

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
    :param segment_ids:
    :param child_node_ids:

    Usage: delete_segment_from_index_task.delay(index_node_ids, dataset_id, document_id, segment_ids, child_node_ids)
    """
    logger.info(click.style("Start delete segment from index", fg="green"))
    start_at = time.perf_counter()
    with session_factory.create_session() as session:
        try:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if not dataset:
                logging.warning("Dataset %s not found, skipping index cleanup", dataset_id)
                VectorService.delete_segment_relational_dependants(
                    session=session,
                    dataset_id=dataset_id,
                    segment_ids=segment_ids,
                )
                session.commit()
                return

            dataset_document = session.scalar(
                select(Document)
                .where(
                    Document.id == document_id,
                    Document.dataset_id == dataset_id,
                )
                .limit(1)
            )
            if not dataset_document:
                logging.warning("Document %s not found, skipping external index cleanup", document_id)
                VectorService.delete_segment_relational_dependants(
                    session=session,
                    dataset_id=dataset_id,
                    segment_ids=segment_ids,
                )
                session.commit()
                return

            doc_form = dataset_document.doc_form

            # Deletion cleanup is driven by durable IDs and must not depend on
            # the document's current indexing state. The segment row has
            # already been removed by the caller at this point.
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            session.commit()
            index_processor.clean(
                dataset,
                index_node_ids,
                with_keywords=True,
                delete_child_chunks=True,
                precomputed_child_node_ids=child_node_ids,
                delete_summaries=True,  # Actually delete summaries when segment is deleted
                segment_ids=segment_ids,
                session=session,
            )
            session.commit()
            if dataset.is_multimodal:
                # delete segment attachment binding
                segment_attachment_bindings = session.scalars(
                    select(SegmentAttachmentBinding).where(
                        SegmentAttachmentBinding.segment_id.in_(segment_ids),
                        SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset.id,
                        SegmentAttachmentBinding.document_id == dataset_document.id,
                    )
                ).all()
                if segment_attachment_bindings:
                    attachment_ids = [binding.attachment_id for binding in segment_attachment_bindings]
                    segment_attachment_bind_ids = [binding.id for binding in segment_attachment_bindings]
                    session.commit()
                    index_processor.clean(
                        session=session, dataset=dataset, node_ids=attachment_ids, with_keywords=False
                    )

                    for i in range(0, len(segment_attachment_bind_ids), 1000):
                        segment_attachment_bind_delete_stmt = delete(SegmentAttachmentBinding).where(
                            SegmentAttachmentBinding.id.in_(segment_attachment_bind_ids[i : i + 1000])
                        )
                        session.execute(segment_attachment_bind_delete_stmt)

                    # delete upload file
                    session.execute(
                        delete(UploadFile).where(
                            UploadFile.id.in_(attachment_ids),
                            UploadFile.tenant_id == dataset.tenant_id,
                        )
                    )
                    session.commit()

            end_at = time.perf_counter()
            logger.info(click.style(f"Segment deleted from index latency: {end_at - start_at}", fg="green"))
        except Exception:
            session.rollback()
            logger.exception("delete segment from index failed")
            try:
                VectorService.delete_segment_relational_dependants(
                    session=session,
                    dataset_id=dataset_id,
                    segment_ids=segment_ids,
                )
                session.commit()
            except Exception:
                session.rollback()
                logger.exception("Failed to remove relational rows after segment index cleanup failed")
