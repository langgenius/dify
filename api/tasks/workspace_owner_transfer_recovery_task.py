"""Periodic recovery for interrupted workspace ownership transfers."""

import logging

from celery import shared_task

from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.workspace.gateways import DeploymentWorkspaceMemberAccessGateway, WorkspaceOwnerTransferGateway
from services.workspace.member_service import (
    WorkspaceOwnerTransferNotificationService,
    WorkspaceOwnerTransferRecoveryService,
)

logger = logging.getLogger(__name__)


@shared_task(queue="schedule_executor")
def recover_workspace_owner_transfer_operations() -> None:
    workspaces = WorkspaceRepository(session_factory=session_factory.get_session_maker())
    notifications = WorkspaceOwnerTransferNotificationService(
        workspaces=workspaces,
        gateway=WorkspaceOwnerTransferGateway(redis=redis_client),
    )
    recovered = WorkspaceOwnerTransferRecoveryService(
        workspaces=workspaces,
        access=DeploymentWorkspaceMemberAccessGateway(),
        notifications=notifications,
    ).recover()
    if recovered:
        logger.info("Recovered %d workspace ownership transfers", recovered)
