"""Collect ToolFiles that are no longer referenced by Agent config assets."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from celery import shared_task

from core.db.session_factory import session_factory
from services.agent.config_tool_file_collection_service import AgentConfigToolFileCollectionService

logger = logging.getLogger(__name__)

_COLLECTION_GRACE_SECONDS = 60
_MAX_RETRIES = 5
_RETRY_DELAY_SECONDS = 30


@shared_task(queue="retention", bind=True, max_retries=_MAX_RETRIES, default_retry_delay=_RETRY_DELAY_SECONDS)
def collect_agent_config_tool_files(self, *, tenant_id: str, candidate_ids: list[str]) -> None:
    """Delete candidate files that remain unreferenced after the mutation grace period."""

    try:
        with session_factory.create_session() as session:
            AgentConfigToolFileCollectionService.collect_unreferenced(
                tenant_id=tenant_id,
                candidate_ids=candidate_ids,
                session=session,
            )
            session.commit()
    except Exception as exc:
        logger.exception(
            "Failed to collect Agent config ToolFiles",
            extra={"tenant_id": tenant_id, "candidate_ids": candidate_ids},
        )
        countdown = min(_RETRY_DELAY_SECONDS * (2**self.request.retries), 10 * 60)
        raise self.retry(exc=exc, countdown=countdown)


def enqueue_agent_config_tool_file_collection(*, tenant_id: str, candidate_ids: Iterable[str]) -> None:
    """Enqueue a deduplicated candidate batch after its config transaction commits."""

    normalized_ids = sorted({file_id for file_id in candidate_ids if file_id})
    if not normalized_ids:
        return
    try:
        collect_agent_config_tool_files.apply_async(
            kwargs={"tenant_id": tenant_id, "candidate_ids": normalized_ids},
            countdown=_COLLECTION_GRACE_SECONDS,
        )
    except Exception:
        logger.exception(
            "Failed to enqueue Agent config ToolFile collection",
            extra={"tenant_id": tenant_id, "candidate_ids": normalized_ids},
        )
        raise


__all__ = ["collect_agent_config_tool_files", "enqueue_agent_config_tool_file_collection"]
