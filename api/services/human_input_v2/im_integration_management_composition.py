"""Production composition for Human Input IM Integration management."""

from collections.abc import Callable

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.shared import DeploymentScope, DirectoryScope, WorkspaceScope
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_redis import redis_client
from repositories.human_input_v2.im_integration import (
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
)
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from services.human_input_v2.im_integration_management_service import HumanInputIMIntegrationManagementService
from services.human_input_v2.im_provider_configuration_service import DifyIMProviderConfigurationService

_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS = 5.0
_IM_WRITE_LOCK_LEASE_SECONDS = 30.0


def build_human_input_im_integration_management_service() -> HumanInputIMIntegrationManagementService:
    operation_sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)
    repository = SQLAlchemyIMControlPlaneRepository(
        operation_sessions,
        _build_im_write_unit_of_work_factory(operation_sessions),
    )
    return HumanInputIMIntegrationManagementService(
        repository,
        DifyIMProviderConfigurationService(key_provider=key_provider_manager.provider),
    )


def _build_im_write_unit_of_work_factory(
    operation_sessions: sessionmaker[Session],
) -> Callable[[DirectoryScope], SQLAlchemyOrganizationIMWriteUnitOfWork]:
    def create(scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        if isinstance(scope, WorkspaceScope):
            lock_scope = OrganizationIMWriteScope.for_workspace(scope.id)
        elif isinstance(scope, DeploymentScope):
            lock_scope = OrganizationIMWriteScope.for_deployment()
        else:
            raise TypeError("unsupported Directory scope")
        write_lock = OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS,
            lease_seconds=_IM_WRITE_LOCK_LEASE_SECONDS,
        )
        return SQLAlchemyOrganizationIMWriteUnitOfWork(operation_sessions, write_lock)

    return create


__all__ = ["build_human_input_im_integration_management_service"]
