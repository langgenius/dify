"""Periodic recovery for interrupted workspace provisioning operations."""

import logging

from celery import shared_task

from core.db.session_factory import session_factory
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.workspace.gateways import WorkspaceProvisioningEffectsGateway
from services.workspace.provisioning_service import WorkspaceProvisioningRecoveryService

logger = logging.getLogger(__name__)


@shared_task(queue="schedule_executor")
def recover_workspace_provisioning_operations() -> None:
    recovered = WorkspaceProvisioningRecoveryService(
        preparations=WorkspaceRepository(session_factory=session_factory.get_session_maker()),
        effects=WorkspaceProvisioningEffectsGateway(),
    ).recover()
    if recovered:
        logger.info("Recovered %d workspace provisioning compensations", recovered)
