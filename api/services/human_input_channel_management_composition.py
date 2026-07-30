"""Request-scoped composition and trusted context for channel management."""

from __future__ import annotations

from dataclasses import dataclass, field

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
from core.human_input_v2.email_channel import ResendProviderSettings
from core.human_input_v2.shared import AccountId, NormalizedEmail, WorkspaceId
from extensions.ext_database import db
from repositories.human_input_v2.email_channel import SQLAlchemyEmailChannelRepository
from services.human_input_channel_management_service import HumanInputChannelManagementService
from services.human_input_email_channel_manager import (
    DifyEmailCredentialProtector,
    HumanInputEmailChannelManager,
)

_UNIMPLEMENTED_IM_REFS = (
    ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
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
_RESEND_CONNECTIVITY_UNIMPLEMENTED_CODE = "resend_provider_connectivity_not_implemented"


class _UnavailableResendValidator:
    """Sentinel dependency hidden behind the production Resend API stub."""

    def validate(self, settings: ResendProviderSettings) -> None:
        del settings
        raise AssertionError("Resend provider connectivity is not composed")

    def send_test(self, settings: ResendProviderSettings, recipient: NormalizedEmail) -> None:
        del settings, recipient
        raise AssertionError("Resend provider connectivity is not composed")


@dataclass(slots=True)
class ResendControlPlaneHandler:
    """Expose provider-independent Resend state while connectivity is deferred."""

    delegate: HumanInputEmailChannelManager
    ref: ChannelRef = field(default=HumanInputEmailChannelManager.ref, init=False)
    capabilities: frozenset[ChannelCapability] = field(
        default=HumanInputEmailChannelManager.capabilities,
        init=False,
    )

    def get(self, context: HumanInputChannelManagementContext) -> ChannelOperationResult:
        return self.delegate.get(context)

    def test(
        self,
        context: HumanInputChannelManagementContext,
        command: TestChannelCommand,
    ) -> ChannelOperationResult:
        del context, command
        return self._connectivity_unimplemented()

    def save(
        self,
        context: HumanInputChannelManagementContext,
        command: SaveChannelCommand,
    ) -> ChannelOperationResult:
        del context, command
        return self._connectivity_unimplemented()

    def delete(
        self,
        context: HumanInputChannelManagementContext,
        command: DeleteChannelCommand,
    ) -> ChannelOperationResult:
        return self.delegate.delete(context, command)

    @staticmethod
    def _connectivity_unimplemented() -> ChannelOperationResult:
        return ChannelOperationResult.failed(
            ChannelFailureCategory.UNSUPPORTED_OPERATION,
            _RESEND_CONNECTIVITY_UNIMPLEMENTED_CODE,
        )


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
) -> HumanInputChannelManagementService:
    """Compose provider-independent Resend operations and explicit provider stubs."""

    operation_sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    email_repository = SQLAlchemyEmailChannelRepository(operation_sessions)
    email_handler = ResendControlPlaneHandler(
        HumanInputEmailChannelManager(
            email_repository,
            _UnavailableResendValidator(),
            DifyEmailCredentialProtector(),
        )
    )
    im_handlers = tuple(UnimplementedIMChannelHandler(ref) for ref in _UNIMPLEMENTED_IM_REFS)
    return HumanInputChannelManagementService(
        ChannelHandlerRegistry((email_handler, *im_handlers)),
    )


def build_human_input_channel_management_context(
    *,
    workspace_id: str,
    actor_account_id: str,
    actor_email: str,
) -> HumanInputChannelManagementContext:
    """Build the Community and Cloud workspace context from authenticated server state."""

    return HumanInputChannelManagementContext(
        workspace_id=WorkspaceId(workspace_id),
        actor_account_id=AccountId(actor_account_id),
        actor_email=NormalizedEmail(actor_email),
    )


__all__ = [
    "ResendControlPlaneHandler",
    "UnimplementedIMChannelHandler",
    "build_human_input_channel_management_context",
    "build_human_input_channel_management_service",
]
