"""Persist an account's conversations within its admitted installation."""

from dataclasses import replace
from datetime import datetime
from typing import cast, override

from sqlalchemy import Select, exists, or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, Conversation, InstalledApp, Message
from models.web import PinnedConversation
from repositories.conversation_lifecycle import retire_conversation
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_conversation_service import (
    ConversationDeletion,
    ConversationInputValue,
    ConversationNameSource,
    ConversationPage,
    ConversationRecord,
    InstalledAppConversationStore,
)


class SQLAlchemyInstalledAppConversationRepository(InstalledAppConversationStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def get(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> ConversationRecord:
        with self._session_factory() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            conversation = self._get_conversation(
                session=session, app_id=app.id, account_id=account_id, conversation_id=conversation_id
            )
            return self._to_record(conversation=conversation, session=session)

    @override
    def get_page(
        self, *, installed_app: InstalledAppRef, account_id: str, last_id: str | None, limit: int, pinned: bool | None
    ) -> ConversationPage:
        with self._session_factory() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            statement = self._conversation_statement(app_id=app.id, account_id=account_id).where(
                or_(Conversation.invoke_from.is_(None), Conversation.invoke_from == InvokeFrom.EXPLORE)
            )
            if pinned is not None:
                pinned_ids = session.scalars(
                    select(PinnedConversation.conversation_id).where(
                        PinnedConversation.app_id == app.id,
                        PinnedConversation.created_by_role == CreatorUserRole.ACCOUNT,
                        PinnedConversation.created_by == account_id,
                    )
                ).all()
                if pinned:
                    if not pinned_ids:
                        return ConversationPage(limit=limit, has_more=False, data=())
                    statement = statement.where(Conversation.id.in_(pinned_ids))
                elif pinned_ids:
                    statement = statement.where(Conversation.id.not_in(pinned_ids))

            if last_id:
                last_conversation = session.scalar(statement.where(Conversation.id == last_id))
                if last_conversation is None:
                    raise LastConversationNotExistsError("The last_id cursor does not belong to these conversations.")
                statement = statement.where(Conversation.updated_at < last_conversation.updated_at)

            conversations = session.scalars(statement.order_by(Conversation.updated_at.desc()).limit(limit)).all()
            # Keep the existing strict timestamp cursor, including tied timestamps.
            has_more = len(conversations) == limit and bool(
                session.scalar(select(exists(statement.where(Conversation.updated_at < conversations[-1].updated_at))))
            )
            return ConversationPage(
                limit=limit,
                has_more=has_more,
                data=tuple(
                    self._to_record(conversation=conversation, session=session) for conversation in conversations
                ),
            )

    @override
    def get_name_source(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str
    ) -> ConversationNameSource:
        with self._session_factory() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            conversation = self._get_conversation(
                session=session, app_id=app.id, account_id=account_id, conversation_id=conversation_id
            )
            message = session.scalar(
                select(Message)
                .where(Message.app_id == app.id, Message.conversation_id == conversation.id)
                .order_by(Message.created_at.asc())
                .limit(1)
            )
            if message is None:
                raise MessageNotExistsError(f"Conversation {conversation_id} has no message to generate a name from.")
            return ConversationNameSource(
                tenant_id=app.tenant_id,
                query=message.query,
            )

    @override
    def rename(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        name: str,
        updated_at: datetime | None,
    ) -> ConversationRecord:
        with self._session_factory.begin() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            conversation = self._get_conversation(
                session=session, app_id=app.id, account_id=account_id, conversation_id=conversation_id
            )
            record = self._to_record(conversation=conversation, session=session)
            conversation.name = name
            if updated_at is not None:
                conversation.updated_at = updated_at
            session.flush()
            renamed = replace(record, name=conversation.name, updated_at=conversation.updated_at)
        return renamed

    @override
    def delete(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> ConversationDeletion:
        with self._session_factory.begin() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            conversation = self._get_conversation(
                session=session, app_id=app.id, account_id=account_id, conversation_id=conversation_id
            )
            retired_binding_id = retire_conversation(app_model=app, conversation=conversation, session=session)
            return ConversationDeletion(
                tenant_id=app.tenant_id,
                conversation_id=conversation.id,
                retired_binding_id=retired_binding_id,
            )

    @override
    def set_pinned(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str, is_pinned: bool
    ) -> None:
        with self._session_factory.begin() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            pin = session.scalar(
                select(PinnedConversation)
                .where(
                    PinnedConversation.app_id == app.id,
                    PinnedConversation.conversation_id == conversation_id,
                    PinnedConversation.created_by_role == CreatorUserRole.ACCOUNT,
                    PinnedConversation.created_by == account_id,
                )
                .limit(1)
            )
            if is_pinned:
                if pin is not None:
                    return
                conversation = self._get_conversation(
                    session=session, app_id=app.id, account_id=account_id, conversation_id=conversation_id
                )
                session.add(
                    PinnedConversation(
                        app_id=app.id,
                        conversation_id=conversation.id,
                        created_by_role=CreatorUserRole.ACCOUNT,
                        created_by=account_id,
                    )
                )
            elif pin is not None:
                session.delete(pin)

    @staticmethod
    def _get_app(*, session: Session, installed_app: InstalledAppRef) -> App:
        app = session.scalar(
            select(App)
            .join(InstalledApp, InstalledApp.app_id == App.id)
            .where(
                InstalledApp.id == installed_app.id,
                InstalledApp.tenant_id == installed_app.tenant_id,
                InstalledApp.app_id == installed_app.app_id,
            )
        )
        if app is None:
            raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
        return app

    @staticmethod
    def _conversation_statement(*, app_id: str, account_id: str) -> Select[tuple[Conversation]]:
        return select(Conversation).where(
            Conversation.app_id == app_id,
            Conversation.from_source == ConversationFromSource.CONSOLE,
            Conversation.from_account_id == account_id,
            Conversation.from_end_user_id.is_(None),
            Conversation.is_deleted.is_(False),
        )

    @classmethod
    def _get_conversation(cls, *, session: Session, app_id: str, account_id: str, conversation_id: str) -> Conversation:
        conversation = session.scalar(
            cls._conversation_statement(app_id=app_id, account_id=account_id).where(Conversation.id == conversation_id)
        )
        if conversation is None:
            raise ConversationNotExistsError(f"Conversation {conversation_id} does not belong to this account and app.")
        return conversation

    @staticmethod
    def _to_record(*, conversation: Conversation, session: Session) -> ConversationRecord:
        # Reuse the model's input/file restoration until that legacy I/O boundary
        # is migrated; do not duplicate its reconstruction logic in this repository.
        return ConversationRecord(
            id=conversation.id,
            name=conversation.name,
            inputs=cast(dict[str, ConversationInputValue], conversation.inputs_with_session(session=session)),
            status=conversation.status,
            introduction=conversation.introduction,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )
