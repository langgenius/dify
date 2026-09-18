import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import IndexingStatus
from models.model import UploadFile
from tasks.generate_summary_index_task import generate_summary_index_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def document_indexing_update_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    logger.info(click.style(f"Start update document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    has_error = False
    try:
        with session_factory.create_session() as session:
            document = session.scalar(
                select(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
            )

            if not document:
                logger.info(click.style(f"Document not found: {document_id}", fg="red"))
                return

            document.indexing_status = IndexingStatus.PARSING
            document.processing_started_at = naive_utc_now()

            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if not dataset:
                return

            index_type = document.doc_form
            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
            index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
            # Persist the parsing status before vector cleanup and extraction.
            session.commit()

            clean_success = False
            index_processor = None
            try:
                index_processor = IndexProcessorFactory(index_type).init_index_processor()
                if index_node_ids:
                    index_processor.clean(
                        dataset,
                        index_node_ids,
                        with_keywords=True,
                        delete_child_chunks=True,
                        session=session,
                    )
                    end_at = time.perf_counter()
                    logger.info(
                        click.style(
                            "Cleaned document when document update data source or process rule: {} latency: {}".format(
                                document_id, end_at - start_at
                            ),
                            fg="green",
                        )
                    )
                    clean_success = True
            except Exception:
                logger.exception("Failed to clean document index during update, document_id: %s", document_id)
                session.rollback()
                document = session.scalar(
                    select(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
                )
                if not document:
                    logger.info(click.style(f"Document not found: {document_id}", fg="red"))
                    return
                document.indexing_status = IndexingStatus.PARSING
                document.processing_started_at = naive_utc_now()
                session.commit()

            if clean_success and index_processor is not None:
                attachment_storage_keys: list[str] = []
                if dataset.is_multimodal:
                    segment_attachment_bindings = session.scalars(
                        select(SegmentAttachmentBinding).where(
                            SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                            SegmentAttachmentBinding.dataset_id == dataset.id,
                            SegmentAttachmentBinding.document_id == document_id,
                        )
                    ).all()
                    attachment_ids = list(
                        dict.fromkeys(binding.attachment_id for binding in segment_attachment_bindings)
                    )

                    if segment_attachment_bindings:
                        session.execute(
                            delete(SegmentAttachmentBinding).where(
                                SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                                SegmentAttachmentBinding.dataset_id == dataset.id,
                                SegmentAttachmentBinding.document_id == document_id,
                            )
                        )
                        session.flush()

                        remaining_attachment_ids = set(
                            session.scalars(
                                select(SegmentAttachmentBinding.attachment_id).where(
                                    SegmentAttachmentBinding.attachment_id.in_(attachment_ids)
                                )
                            ).all()
                        )
                        orphan_attachment_ids = [
                            attachment_id
                            for attachment_id in attachment_ids
                            if attachment_id not in remaining_attachment_ids
                        ]

                        if orphan_attachment_ids:
                            attachment_storage_keys = list(
                                dict.fromkeys(
                                    session.scalars(
                                        select(UploadFile.key).where(
                                            UploadFile.tenant_id == dataset.tenant_id,
                                            UploadFile.id.in_(orphan_attachment_ids),
                                        )
                                    ).all()
                                )
                            )
                            index_processor.clean(
                                session=session,
                                dataset=dataset,
                                node_ids=orphan_attachment_ids,
                                with_keywords=False,
                            )
                            session.execute(
                                delete(UploadFile).where(
                                    UploadFile.tenant_id == dataset.tenant_id,
                                    UploadFile.id.in_(orphan_attachment_ids),
                                )
                            )

                segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.document_id == document_id)
                session.execute(segment_delete_stmt)
                session.commit()

                for storage_key in attachment_storage_keys:
                    try:
                        storage.delete(storage_key)
                    except Exception:
                        logger.exception(
                            "Failed to delete document attachment from storage during re-indexing, key: %s",
                            storage_key,
                        )

            indexing_runner = IndexingRunner()
            indexing_runner.run([document], session)
            session.commit()

            end_at = time.perf_counter()
            logger.info(click.style(f"update document: {document.id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
        has_error = True
    except Exception:
        logger.exception("document_indexing_update_task failed, document_id: %s", document_id)
        has_error = True

    if has_error:
        return

    # Trigger summary index generation for the updated document if enabled.
    # Only generate for high_quality indexing technique and when summary_index_setting is enabled.
    with session_factory.create_session() as session:
        document = session.scalar(
            select(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
        )
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if not dataset:
            logger.warning("Dataset %s not found after update indexing", dataset_id)
            return

        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            summary_index_setting = dataset.summary_index_setting
            if summary_index_setting and summary_index_setting.get("enable"):
                if (
                    document
                    and document.indexing_status == IndexingStatus.COMPLETED
                    and document.doc_form != IndexStructureType.QA_INDEX
                    and document.need_summary is True
                ):
                    try:
                        generate_summary_index_task.delay(dataset.id, document.id, None)
                        logger.info(
                            "Queued summary index generation task for document %s in dataset %s "
                            "after update indexing completed",
                            document.id,
                            dataset.id,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to queue summary index generation task for document %s after update",
                            document.id,
                        )
