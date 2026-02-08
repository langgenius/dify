"""Task for regenerating summary indexes when dataset settings change."""

import logging
import time
from collections import defaultdict

import click
from celery import shared_task
from sqlalchemy import or_, select

from core.db.session_factory import session_factory
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument
from services.summary_index_service import SummaryIndexService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def regenerate_summary_index_task(
    dataset_id: str,
    regenerate_reason: str = "summary_model_changed",
    regenerate_vectors_only: bool = False,
):
    """
    Regenerate summary indexes for all documents in a dataset.

    This task is triggered when:
    1. summary_index_setting model changes (regenerate_reason="summary_model_changed")
       - Regenerates summary content and vectors for all existing summaries
    2. embedding_model changes (regenerate_reason="embedding_model_changed")
       - Only regenerates vectors for existing summaries (keeps summary content)

    Args:
        dataset_id: Dataset ID
        regenerate_reason: Reason for regeneration ("summary_model_changed" or "embedding_model_changed")
        regenerate_vectors_only: If True, only regenerate vectors without regenerating summary content
    """
    logger.info(
        click.style(
            f"Start regenerate summary index for dataset {dataset_id}, reason: {regenerate_reason}",
            fg="green",
        )
    )
    start_at = time.perf_counter()

    try:
        with session_factory.create_session() as session:
            dataset = session.query(Dataset).filter_by(id=dataset_id).first()
            if not dataset:
                logger.error(click.style(f"Dataset not found: {dataset_id}", fg="red"))
                return

            # Only regenerate summary index for high_quality indexing technique
            if dataset.indexing_technique != "high_quality":
                logger.info(
                    click.style(
                        f"Skipping summary regeneration for dataset {dataset_id}: "
                        f"indexing_technique is {dataset.indexing_technique}, not 'high_quality'",
                        fg="cyan",
                    )
                )
                return

            # Check if summary index is enabled (only for summary_model change)
            # For embedding_model change, we still re-vectorize existing summaries even if setting is disabled
            summary_index_setting = dataset.summary_index_setting
            if not regenerate_vectors_only:
                # For summary_model change, require summary_index_setting to be enabled
                if not summary_index_setting or not summary_index_setting.get("enable"):
                    logger.info(
                        click.style(
                            f"Summary index is disabled for dataset {dataset_id}",
                            fg="cyan",
                        )
                    )
                    return

            total_segments_processed = 0
            total_segments_failed = 0

            if regenerate_vectors_only:
                # For embedding_model change: directly query all segments with existing summaries
                # Don't require document indexing_status == "completed"
                # Include summaries with status "completed" or "error" (if they have content)
                segments_with_summaries = (
                    session.query(DocumentSegment, DocumentSegmentSummary)
                    .join(
                        DocumentSegmentSummary,
                        DocumentSegment.id == DocumentSegmentSummary.chunk_id,
                    )
                    .join(
                        DatasetDocument,
                        DocumentSegment.document_id == DatasetDocument.id,
                    )
                    .where(
                        DocumentSegment.dataset_id == dataset_id,
                        DocumentSegment.status == "completed",  # Segment must be completed
                        DocumentSegment.enabled == True,
                        DocumentSegmentSummary.dataset_id == dataset_id,
                        DocumentSegmentSummary.summary_content.isnot(None),  # Must have summary content
                        # Include completed summaries or error summaries (with content)
                        or_(
                            DocumentSegmentSummary.status == "completed",
                            DocumentSegmentSummary.status == "error",
                        ),
                        DatasetDocument.enabled == True,  # Document must be enabled
                        DatasetDocument.archived == False,  # Document must not be archived
                        DatasetDocument.doc_form != "qa_model",  # Skip qa_model documents
                    )
                    .order_by(DocumentSegment.document_id.asc(), DocumentSegment.position.asc())
                    .all()
                )

                if not segments_with_summaries:
                    logger.info(
                        click.style(
                            f"No segments with summaries found for re-vectorization in dataset {dataset_id}",
                            fg="cyan",
                        )
                    )
                    return

                logger.info(
                    "Found %s segments with summaries for re-vectorization in dataset %s",
                    len(segments_with_summaries),
                    dataset_id,
                )

                # Group by document for logging
                segments_by_document = defaultdict(list)
                for segment, summary_record in segments_with_summaries:
                    segments_by_document[segment.document_id].append((segment, summary_record))

                logger.info(
                    "Segments grouped into %s documents for re-vectorization",
                    len(segments_by_document),
                )

                for document_id, segment_summary_pairs in segments_by_document.items():
                    logger.info(
                        "Re-vectorizing summaries for %s segments in document %s",
                        len(segment_summary_pairs),
                        document_id,
                    )

                    for segment, summary_record in segment_summary_pairs:
                        try:
                            # Delete old vector
                            if summary_record.summary_index_node_id:
                                try:
                                    from core.rag.datasource.vdb.vector_factory import Vector

                                    vector = Vector(dataset)
                                    vector.delete_by_ids([summary_record.summary_index_node_id])
                                except Exception as e:
                                    logger.warning(
                                        "Failed to delete old summary vector for segment %s: %s",
                                        segment.id,
                                        str(e),
                                    )

                            # Re-vectorize with new embedding model
                            SummaryIndexService.vectorize_summary(summary_record, segment, dataset)
                            session.commit()
                            total_segments_processed += 1

                        except Exception as e:
                            logger.error(
                                "Failed to re-vectorize summary for segment %s: %s",
                                segment.id,
                                str(e),
                                exc_info=True,
                            )
                            total_segments_failed += 1
                            # Update summary record with error status
                            summary_record.status = "error"
                            summary_record.error = f"Re-vectorization failed: {str(e)}"
                            session.add(summary_record)
                            session.commit()
                            continue

            else:
                # For summary_model change: require document indexing_status == "completed"
                # Get all documents with completed indexing status
                dataset_documents = session.scalars(
                    select(DatasetDocument).where(
                        DatasetDocument.dataset_id == dataset_id,
                        DatasetDocument.indexing_status == "completed",
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                ).all()

                if not dataset_documents:
                    logger.info(
                        click.style(
                            f"No documents found for summary regeneration in dataset {dataset_id}",
                            fg="cyan",
                        )
                    )
                    return

                logger.info(
                    "Found %s documents for summary regeneration in dataset %s",
                    len(dataset_documents),
                    dataset_id,
                )

                for dataset_document in dataset_documents:
                    # Skip qa_model documents
                    if dataset_document.doc_form == "qa_model":
                        continue

                    try:
                        # Get all segments with existing summaries
                        segments = (
                            session.query(DocumentSegment)
                            .join(
                                DocumentSegmentSummary,
                                DocumentSegment.id == DocumentSegmentSummary.chunk_id,
                            )
                            .where(
                                DocumentSegment.document_id == dataset_document.id,
                                DocumentSegment.dataset_id == dataset_id,
                                DocumentSegment.status == "completed",
                                DocumentSegment.enabled == True,
                                DocumentSegmentSummary.dataset_id == dataset_id,
                            )
                            .order_by(DocumentSegment.position.asc())
                            .all()
                        )

                        if not segments:
                            continue

                        logger.info(
                            "Regenerating summaries for %s segments in document %s",
                            len(segments),
                            dataset_document.id,
                        )

                        for segment in segments:
                            summary_record = None
                            try:
                                # Get existing summary record
                                summary_record = (
                                    session.query(DocumentSegmentSummary)
                                    .filter_by(
                                        chunk_id=segment.id,
                                        dataset_id=dataset_id,
                                    )
                                    .first()
                                )

                                if not summary_record:
                                    logger.warning("Summary record not found for segment %s, skipping", segment.id)
                                    continue

                                # Regenerate both summary content and vectors (for summary_model change)
                                SummaryIndexService.generate_and_vectorize_summary(
                                    segment, dataset, summary_index_setting
                                )
                                session.commit()
                                total_segments_processed += 1

                            except Exception as e:
                                logger.error(
                                    "Failed to regenerate summary for segment %s: %s",
                                    segment.id,
                                    str(e),
                                    exc_info=True,
                                )
                                total_segments_failed += 1
                                # Update summary record with error status
                                if summary_record:
                                    summary_record.status = "error"
                                    summary_record.error = f"Regeneration failed: {str(e)}"
                                    session.add(summary_record)
                                    session.commit()
                                continue

                    except Exception as e:
                        logger.error(
                            "Failed to process document %s for summary regeneration: %s",
                            dataset_document.id,
                            str(e),
                            exc_info=True,
                        )
                        continue

            end_at = time.perf_counter()
            if regenerate_vectors_only:
                logger.info(
                    click.style(
                        f"Summary re-vectorization completed for dataset {dataset_id}: "
                        f"{total_segments_processed} segments processed successfully, "
                        f"{total_segments_failed} segments failed, "
                        f"latency: {end_at - start_at:.2f}s",
                        fg="green",
                    )
                )
            else:
                logger.info(
                    click.style(
                        f"Summary index regeneration completed for dataset {dataset_id}: "
                        f"{total_segments_processed} segments processed successfully, "
                        f"{total_segments_failed} segments failed, "
                        f"latency: {end_at - start_at:.2f}s",
                        fg="green",
                    )
                )

    except Exception:
        logger.exception("Regenerate summary index failed for dataset %s", dataset_id)
