"""Production composition for transport-neutral IM Contact synchronization."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration import IMIntegration
from core.human_input_v2.im_integration.adapters import IMProviderAdapter
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.shared import DeploymentScope, DirectoryScope, IMSyncRunId, WorkspaceScope
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_redis import redis_client
from repositories.human_input_v2.im_integration import (
    DeploymentContactReader,
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
    SQLAlchemySessionBoundIMRepository,
    create_session_bound_reconciliation_repository,
)
from repositories.human_input_v2.organization_write_unit_of_work import OwnedOrganizationWriteLock
from services.human_input_v2.im_credential_codec import BoundCredentialCipher, IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

from .binding_service import ContactIMBindingService
from .coordinator import IMContactSyncCoordinator
from .locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from .service import IMSyncService
from .worker import IMContactSyncWorker

_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS = 5.0
_IM_WRITE_LOCK_LEASE_SECONDS = 30.0
_CREDENTIAL_UNAVAILABLE_MESSAGE = "IM credential configuration is unavailable"


@dataclass(frozen=True, slots=True)
class IMContactSyncApplication:
    """Transport-neutral application services composed over one persistence boundary."""

    sync_service: IMSyncService
    binding_service: ContactIMBindingService
    worker: IMContactSyncWorker


class DifyIMIntegrationAdapterFactory:
    """Recover one Integration's credentials and construct its Provider adapter."""

    def __init__(
        self,
        *,
        cipher_resolver: Callable[[IMIntegration], BoundCredentialCipher],
        provider_adapter_factory: Callable[[IMProviderCredentials], IMProviderAdapter] = build_im_provider_adapter,
    ) -> None:
        self._cipher_resolver = cipher_resolver
        self._provider_adapter_factory = provider_adapter_factory

    def __call__(self, integration: IMIntegration) -> IMProviderAdapter:
        cipher = self._cipher_resolver(integration)
        provider = integration.provider_tenant.provider
        credentials = IMCredentialCodec(cipher).load(provider, integration.encrypted_credentials)
        return self._provider_adapter_factory(credentials)


def _resolve_default_cipher(integration: IMIntegration) -> BoundCredentialCipher:
    if integration.tenant_id is None:
        raise IMCredentialError(_CREDENTIAL_UNAVAILABLE_MESSAGE)
    return TenantBoundCredentialCipher(key_provider_manager.provider, str(integration.tenant_id))


def build_im_contact_sync_worker(
    *,
    session_maker: sessionmaker[Session] | None = None,
    adapter_factory: Callable[[IMIntegration], IMProviderAdapter] | None = None,
    deployment_contact_reader_factory: Callable[[Session], DeploymentContactReader] | None = None,
) -> IMContactSyncWorker:
    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    write_lock_factory = _write_lock_factory()
    write_unit_of_work_factory = _write_unit_of_work_factory(
        sessions,
        write_lock_factory,
        deployment_contact_reader_factory,
    )
    repository = SQLAlchemyIMControlPlaneRepository(sessions, write_unit_of_work_factory)
    resolved_adapter_factory = adapter_factory or DifyIMIntegrationAdapterFactory(
        cipher_resolver=_resolve_default_cipher
    )
    coordinator = IMContactSyncCoordinator(
        repository,
        resolved_adapter_factory,
        sessions,
        write_lock_factory,
        _reconciliation_repository_factory(deployment_contact_reader_factory),
    )
    return IMContactSyncWorker(repository, coordinator)


