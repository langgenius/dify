"""Debounced summary regeneration for manually edited document segments."""

import logging
import secrets
from collections.abc import Callable

from celery import shared_task
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import SegmentStatus, SummaryStatus
from services.knowledge.resource_scope import DatasetRef, SegmentRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter

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
    return bool(redis_client.eval(_CLAIM_TOKEN_SCRIPT, 1, _token_key(segment_id), token, execution_token))


def _clear_token_if_current(segment_id: str, token: str) -> None:
    redis_client.eval(_COMPARE_AND_DELETE_SCRIPT, 1, _token_key(segment_id), token)


def cancel_segment_summary_regeneration(segment_id: str) -> None:
    """Cancel pending work before publishing a manual summary."""
    with redis_client.lock(_lock_key(segment_id), timeout=300, blocking_timeout=30):
        redis_client.delete(_token_key(segment_id))


def _summary_query(ref: SegmentRef) -> Select[tuple[DocumentSegmentSummary]]:
    return select(DocumentSegmentSummary).where(
        DocumentSegmentSummary.chunk_id == ref.segment_id,
        DocumentSegmentSummary.dataset_id == ref.document.dataset.dataset_id,
        DocumentSegmentSummary.document_id == ref.document.document_id,
    )


def _segment_query(ref: SegmentRef) -> Select[tuple[DocumentSegment]]:
    return select(DocumentSegment).where(
        DocumentSegment.id == ref.segment_id,
        DocumentSegment.tenant_id == ref.document.dataset.tenant_id,
        DocumentSegment.dataset_id == ref.document.dataset.dataset_id,
        DocumentSegment.document_id == ref.document.document_id,
    )


def schedule_segment_summary_regeneration(
    segment_ref: SegmentRef,
    expected_index_node_hash: str | None,
    *,
    new_session: Callable[[], Session],
) -> str | None:
    """Schedule a scoped segment using bounded persistence, never the request session."""
    token = secrets.token_urlsafe(24)
    segment_id = segment_ref.segment_id
    try:
        with redis_client.lock(_lock_key(segment_id), timeout=300, blocking_timeout=30):
            # Validate the version before replacing a newer edit's token.
            with new_session() as session, session.begin():
                segment = session.scalar(_segment_query(segment_ref))
                summary = session.scalar(_summary_query(segment_ref))
                if segment is None or summary is None or segment.index_node_hash != expected_index_node_hash:
                    return None
            redis_client.setex(_token_key(segment_id), SUMMARY_REGENERATION_TOKEN_TTL_SECONDS, token)
            with new_session() as session, session.begin():
                summary = session.scalar(_summary_query(segment_ref))
                if summary is not None:
                    summary.status = SummaryStatus.NOT_STARTED
                    summary.error = None
        regenerate_segment_summary_task.apply_async(
            kwargs={
                "tenant_id": segment_ref.document.dataset.tenant_id,
                "dataset_id": segment_ref.document.dataset.dataset_id,
                "document_id": segment_ref.document.document_id,
                "segment_id": segment_id,
                "expected_index_node_hash": expected_index_node_hash,
                "token": token,
            },
            countdown=SUMMARY_REGENERATION_DELAY_SECONDS,
        )
    except Exception as exc:
        logger.exception("Failed to schedule summary regeneration for segment %s", segment_id)
        _record_failure(segment_ref, token, f"Failed to schedule summary regeneration: {exc}", new_session=new_session)
        return None
    logger.info(
        "Scheduled summary regeneration for segment %s in %s seconds", segment_id, SUMMARY_REGENERATION_DELAY_SECONDS
    )
    return token


