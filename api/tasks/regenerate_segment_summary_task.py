"""Debounced summary regeneration for manually edited document segments."""

import logging
import secrets

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.enums import SegmentStatus, SummaryStatus
from services.summary_index_service import SummaryIndexService

logger = logging.getLogger(__name__)

SUMMARY_REGENERATION_DELAY_SECONDS = 10 * 60
SUMMARY_REGENERATION_TOKEN_TTL_SECONDS = 60 * 60
_TOKEN_KEY_PREFIX = "segment_summary_regeneration"
_LOCK_KEY_PREFIX = "segment_summary_regeneration_lock"
_CLAIM_TOKEN_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('set', KEYS[1], ARGV[2], 'KEEPTTL')
  return 1
end
return 0
"""
_COMPARE_AND_DELETE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


def _token_key(segment_id: str) -> str:
    return f"{_TOKEN_KEY_PREFIX}:{segment_id}"


def _lock_key(segment_id: str) -> str:
    return f"{_LOCK_KEY_PREFIX}:{segment_id}"


def _token_is_current(segment_id: str, token: str) -> bool:
    current_token = redis_client.get(_token_key(segment_id))
    if isinstance(current_token, bytes):
        current_token = current_token.decode()
    return current_token == token


def _claim_token(segment_id: str, token: str, execution_token: str) -> bool:
    return bool(
        redis_client.eval(
            _CLAIM_TOKEN_SCRIPT,
            1,
            _token_key(segment_id),
            token,
            execution_token,
        )
    )


def _clear_token_if_current(segment_id: str, token: str) -> None:
    redis_client.eval(_COMPARE_AND_DELETE_SCRIPT, 1, _token_key(segment_id), token)


def cancel_segment_summary_regeneration(segment_id: str) -> None:
    """Cancel any pending automatic summary regeneration for a segment."""
    try:
        with redis_client.lock(_lock_key(segment_id), timeout=300, blocking_timeout=30):
            redis_client.delete(_token_key(segment_id))
    except Exception:
        logger.exception("Failed to cancel summary regeneration for segment %s", segment_id)


def schedule_segment_summary_regeneration(
    segment: DocumentSegment,
    dataset: Dataset,
    summary_record: DocumentSegmentSummary,
    *,
    session: Session,
) -> str | None:
    """Schedule regeneration 10 minutes after the latest segment edit."""
    token = secrets.token_urlsafe(24)
    try:
        with redis_client.lock(_lock_key(segment.id), timeout=300, blocking_timeout=30):
            summary_record.status = SummaryStatus.NOT_STARTED
            summary_record.error = None
            session.add(summary_record)
            session.commit()

            redis_client.setex(
                _token_key(segment.id),
                SUMMARY_REGENERATION_TOKEN_TTL_SECONDS,
                token,
            )
        regenerate_segment_summary_task.apply_async(
            kwargs={
                "dataset_id": dataset.id,
                "document_id": segment.document_id,
                "segment_id": segment.id,
                "expected_index_node_hash": segment.index_node_hash,
                "token": token,
            },
            countdown=SUMMARY_REGENERATION_DELAY_SECONDS,
        )
    except Exception as exc:
        session.rollback()
        try:
            _clear_token_if_current(segment.id, token)
        except Exception:
            logger.exception("Failed to clear summary regeneration token for segment %s", segment.id)

        summary_record.status = SummaryStatus.ERROR
        summary_record.error = f"Failed to schedule summary regeneration: {exc}"
        session.add(summary_record)
        session.commit()
        logger.exception("Failed to schedule summary regeneration for segment %s", segment.id)
        return None

    logger.info(
        "Scheduled summary regeneration for segment %s in %s seconds",
        segment.id,
        SUMMARY_REGENERATION_DELAY_SECONDS,
    )
    return token


def _mark_summary_error_if_current(segment_id: str, dataset_id: str, token: str, error: str) -> None:
    if not _token_is_current(segment_id, token):
        return

    with session_factory.create_session() as session:
        summary_record = session.scalar(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.chunk_id == segment_id,
                DocumentSegmentSummary.dataset_id == dataset_id,
            )
            .limit(1)
        )
        if summary_record and _token_is_current(segment_id, token):
            summary_record.status = SummaryStatus.ERROR
            summary_record.error = error
            session.add(summary_record)
            session.commit()


@shared_task(queue="dataset_summary")
def regenerate_segment_summary_task(
    dataset_id: str,
    document_id: str,
    segment_id: str,
    expected_index_node_hash: str | None,
    token: str,
) -> None:
    """Regenerate only when this is still the latest edit for the segment."""
    execution_token = f"running:{token}"
    if not _claim_token(segment_id, token, execution_token):
        logger.info("Skipping stale summary regeneration task for segment %s", segment_id)
        return

    try:
        with session_factory.create_session() as session:
            dataset = session.get(Dataset, dataset_id)
            segment = session.get(DocumentSegment, segment_id)
            summary_record = session.scalar(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.chunk_id == segment_id,
                    DocumentSegmentSummary.dataset_id == dataset_id,
                )
                .limit(1)
            )

            can_regenerate = (
                dataset is not None
                and segment is not None
                and summary_record is not None
                and dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
                and dataset.summary_index_setting is not None
                and dataset.summary_index_setting.get("enable") is True
                and segment.document_id == document_id
                and segment.status == SegmentStatus.COMPLETED
                and segment.enabled is True
                and summary_record.enabled is True
                and segment.index_node_hash == expected_index_node_hash
                and _token_is_current(segment_id, execution_token)
            )
            if not can_regenerate:
                _clear_token_if_current(segment_id, execution_token)
                logger.info("Skipping ineligible summary regeneration for segment %s", segment_id)
                return

            summary_record.status = SummaryStatus.GENERATING
            summary_record.error = None
            session.add(summary_record)
            session.commit()

            summary_content, usage = SummaryIndexService.generate_summary_for_segment(
                segment,
                dataset,
                dataset.summary_index_setting,
                session=session,
            )

            with redis_client.lock(_lock_key(segment_id), timeout=300, blocking_timeout=30):
                session.expire_all()
                current_segment = session.get(DocumentSegment, segment_id)
                if (
                    not _token_is_current(segment_id, execution_token)
                    or current_segment is None
                    or current_segment.index_node_hash != expected_index_node_hash
                ):
                    logger.info("Discarding stale generated summary for segment %s", segment_id)
                    return

                SummaryIndexService.update_summary_for_segment(
                    current_segment,
                    dataset,
                    summary_content,
                    session=session,
                )
                _clear_token_if_current(segment_id, execution_token)
            logger.info(
                "Regenerated summary for segment %s after debounce%s",
                segment_id,
                f" using {usage.total_tokens} tokens" if usage and usage.total_tokens > 0 else "",
            )
    except Exception as exc:
        logger.exception("Failed to regenerate summary for segment %s", segment_id)
        try:
            _mark_summary_error_if_current(segment_id, dataset_id, execution_token, str(exc))
            _clear_token_if_current(segment_id, execution_token)
        except Exception:
            logger.exception("Failed to record summary regeneration error for segment %s", segment_id)
