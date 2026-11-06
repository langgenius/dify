"""Guest migration with one transaction per authenticated App identity."""

from itertools import batched

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.app.public_runtime import published_app_filter
from graphon.enums import WorkflowExecutionStatus
from models.account import Account, AccountStatus
from models.end_user_connection import EndUserConnection
from models.enums import (
    AppStatus,
    ConversationFromSource,
    CreatorUserRole,
    EndUserType,
    FeedbackFromSource,
    InvokeFrom,
)
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message, MessageFeedback, Site, UploadFile
from models.tools import ToolFile
from models.web import PinnedConversation, SavedMessage
from models.workflow import WorkflowRun
from repositories.end_user_connection_repository import EndUserConnectionRepository
from repositories.end_user_execution_lock import lock_end_user, translate_end_user_lock_errors
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionIdentityError
from services.web_migration_service import GuestMigrationNotReadyError, GuestMigrationSource, MigrationCounts

_MIGRATION_APP_MODES = (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT, AppMode.CHAT)


def supports_chatbot_migration(session: Session, *, guest: WebConnectionContext, config_id: str | None) -> bool:
    """Admit only ordinary Chatbot configurations and ordinary Guest chat history.

    Legacy agent configurations can be stored as CHAT until first use. Their tool
    writers do not implement snapshot migration, so they remain unsupported.
    This read performs no mode normalization or other mutation.
    """
    config = session.scalar(
        sa.select(AppModelConfig).where(AppModelConfig.id == config_id, AppModelConfig.app_id == guest.app_id)
    )
    return (
        config is not None
        and not config.agent_mode_dict.get("enabled", False)
        and not session.scalar(
            sa.select(sa.exists().where(*guest_history_roots(guest), Conversation.mode != AppMode.CHAT))
        )
    )


def guest_history_roots(guest: WebConnectionContext) -> tuple[sa.ColumnElement[bool], ...]:
    return (
        Conversation.app_id == guest.app_id,
        Conversation.from_source == ConversationFromSource.API,
        Conversation.from_end_user_id == guest.end_user_id,
        Conversation.from_account_id.is_(None),
        Conversation.is_deleted.is_(False),
        sa.or_(Conversation.invoke_from == InvokeFrom.WEB_APP, Conversation.invoke_from.is_(None)),
    )


def guest_chat_conversations(guest: WebConnectionContext) -> tuple[sa.ColumnElement[bool], ...]:
    return (
        *guest_history_roots(guest),
        Conversation.mode.in_((AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT)),
    )


def unfinished_guest_runs(guest: WebConnectionContext) -> tuple[sa.ColumnElement[bool], ...]:
    return (
        WorkflowRun.tenant_id == guest.tenant_id,
        WorkflowRun.app_id == guest.app_id,
        WorkflowRun.created_by_role == CreatorUserRole.END_USER,
        WorkflowRun.created_by == guest.end_user_id,
        WorkflowRun.status.not_in(
            (
                WorkflowExecutionStatus.SUCCEEDED,
                WorkflowExecutionStatus.FAILED,
                WorkflowExecutionStatus.STOPPED,
                WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            )
        ),
    )


class WebMigrationRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def get_claim_source(self, *, app_code: str, app_id: str, end_user_id: str) -> GuestMigrationSource | None:
        """Return current published Guest scope and advisory counts without mutation.

        Missing identities and unsupported execution configurations return None.
        Transfer rechecks these facts under its exclusive identity fence.
        """
        with self._sessions() as session:
            identity = session.execute(
                sa.select(App.tenant_id, App.name, App.mode, App.app_model_config_id)
                .join(Site, Site.app_id == App.id)
                .join(EndUser, sa.and_(EndUser.app_id == App.id, EndUser.tenant_id == App.tenant_id))
                .where(
                    App.id == app_id,
                    App.mode.in_(_MIGRATION_APP_MODES),
                    App.status == AppStatus.NORMAL,
                    App.enable_site.is_(True),
                    published_app_filter(),
                    Site.code == app_code,
                    Site.status == AppStatus.NORMAL,
                    EndUser.id == end_user_id,
                    EndUser.type == EndUserType.BROWSER,
                    EndUser.account_id.is_(None),
                )
                .limit(1)
            ).one_or_none()
            if identity is None:
                return None
            guest = WebConnectionContext(identity.tenant_id, app_id, end_user_id, None)
            if identity.mode == AppMode.CHAT and not supports_chatbot_migration(
                session, guest=guest, config_id=identity.app_model_config_id
            ):
                return None
            connections = session.scalar(
                sa.select(sa.func.count())
                .select_from(EndUserConnection)
                .where(
                    EndUserConnection.tenant_id == guest.tenant_id,
                    EndUserConnection.end_user_id == guest.end_user_id,
                    EndUserConnection.account_id.is_(None),
                )
            )
            conversations = session.scalar(
                sa.select(sa.func.count()).select_from(Conversation).where(*guest_chat_conversations(guest))
            )
            return GuestMigrationSource(
                guest, app_code, identity.name, connections or 0, conversations or 0, AppMode(identity.mode)
            )

    def active_task_ids(self, source: GuestMigrationSource) -> tuple[str | None, ...]:
        guest = source.context
        with self._sessions() as session:
            return tuple(
                session.scalars(
                    sa.select(WorkflowRun.task_id).where(*unfinished_guest_runs(guest)).order_by(WorkflowRun.id)
                )
            )

    @translate_end_user_lock_errors()
    def claim_guest(self, source: GuestMigrationSource, *, account_end_user_id: str) -> MigrationCounts:
        """Atomically transfer eligible resources between validated App identities.

        Workflow/Chatflow must be quiescent; Chatbot transfers committed history
        while excluding original-actor writes with the exclusive identity fence.
        Return moved counts on commit; failures roll back all ownership changes.
        """
        guest = source.context
        if guest.account_id is not None:
            raise ConnectionIdentityError()
        with self._sessions.begin() as session:
            original = lock_end_user(
                session,
                tenant_id=guest.tenant_id,
                app_id=guest.app_id,
                end_user_id=guest.end_user_id,
                exclusive=True,
            )
            if original is None or original.type != EndUserType.BROWSER or original.account_id is not None:
                raise ConnectionIdentityError()
            app = session.scalar(
                sa.select(App).where(
                    App.id == guest.app_id,
                    App.mode.in_(_MIGRATION_APP_MODES),
                    App.tenant_id == guest.tenant_id,
                    App.status == AppStatus.NORMAL,
                    App.enable_site.is_(True),
                    published_app_filter(),
                )
            )
            if (
                app is None
                or (
                    app.mode == AppMode.CHAT
                    and not supports_chatbot_migration(session, guest=guest, config_id=app.app_model_config_id)
                )
                or session.scalar(
                    sa.select(Site.id).where(
                        Site.app_id == app.id, Site.code == source.app_code, Site.status == AppStatus.NORMAL
                    )
                )
                is None
            ):
                raise ConnectionIdentityError()
            target = session.scalar(
                sa.select(EndUser).where(
                    EndUser.id == account_end_user_id,
                    EndUser.tenant_id == guest.tenant_id,
                    EndUser.app_id == app.id,
                    EndUser.type == EndUserType.BROWSER,
                    EndUser.account_id.is_not(None),
                )
            )
            if target is None or target.account_id is None:
                raise ConnectionIdentityError()
            if (
                session.scalar(
                    sa.select(Account.id).where(
                        Account.id == target.account_id,
                        Account.status.in_((AccountStatus.ACTIVE, AccountStatus.UNINITIALIZED)),
                    )
                )
                is None
            ):
                raise ConnectionIdentityError()
            account = WebConnectionContext(guest.tenant_id, app.id, target.id, target.account_id)
            # Startup registers its Run before releasing the shared identity lock.
            # With the exclusive lock held, this check closes the readiness-to-transfer gap.
            if app.mode != AppMode.CHAT and session.scalar(sa.select(sa.exists().where(*unfinished_guest_runs(guest)))):
                raise GuestMigrationNotReadyError()
            eligible = tuple(
                session.scalars(sa.select(Conversation.id).where(*guest_history_roots(guest)).order_by(Conversation.id))
            )
            chat_count = 0
            connections = EndUserConnectionRepository.transfer_guest_connections(session, guest, account)
            # Resolve IDs first and update by primary key. InnoDB otherwise scans
            # and locks unrelated file rows while active producers are still running.
            uploads = session.scalars(
                sa.select(UploadFile.id).where(
                    UploadFile.tenant_id == guest.tenant_id,
                    UploadFile.created_by_role == CreatorUserRole.END_USER,
                    UploadFile.created_by == guest.end_user_id,
                )
            ).all()
            for file_chunk in batched(uploads, 500, strict=False):
                session.execute(
                    sa.update(UploadFile)
                    .where(
                        UploadFile.id.in_(file_chunk),
                        UploadFile.tenant_id == guest.tenant_id,
                        UploadFile.created_by_role == CreatorUserRole.END_USER,
                        UploadFile.created_by == guest.end_user_id,
                    )
                    .values(created_by=target.id)
                    .execution_options(synchronize_session=False)
                )
            tools = session.scalars(
                sa.select(ToolFile.id).where(
                    ToolFile.tenant_id == guest.tenant_id,
                    ToolFile.user_id == guest.end_user_id,
                )
            ).all()
            for file_chunk in batched(tools, 500, strict=False):
                session.execute(
                    sa.update(ToolFile)
                    .where(
                        ToolFile.id.in_(file_chunk),
                        ToolFile.tenant_id == guest.tenant_id,
                        ToolFile.user_id == guest.end_user_id,
                    )
                    .values(user_id=target.id)
                    .execution_options(synchronize_session=False)
                )
            for chunk in batched(eligible, 500, strict=False):
                locked = session.execute(
                    sa.select(Conversation.id, Conversation.mode)
                    .where(*guest_history_roots(guest), Conversation.id.in_(chunk))
                    .order_by(Conversation.id)
                    .with_for_update(of=Conversation)
                ).all()
                locked_ids = tuple(row.id for row in locked)
                if not locked_ids:
                    continue
                chat_count += sum(
                    row.mode in (AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT) for row in locked
                )
                conversation_ids = sa.select(Conversation.id).where(
                    *guest_history_roots(guest), Conversation.id.in_(locked_ids)
                )
                message_ids = sa.select(Message.id).where(
                    Message.app_id == app.id, Message.conversation_id.in_(conversation_ids)
                )
                for model, reference in (
                    (PinnedConversation, PinnedConversation.conversation_id),
                    (SavedMessage, SavedMessage.message_id),
                ):
                    session.execute(
                        sa.update(model)
                        .where(
                            model.app_id == app.id,
                            model.created_by_role == CreatorUserRole.END_USER,
                            model.created_by == guest.end_user_id,
                            reference.in_(conversation_ids if model is PinnedConversation else message_ids),
                        )
                        .values(created_by=target.id)
                        .execution_options(synchronize_session=False)
                    )
                session.execute(
                    sa.update(MessageFeedback)
                    .where(
                        MessageFeedback.app_id == app.id,
                        MessageFeedback.message_id.in_(message_ids),
                        MessageFeedback.from_end_user_id == guest.end_user_id,
                        MessageFeedback.from_source == FeedbackFromSource.USER,
                        MessageFeedback.from_account_id.is_(None),
                    )
                    .values(from_end_user_id=target.id)
                    .execution_options(synchronize_session=False)
                )
                session.execute(
                    sa.update(Conversation)
                    .where(*guest_history_roots(guest), Conversation.id.in_(locked_ids))
                    .values(from_end_user_id=target.id)
                    .execution_options(synchronize_session=False)
                )
            # Only the small final default-set mutation needs the target identity's
            # exclusive lock. Keep it out of the potentially large history/file transfer.
            target = lock_end_user(
                session,
                tenant_id=guest.tenant_id,
                app_id=app.id,
                end_user_id=account_end_user_id,
                exclusive=True,
            )
            if target is None or target.type != EndUserType.BROWSER or target.account_id != account.account_id:
                raise ConnectionIdentityError()
            if (
                session.scalar(
                    sa.select(Account.id)
                    .where(
                        Account.id == account.account_id,
                        Account.status.in_((AccountStatus.ACTIVE, AccountStatus.UNINITIALIZED)),
                    )
                    .with_for_update(read=True, nowait=True)
                )
                is None
            ):
                raise ConnectionIdentityError()
            EndUserConnectionRepository.transfer_guest_defaults(session, guest, account)
            return MigrationCounts(connections, chat_count)
