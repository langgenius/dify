"""Async task for generating summary indexes."""

import logging
import time

import click
from celery import shared_task

from core.db.session_factory import session_factory
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.summary_index_service import SummaryIndexService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def generate_summary_index_task(dataset_id: str, document_id: str, segment_ids: list[str] | None = None):
    """
    Async generate summary index for document segments.

    Args:
        dataset_id: Dataset ID
        document_id: Document ID
        segment_ids: Optional list of specific segment IDs to process. If None, process all segments.

    Usage:
        generate_summary_index_task.delay(dataset_id, document_id)
        generate_summary_index_task.delay(dataset_id, document_id, segment_ids)
    """
    logger.info(
        click.style(
            f"Start generating summary index for document {document_id} in dataset {dataset_id}",
            fg="green",
        )
    )
    start_at = time.perf_counter()

    try:
        with session_factory.create_session() as session:
            dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
            if not dataset:
                logger.error(click.style(f"Dataset not found: {dataset_id}", fg="red"))
                return

            document = session.query(DatasetDocument).where(DatasetDocument.id == document_id).first()
            if not document:
                logger.error(click.style(f"Document not found: {document_id}", fg="red"))
                return

            # Check if document needs summary
            if not document.need_summary:
                logger.info(
                    click.style(
                        f"Skipping summary generation for document {document_id}: need_summary is False",
                        fg="cyan",
                    )
                )
                return

            # Only generate summary index for high_quality indexing technique
            if dataset.indexing_technique != "high_quality":
                logger.info(
                    click.style(
                        f"Skipping summary generation for dataset {dataset_id}: "
                        f"indexing_technique is {dataset.indexing_technique}, not 'high_quality'",
                        fg="cyan",
                    )
                )
                return

            # Check if summary index is enabled
            summary_index_setting = dataset.summary_index_setting
            if not summary_index_setting or not summary_index_setting.get("enable"):
                logger.info(
                    click.style(
                        f"Summary index is disabled for dataset {dataset_id}",
                        fg="cyan",
                    )
                )
                return

            # Determine if only parent chunks should be processed
            only_parent_chunks = dataset.chunk_structure == "parent_child_index"

            # Generate summaries
            summary_records = SummaryIndexService.generate_summaries_for_document(
                dataset=dataset,
                document=document,
                summary_index_setting=summary_index_setting,
                segment_ids=segment_ids,
                only_parent_chunks=only_parent_chunks,
            )

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Summary index generation completed for document {document_id}: "
                    f"{len(summary_records)} summaries generated, latency: {end_at - start_at}",
                    fg="green",
                )
            )

    except Exception as e:
        logger.exception("Failed to generate summary index for document %s", document_id)
        # Update document segments with error status if needed
        if segment_ids:
            error_message = f"Summary generation failed: {str(e)}"
            with session_factory.create_session() as session:
                session.query(DocumentSegment).filter(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.dataset_id == dataset_id,
                ).update(
                    {
                        DocumentSegment.error: error_message,
                    },
                    synchronize_session=False,
                )
                session.commit()
