import concurrent.futures
import logging

from core.db.session_factory import session_factory
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from services.summary_index_service import SummaryIndexService
from tasks.generate_summary_index_task import generate_summary_index_task

logger = logging.getLogger(__name__)


class SummaryIndex:
    def generate_and_vectorize_summary(
        self, dataset_id: str, document_id: str, is_preview: bool, summary_index_setting: dict | None = None
    ) -> None:
        if is_preview:
            with session_factory.create_session() as session:
                dataset = session.query(Dataset).filter_by(id=dataset_id).first()
                if not dataset or dataset.indexing_technique != "high_quality":
                    return

                if summary_index_setting is None:
                    summary_index_setting = dataset.summary_index_setting

                if not summary_index_setting or not summary_index_setting.get("enable"):
                    return

                if not document_id:
                    return

                document = session.query(Document).filter_by(id=document_id).first()
                # Skip qa_model documents
                if document is None or document.doc_form == "qa_model":
                    return

                query = session.query(DocumentSegment).filter_by(
                    dataset_id=dataset_id,
                    document_id=document_id,
                    status="completed",
                    enabled=True,
                )
                segments = query.all()
                segment_ids = [segment.id for segment in segments]

                if not segment_ids:
                    return

                existing_summaries = (
                    session.query(DocumentSegmentSummary)
                    .filter(
                        DocumentSegmentSummary.chunk_id.in_(segment_ids),
                        DocumentSegmentSummary.dataset_id == dataset_id,
                        DocumentSegmentSummary.status == "completed",
                    )
                    .all()
                )
                completed_summary_segment_ids = {i.chunk_id for i in existing_summaries}
                # Preview mode should process segments that are MISSING completed summaries
                pending_segment_ids = [sid for sid in segment_ids if sid not in completed_summary_segment_ids]

            # If all segments already have completed summaries, nothing to do in preview mode
            if not pending_segment_ids:
                return

            max_workers = min(10, len(pending_segment_ids))

            def process_segment(segment_id: str) -> None:
                """Process a single segment in a thread with a fresh DB session."""
                with session_factory.create_session() as session:
                    segment = session.query(DocumentSegment).filter_by(id=segment_id).first()
                    if segment is None:
                        return
                    try:
                        SummaryIndexService.generate_and_vectorize_summary(segment, dataset, summary_index_setting)
                    except Exception:
                        logger.exception(
                            "Failed to generate summary for segment %s",
                            segment_id,
                        )
                        # Continue processing other segments

            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(process_segment, segment_id) for segment_id in pending_segment_ids]
                concurrent.futures.wait(futures)
        else:
            generate_summary_index_task.delay(dataset_id, document_id, None)
