"""Production composition for transport-neutral IM Contact synchronization."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters import IMProviderAdapter
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.shared import DeploymentScope, DirectoryScope, IMSyncRunId, TenantId, WorkspaceScope
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from repositories.human_input_v2.contact import Contact, ContactQuery, ContactType
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    WorkspaceIMChannelReader,
)
from services.human_input_v2.im_credential_codec import BoundCredentialCipher, IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

from .binding_service import ContactIMBindingService
from .coordinator import (
    BoundContactReader,
    BoundContactReaderFactory,
    IMChannelAdapterFactory,
    IMChannelReconciliationService,
)
from .service import IMChannelNotConfiguredError, IMSyncService
from .worker import IMContactSyncWorker

_CONTACT_PAGE_LIMIT = 500
_CREDENTIAL_UNAVAILABLE_MESSAGE = "IM credential configuration is unavailable"


@dataclass(frozen=True, slots=True)
class IMContactSyncApplication:
    sync_service: IMSyncService
    binding_service: ContactIMBindingService
    worker: IMContactSyncWorker


class DifyIMChannelAdapterFactory:
    """Recover one Channel's credentials using an already-selected owner cipher."""

    def __init__(
        self,
        cipher: BoundCredentialCipher,
        adapter_builder: Callable[[IMProviderCredentials], IMProviderAdapter] = build_im_provider_adapter,
    ) -> None:
        self._cipher = cipher
        self._adapter_builder = adapter_builder

    def __call__(self, channel: IMChannel) -> IMProviderAdapter:
        credentials = IMCredentialCodec(self._cipher).load(channel.provider, channel.encrypted_credentials)
        return self._adapter_builder(credentials)


class _WorkspaceContactReader:
    def __init__(self, session: Session, tenant_id: TenantId) -> None:
        self._repository = SQLAlchemyContactRepository(session)
        self._tenant_id = tenant_id
        self._contacts: tuple[Contact, ...] | None = None

    def list_contacts(self, page: int, limit: int) -> Sequence[Contact]:
        contacts = self._load()
        offset = (page - 1) * limit
        return contacts[offset : offset + limit]

    def get_contact(self, contact_id) -> Contact | None:
        return next((contact for contact in self._load() if contact.id == contact_id), None)

    def _load(self) -> tuple[Contact, ...]:
        if self._contacts is not None:
            return self._contacts
        contacts: list[Contact] = []
        for contact_type in (ContactType.WORKSPACE, ContactType.PLATFORM):
            page = 1
            while True:
                current = self._repository.list_contact(
                    self._tenant_id,
                    page,
                    _CONTACT_PAGE_LIMIT,
                    ContactQuery(contact_type=contact_type),
                )
                contacts.extend(current.items)
                if len(current.items) < _CONTACT_PAGE_LIMIT:
                    break
                page += 1
        self._contacts = tuple(contacts)
        return self._contacts


def build_im_contact_sync_application(
    *,
    session_maker: sessionmaker[Session] | None = None,
    deployment_contact_reader_factory: Callable[[Session], BoundContactReader] | None = None,
    workspace_adapter_factory: IMChannelAdapterFactory | None = None,
    deployment_adapter_factory: IMChannelAdapterFactory | None = None,
) -> IMContactSyncApplication:
    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    sync_service = IMSyncService(sessions, _resolve_channel, _dispatch)
    worker = IMContactSyncWorker(
        sync_service,
        _reconciliation_factory(
            sessions,
            deployment_contact_reader_factory,
            workspace_adapter_factory,
            deployment_adapter_factory,
        ),
    )
    return IMContactSyncApplication(
        sync_service=sync_service,
        binding_service=ContactIMBindingService(sessions, _resolve_channel),
        worker=worker,
    )


def build_im_contact_sync_worker(
    *,
    session_maker: sessionmaker[Session] | None = None,
    deployment_contact_reader_factory: Callable[[Session], BoundContactReader] | None = None,
    workspace_adapter_factory: IMChannelAdapterFactory | None = None,
    deployment_adapter_factory: IMChannelAdapterFactory | None = None,
) -> IMContactSyncWorker:
    return build_im_contact_sync_application(
        session_maker=session_maker,
        deployment_contact_reader_factory=deployment_contact_reader_factory,
        workspace_adapter_factory=workspace_adapter_factory,
        deployment_adapter_factory=deployment_adapter_factory,
    ).worker


def build_im_sync_service(*, session_maker: sessionmaker[Session] | None = None) -> IMSyncService:
    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    return IMSyncService(sessions, _resolve_channel, _dispatch)


def _resolve_channel(session: Session, owner_scope: DirectoryScope) -> IMChannel | None:
    if isinstance(owner_scope, WorkspaceScope):
        return WorkspaceIMChannelReader(session, owner_scope.id).get()
    if isinstance(owner_scope, DeploymentScope):
        return DeploymentIMChannelReader(session).get()
    raise TypeError("unsupported IM Channel owner scope")


def _reconciliation_factory(
    sessions: sessionmaker[Session],
    deployment_contacts: Callable[[Session], BoundContactReader] | None,
    workspace_adapter_factory: IMChannelAdapterFactory | None,
    deployment_adapter_factory: IMChannelAdapterFactory | None,
) -> Callable[[DirectoryScope], IMChannelReconciliationService]:
    def create(owner_scope: DirectoryScope) -> IMChannelReconciliationService:
        with sessions() as session:
            channel = _resolve_channel(session, owner_scope)
        if channel is None:
            raise IMChannelNotConfiguredError("Owner has no IM Channel")
        contact_reader_factory: BoundContactReaderFactory
        adapter_factory: IMChannelAdapterFactory
        if isinstance(owner_scope, WorkspaceScope):

            def contact_reader_factory(session: Session) -> BoundContactReader:
                return _WorkspaceContactReader(session, owner_scope.id)

            adapter_factory = workspace_adapter_factory or DifyIMChannelAdapterFactory(
                TenantBoundCredentialCipher(key_provider_manager.provider, str(owner_scope.id))
            )
        elif isinstance(owner_scope, DeploymentScope) and deployment_contacts is not None:
            contact_reader_factory = deployment_contacts
            adapter_factory = deployment_adapter_factory or _unavailable_deployment_adapter
        else:
            raise IMChannelNotConfiguredError("Deployment Contact reader is unavailable")
        return IMChannelReconciliationService(
            sessions,
            channel,
            adapter_factory,
            contact_reader_factory,
        )

    return create


def _dispatch(sync_run_id: IMSyncRunId, scope: DirectoryScope) -> None:
    from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

    if isinstance(scope, WorkspaceScope):
        payload: tuple[str, str | None] = ("workspace", str(scope.id))
    elif isinstance(scope, DeploymentScope):
        payload = ("deployment", None)
    else:
        raise TypeError("unsupported IM Channel owner scope")
    reconcile_im_contacts_task.apply_async(
        args=(str(sync_run_id), *payload),
        queue="human_input_contact_sync",
    )


def _unavailable_deployment_adapter(_channel: IMChannel) -> IMProviderAdapter:
    raise IMCredentialError(_CREDENTIAL_UNAVAILABLE_MESSAGE)


__all__ = [
    "DifyIMChannelAdapterFactory",
    "IMContactSyncApplication",
    "build_im_contact_sync_application",
    "build_im_contact_sync_worker",
    "build_im_sync_service",
]