def _record_failure(ref: SegmentRef, token: str, error: str, *, new_session: Callable[[], Session]) -> None:
    """Only the current task may mark an error, never a subsequent manual edit."""
    try:
        with redis_client.lock(_lock_key(ref.segment_id), timeout=300, blocking_timeout=30):
            if not _token_is_current(ref.segment_id, token):
                return
            with new_session() as session, session.begin():
                if session.scalar(_segment_query(ref)) is not None:
                    summary = session.scalar(_summary_query(ref))
                    if summary is not None:
                        summary.status = SummaryStatus.ERROR
                        summary.error = error
            _clear_token_if_current(ref.segment_id, token)
    except Exception:
        logger.exception("Failed to record summary regeneration error for segment %s", ref.segment_id)


def _load_eligible_inputs(
    session: Session, ref: SegmentRef, expected_hash: str | None
) -> tuple[Dataset, DocumentSegment, DocumentSegmentSummary, SummaryIndexSettingDict] | None:
    dataset = session.get(Dataset, ref.document.dataset.dataset_id)
    document = session.get(Document, ref.document.document_id)
    segment = session.scalar(_segment_query(ref))
    summary = session.scalar(_summary_query(ref))
    if (
        dataset is None
        or document is None
        or segment is None
        or summary is None
        or dataset.tenant_id != ref.document.dataset.tenant_id
        or document.tenant_id != ref.document.dataset.tenant_id
        or document.dataset_id != dataset.id
        or document.doc_form == "qa_model"
        or dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY
        or not dataset.summary_index_setting
        or dataset.summary_index_setting.get("enable") is not True
        or segment.status != SegmentStatus.COMPLETED
        or not segment.enabled
        or not summary.enabled
        or segment.index_node_hash != expected_hash
    ):
        return None
    return dataset, segment, summary, dataset.summary_index_setting


@shared_task(queue="dataset_summary")
def regenerate_segment_summary_task(
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str,
    expected_index_node_hash: str | None,
    token: str,
) -> None:
    """Claim the latest edit once, then recheck ownership and version before publishing."""
    execution_token = f"running:{token}"
    if not _claim_token(segment_id, token, execution_token):
        logger.info("Skipping stale summary regeneration task for segment %s", segment_id)
        return
    ref = DatasetRef(tenant_id, dataset_id).document(document_id).segment(segment_id)
    try:
        with session_factory.create_session() as session:
            with redis_client.lock(_lock_key(segment_id), timeout=300, blocking_timeout=30):
                if not _token_is_current(segment_id, execution_token):
                    return
                inputs = _load_eligible_inputs(session, ref, expected_index_node_hash)
                if inputs is None:
                    session.rollback()
                    _clear_token_if_current(segment_id, execution_token)
                    return
                dataset, segment, summary, setting = inputs
                summary.status = SummaryStatus.GENERATING
                summary.error = None
                session.commit()
            summary_content, usage = SummaryIndexAdapter.generate_summary_for_segment(
                segment, dataset, setting, session=session
            )
            if not summary_content.strip():
                raise ValueError("Generated summary is empty")
            with redis_client.lock(_lock_key(segment_id), timeout=300, blocking_timeout=30):
                if not _token_is_current(segment_id, execution_token):
                    return
                session.expire_all()
                inputs = _load_eligible_inputs(session, ref, expected_index_node_hash)
                if inputs is None:
                    session.rollback()
                    _clear_token_if_current(segment_id, execution_token)
                    return
                dataset, segment, _, current_setting = inputs
                if current_setting != setting:
                    session.rollback()
                    _clear_token_if_current(segment_id, execution_token)
                    return
                SummaryIndexAdapter.update_summary_for_segment(segment, dataset, summary_content, session=session)
                session.commit()
                _clear_token_if_current(segment_id, execution_token)
            logger.info(
                "Regenerated summary for segment %s after debounce%s",
                segment_id,
                f" using {usage.total_tokens} tokens" if usage and usage.total_tokens > 0 else "",
            )
    except Exception as exc:
        logger.exception("Failed to regenerate summary for segment %s", segment_id)
        _record_failure(ref, execution_token, str(exc), new_session=session_factory.create_session)
