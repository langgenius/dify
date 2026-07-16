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

logger = logging.getLogger(__name__)


def _create_agent_backend_client():
    if not (dify_config.AGENT_BACKEND_USE_FAKE or dify_config.AGENT_BACKEND_BASE_URL):
        return None
    return create_agent_backend_run_client(
        base_url=dify_config.AGENT_BACKEND_BASE_URL,
        use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
        fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
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
