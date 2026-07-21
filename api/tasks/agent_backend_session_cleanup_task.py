"""Celery tasks that execute Agent backend lifecycle-only session cleanup."""

from __future__ import annotations

import logging

from celery import shared_task

from clients.agent_backend.factory import create_agent_backend_run_client
from clients.agent_backend.request_builder import AgentBackendRunRequestBuilder
from clients.agent_backend.session_cleanup import (
    AgentBackendSessionCleanupPayload,
    cleanup_agent_backend_session,
)
from configs import dify_config
from core.db.session_factory import session_factory
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.retirement_service import WorkflowAgentRetirementService

logger = logging.getLogger(__name__)


@shared_task(queue="workflow_storage")
def cleanup_agent_home_snapshots(*, tenant_id: str, agent_id: str) -> None:
    """Delete every physical Home in the immutable Agent-owned ledger."""
    with session_factory.create_session() as session:
        AgentHomeSnapshotService.delete_all_for_agent(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent_id,
        )


@shared_task(queue="workflow_storage")
def retire_workflow_agents_if_unowned(
    *,
    tenant_id: str,
    agent_ids: list[str],
    account_id: str | None,
) -> None:
    """Archive unowned workflow-only Agents, then retire their physical Homes."""
    with session_factory.create_session() as session:
        cleanup_candidate_ids = WorkflowAgentRetirementService.archive_unowned(
            session=session,
            tenant_id=tenant_id,
            agent_ids=agent_ids,
            account_id=account_id,
        )
        session.commit()
    for agent_id in cleanup_candidate_ids:
        cleanup_agent_home_snapshots.delay(tenant_id=tenant_id, agent_id=agent_id)


def _create_agent_backend_client():
    if not (dify_config.AGENT_BACKEND_USE_FAKE or dify_config.AGENT_BACKEND_BASE_URL):
        return None
    return create_agent_backend_run_client(
        base_url=dify_config.AGENT_BACKEND_BASE_URL,
        use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
        fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
        stream_read_timeout_seconds=dify_config.AGENT_BACKEND_STREAM_READ_TIMEOUT_SECONDS,
        stream_max_reconnects=dify_config.AGENT_BACKEND_STREAM_MAX_RECONNECTS,
        stream_run_timeout_seconds=dify_config.AGENT_BACKEND_RUN_TIMEOUT_SECONDS,
    )


def _run_cleanup_task(payload_dict: dict[str, object]) -> None:
    payload = AgentBackendSessionCleanupPayload.model_validate(payload_dict)
    result = cleanup_agent_backend_session(
        payload=payload,
        client=_create_agent_backend_client(),
        request_builder=AgentBackendRunRequestBuilder(),
    )
    if result.status == "succeeded":
        return

    log_fields = {
        "tenant_id": payload.metadata.get("tenant_id"),
        "app_id": payload.metadata.get("app_id"),
        "workflow_run_id": payload.metadata.get("workflow_run_id"),
        "node_id": payload.metadata.get("node_id"),
        "conversation_id": payload.metadata.get("conversation_id"),
        "agent_id": payload.metadata.get("agent_id"),
        "previous_agent_backend_run_id": payload.metadata.get("previous_agent_backend_run_id"),
        "failed_agent_backend_run_id": payload.metadata.get("failed_agent_backend_run_id"),
        "cleanup_run_id": result.cleanup_run_id,
        "reason": result.reason,
    }
    if result.status == "skipped":
        logger.info("Agent backend session cleanup skipped: %s", log_fields)
        return

    logger.warning("Agent backend session cleanup failed: %s", log_fields)


@shared_task(queue="workflow_storage")
def cleanup_workflow_agent_runtime_session(payload_dict: dict[str, object]) -> None:
    """Run one workflow-owned Agent backend cleanup payload."""
    _run_cleanup_task(payload_dict)


@shared_task(queue="conversation")
def cleanup_conversation_agent_runtime_session(payload_dict: dict[str, object]) -> None:
    """Run one conversation-owned Agent backend cleanup payload."""
    _run_cleanup_task(payload_dict)
