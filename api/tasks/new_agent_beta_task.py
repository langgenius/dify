import logging
from datetime import UTC, datetime

from celery import shared_task
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from configs import dify_config
from enums import DeploymentEdition
from models.agent import AgentConfigRevision, AgentConfigRevisionOperation
from services.billing_service import BillingService

logger = logging.getLogger(__name__)

_MAX_RETRIES = 8
_RETRY_DELAY_SECONDS = 30
_MAX_RETRY_DELAY_SECONDS = 900
NEW_AGENT_BETA_QUEUE = "new_agent_beta"


def _is_publish_in_activity_window(published_at: datetime) -> bool:
    start = dify_config.NEW_AGENT_BETA_ACTIVITY_START_AT
    end = dify_config.NEW_AGENT_BETA_ACTIVITY_END_AT
    if start is None or end is None or start.tzinfo is None or end.tzinfo is None or start >= end:
        logger.error("New Agent Beta Publish window must be a valid RFC3339 interval")
        return False
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=UTC)
    else:
        published_at = published_at.astimezone(UTC)
    return start.astimezone(UTC) <= published_at < end.astimezone(UTC)


def register_new_agent_beta_publish_after_commit(
    *, session: Session, tenant_id: str, agent_id: str, snapshot_id: str
) -> None:
    """Best-effort registration that never changes the Publish result."""
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return

    try:
        revision = session.scalar(
            select(AgentConfigRevision)
            .where(
                AgentConfigRevision.tenant_id == tenant_id,
                AgentConfigRevision.agent_id == agent_id,
                AgentConfigRevision.current_snapshot_id == snapshot_id,
                AgentConfigRevision.operation == AgentConfigRevisionOperation.PUBLISH_DRAFT,
            )
            .limit(1)
        )
        if revision is None:
            logger.error(
                "New Agent Beta publish revision was not found, tenant_id=%s, agent_id=%s, snapshot_id=%s",
                tenant_id,
                agent_id,
                snapshot_id,
            )
            return
        if not _is_publish_in_activity_window(revision.created_at):
            return
        cancelled = False

        def cancel_on_rollback(_session: Session) -> None:
            nonlocal cancelled
            cancelled = True

        def dispatch_after_commit(_session: Session) -> None:
            if not cancelled:
                schedule_new_agent_beta_ensure(revision.id)

        event.listen(session, "after_rollback", cancel_on_rollback, once=True)
        event.listen(session, "after_commit", dispatch_after_commit, once=True)
    except Exception:
        logger.exception(
            "Failed to register New Agent Beta publish event, tenant_id=%s, agent_id=%s, snapshot_id=%s",
            tenant_id,
            agent_id,
            snapshot_id,
        )


@shared_task(
    queue=NEW_AGENT_BETA_QUEUE,
    bind=True,
    max_retries=_MAX_RETRIES,
    default_retry_delay=_RETRY_DELAY_SECONDS,
    acks_late=True,
    reject_on_worker_lost=True,
)
def ensure_new_agent_beta_participation_task(self, revision_id: str) -> None:
    try:
        BillingService.ensure_new_agent_beta_revision(revision_id)
    except Exception as exc:
        if self.request.retries >= _MAX_RETRIES:
            logger.exception("New Agent Beta eligibility retry budget exhausted, revision_id=%s", revision_id)
            raise

        logger.warning(
            "New Agent Beta eligibility request failed, scheduling retry %d/%d, revision_id=%s",
            self.request.retries + 1,
            _MAX_RETRIES,
            revision_id,
            exc_info=True,
        )
        countdown = min(_RETRY_DELAY_SECONDS * (2**self.request.retries), _MAX_RETRY_DELAY_SECONDS)
        raise self.retry(exc=exc, countdown=countdown)


def schedule_new_agent_beta_ensure(revision_id: str) -> None:
    try:
        ensure_new_agent_beta_participation_task.delay(revision_id)
    except Exception:
        logger.exception("Failed to dispatch New Agent Beta eligibility task, revision_id=%s", revision_id)
