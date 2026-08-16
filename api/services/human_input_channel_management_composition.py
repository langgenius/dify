"""Request-scoped composition and trusted context for channel management."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelFailureCategory,
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    DeleteChannelCommand,
    HumanInputChannelManagementContext,
)
from core.human_input_v2.channel_management.commands import SaveChannelCommand, TestChannelCommand
from core.human_input_v2.email_channel import EmailProviderValidator
from core.human_input_v2.shared import (
    AccountId,
    DeploymentScope,
    DirectoryScope,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from repositories.human_input_v2.email_channel import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_integration import (
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
)
from services.human_input_channel_management_service import HumanInputChannelManagementService
from services.human_input_email_channel_manager import (
    DifyEmailCredentialProtector,
    HumanInputEmailChannelManager,
)
from services.human_input_im_channel_manager import HumanInputIMChannelManager
from services.human_input_resend_channel import ResendEmailProviderValidator
from services.human_input_slack_channel import SlackIMCredentialProtector, SlackIMProviderConfigurationPort
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope

_UNIMPLEMENTED_IM_REFS = (
    ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU),
    ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK),
)
_UNIMPLEMENTED_IM_CAPABILITIES = frozenset(
    (
        ChannelCapability.CONFIGURE,
        ChannelCapability.TEST,
        ChannelCapability.DELETE,
    )
)
_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS = 5.0
_IM_WRITE_LOCK_LEASE_SECONDS = 30.0


@dataclass(slots=True)
class UnimplementedIMChannelHandler:
    """Explicit placeholder until one IM provider is implemented end to end."""

    ref: ChannelRef
    capabilities: frozenset[ChannelCapability] = _UNIMPLEMENTED_IM_CAPABILITIES

    def get(self, context: HumanInputChannelManagementContext) -> ChannelOperationResult:
        del context
        return self._unimplemented()

    def test(
        self,
        context: HumanInputChannelManagementContext,
        command: TestChannelCommand,
    ) -> ChannelOperationResult:
        del context, command
        return self._unimplemented()

    def save(
        self,
        context: HumanInputChannelManagementContext,
        command: SaveChannelCommand,
    ) -> ChannelOperationResult:
        del context, command
        return self._unimplemented()

    def delete(
        self,
        context: HumanInputChannelManagementContext,
        command: DeleteChannelCommand,
    ) -> ChannelOperationResult:
        del context, command
        return self._unimplemented()

    @staticmethod
    def _unimplemented() -> ChannelOperationResult:
        return ChannelOperationResult.failed(
            ChannelFailureCategory.UNSUPPORTED_OPERATION,
            "im_channel_management_not_implemented",
        )


def build_human_input_channel_management_service(
    *,
    session_maker: sessionmaker[Session] | None = None,
    email_validator: EmailProviderValidator | None = None,
) -> HumanInputChannelManagementService:
    """Compose functional Resend and Slack management with remaining IM stubs."""

    operation_sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    email_repository = SQLAlchemyEmailChannelRepository(operation_sessions)
    email_handler = HumanInputEmailChannelManager(
        email_repository,
        email_validator or ResendEmailProviderValidator(),
        DifyEmailCredentialProtector(),
    )

    def create_im_write_unit_of_work(scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        if isinstance(scope, WorkspaceScope):
            lock_scope = OrganizationIMWriteScope.for_workspace(scope.id)
        elif isinstance(scope, DeploymentScope):
            lock_scope = OrganizationIMWriteScope.for_deployment()
        else:
            raise TypeError("unsupported Organization write scope")
        write_lock = OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS,
            lease_seconds=_IM_WRITE_LOCK_LEASE_SECONDS,
        )
        return SQLAlchemyOrganizationIMWriteUnitOfWork(operation_sessions, write_lock)

    im_repository = SQLAlchemyIMControlPlaneRepository(operation_sessions, create_im_write_unit_of_work)
    slack_handler = HumanInputIMChannelManager(
        ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
        im_repository,
        SlackIMProviderConfigurationPort(SlackIMCredentialProtector()),
    )
    im_handlers = tuple(UnimplementedIMChannelHandler(ref) for ref in _UNIMPLEMENTED_IM_REFS)
    return HumanInputChannelManagementService(
        ChannelHandlerRegistry((email_handler, slack_handler, *im_handlers)),
    )


def build_human_input_channel_management_context(
    *,
    workspace_id: str,
    actor_account_id: str,
    actor_email: str,
) -> HumanInputChannelManagementContext:
    """Build the Community and Cloud workspace context from authenticated server state."""

    return HumanInputChannelManagementContext(
        tenant_id=TenantId(workspace_id),
        actor_account_id=AccountId(actor_account_id),
        actor_email=NormalizedEmail(actor_email),
    )


__all__ = [
    "UnimplementedIMChannelHandler",
    "build_human_input_channel_management_context",
    "build_human_input_channel_management_service",
]