def build_im_contact_sync_application(
    *,
    session_maker: sessionmaker[Session] | None = None,
    adapter_factory: Callable[[IMIntegration], IMProviderAdapter] | None = None,
    deployment_contact_reader_factory: Callable[[Session], DeploymentContactReader] | None = None,
) -> IMContactSyncApplication:
    """Compose commands, queries, and worker orchestration without transport dependencies."""

    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    write_lock_factory = _write_lock_factory()
    write_unit_of_work_factory = _write_unit_of_work_factory(
        sessions,
        write_lock_factory,
        deployment_contact_reader_factory,
    )
    repository = SQLAlchemyIMControlPlaneRepository(sessions, write_unit_of_work_factory)
    resolved_adapter_factory = adapter_factory or DifyIMIntegrationAdapterFactory(
        cipher_resolver=_resolve_default_cipher
    )
    coordinator = IMContactSyncCoordinator(
        repository,
        resolved_adapter_factory,
        sessions,
        write_lock_factory,
        _reconciliation_repository_factory(deployment_contact_reader_factory),
    )

    def dispatch(sync_run_id: IMSyncRunId, scope: DirectoryScope) -> None:
        from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

        scope_kind, tenant_id = _scope_payload(scope)
        reconcile_im_contacts_task.apply_async(
            args=(str(sync_run_id), scope_kind, tenant_id),
            queue="human_input_contact_sync",
        )

    return IMContactSyncApplication(
        sync_service=IMSyncService(repository, dispatch),
        binding_service=ContactIMBindingService(write_unit_of_work_factory),
        worker=IMContactSyncWorker(repository, coordinator),
    )


def build_im_sync_service(
    *,
    session_maker: sessionmaker[Session] | None = None,
) -> IMSyncService:
    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    write_lock_factory = _write_lock_factory()
    repository = SQLAlchemyIMControlPlaneRepository(
        sessions,
        _write_unit_of_work_factory(sessions, write_lock_factory),
    )

    def dispatch(sync_run_id: IMSyncRunId, scope: DirectoryScope) -> None:
        from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

        scope_kind, tenant_id = _scope_payload(scope)
        reconcile_im_contacts_task.apply_async(
            args=(str(sync_run_id), scope_kind, tenant_id),
            queue="human_input_contact_sync",
        )

    return IMSyncService(repository, dispatch)


def _write_unit_of_work_factory(
    sessions: sessionmaker[Session],
    write_lock_factory: Callable[[DirectoryScope], OwnedOrganizationWriteLock] | None = None,
    deployment_contact_reader_factory: Callable[[Session], DeploymentContactReader] | None = None,
) -> Callable[[DirectoryScope], SQLAlchemyOrganizationIMWriteUnitOfWork]:
    resolved_write_lock_factory = write_lock_factory or _write_lock_factory()

    def create(scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        return SQLAlchemyOrganizationIMWriteUnitOfWork(
            sessions,
            resolved_write_lock_factory(scope),
            deployment_contact_reader_factory,
        )

    return create


def _write_lock_factory() -> Callable[[DirectoryScope], OwnedOrganizationWriteLock]:
    def create(scope: DirectoryScope) -> OwnedOrganizationWriteLock:
        if isinstance(scope, WorkspaceScope):
            lock_scope = OrganizationIMWriteScope.for_workspace(scope.id)
        elif isinstance(scope, DeploymentScope):
            lock_scope = OrganizationIMWriteScope.for_deployment()
        else:
            raise TypeError("unsupported Organization write scope")
        return OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS,
            lease_seconds=_IM_WRITE_LOCK_LEASE_SECONDS,
        )

    return create


def _reconciliation_repository_factory(
    deployment_contact_reader_factory: Callable[[Session], DeploymentContactReader] | None,
) -> Callable[[Session, OwnedOrganizationWriteLock], SQLAlchemySessionBoundIMRepository]:
    def create(
        session: Session,
        write_lock: OwnedOrganizationWriteLock,
    ) -> SQLAlchemySessionBoundIMRepository:
        deployment_contacts = (
            deployment_contact_reader_factory(session) if deployment_contact_reader_factory is not None else None
        )
        return create_session_bound_reconciliation_repository(session, write_lock, deployment_contacts)

    return create


def _scope_payload(scope: DirectoryScope) -> tuple[str, str | None]:
    if isinstance(scope, WorkspaceScope):
        return "workspace", str(scope.id)
    if isinstance(scope, DeploymentScope):
        return "deployment", None
    raise TypeError("unsupported Organization write scope")


__all__ = [
    "DifyIMIntegrationAdapterFactory",
    "IMContactSyncApplication",
    "build_im_contact_sync_application",
    "build_im_contact_sync_worker",
    "build_im_sync_service",
]
