"""Classify a completed Agent knowledge investigation outside the Agent hot path."""

import logging

from celery import Task, shared_task
from dify_agent.protocol.knowledge_fs import KnowledgeFsError
from dify_agent.protocol.knowledge_investigation import KnowledgeInvestigationPayload
from pydantic import ValidationError

from extensions.ext_application_services import application_services
from services.agent.config_assets_store import AgentConfigTargetError
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionError
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from services.knowledge_fs_capability import KnowledgeFSCapabilityPolicyError

logger = logging.getLogger(__name__)


@shared_task(queue="dataset", bind=True, max_retries=3, default_retry_delay=30)
def capture_agent_knowledge_investigation_task(self: Task, *, report: dict[str, object], control_space_id: str) -> None:
    """Reconstruct authorization on every attempt; report IDs survive queue redelivery."""
    context = {"control_space_id": control_space_id, "investigation_id": str(report.get("investigation_id", ""))[:36]}
    try:
        payload = KnowledgeInvestigationPayload.model_validate(report)
        application_services().agent_apps.knowledge.capture_investigation(payload, control_space_id)
    except (
        KnowledgeFsError,
        AgentConfigTargetError,
        KnowledgeFSAppAdmissionError,
        KnowledgeFSCapabilityPolicyError,
        ValidationError,
        PermissionError,
    ):
        logger.warning("Agent knowledge investigation rejected", extra=context)
    except KnowledgeFSProductRequestRejectedError as exc:
        if exc.status_code not in {429, 503}:
            logger.warning("Agent knowledge investigation rejected", extra=context)
            return
        logger.warning("Agent knowledge investigation retry scheduled", extra=context)
        raise self.retry(exc=exc, countdown=30 * (2**self.request.retries)) from exc
    except Exception as exc:
        logger.warning("Agent knowledge investigation retry scheduled", extra=context)
        raise self.retry(exc=exc, countdown=30 * (2**self.request.retries)) from exc
