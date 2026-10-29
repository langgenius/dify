"""Persist conversations within their end-user or installed-account owner chain."""

from copy import deepcopy
from dataclasses import replace
from datetime import datetime

from sqlalchemy import Select, exists, or_, select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, Conversation, EndUser, InstalledApp, Message
from models.web import PinnedConversation
from repositories.conversation_lifecycle import retire_conversation
from services.entities.conversation_entities import (
    ConversationDeletion,
    ConversationInputValue,
    ConversationListSource,
    ConversationNameSource,
    ConversationPage,
    ConversationRecord,
    ConversationRef,
    ConversationScope,
    ConversationSort,
    InstalledAppConversationRef,
    InstalledAppConversationScope,
)
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef


class ConversationRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    def get(self, *, ref: ConversationRef) -> ConversationRecord:
        with self._session_factory() as session:
            _, conversation = self._resolve(session=session, ref=ref)
            return self._to_record(conversation=conversation, inputs=conversation.inputs_with_session(session=session))

    def get_page(
        self,
        *,
        scope: ConversationScope,
        invoke_from: ConversationListSource,
        last_id: str | None,
        limit: int,
        pinned: bool | None,
        sort_by: ConversationSort,
    ) -> ConversationPage:
        with self._session_factory() as session:
            if isinstance(scope, InstalledAppConversationScope):
                app = self._get_app(session=session, installed_app=scope.installed_app)
                statement = self._conversation_statement(app_id=app.id, account_id=scope.account_id)
                role, actor_id = CreatorUserRole.ACCOUNT, scope.account_id
            else:
                app = session.scalar(
                    select(App)
                    .join(EndUser, EndUser.app_id == App.id)
                    .where(
                        App.id == scope.app_id,
                        App.tenant_id == scope.tenant_id,
                        EndUser.id == scope.end_user_id,
                        EndUser.tenant_id == App.tenant_id,
                    )
                )
                if app is None:
                    raise ConversationNotExistsError(
                        f"Conversations for app {scope.app_id} are unavailable for this end user and workspace."
                    )
                statement = select(Conversation).where(
                    Conversation.app_id == app.id,
                    Conversation.from_source == ConversationFromSource.API,
                    Conversation.from_end_user_id == scope.end_user_id,
                    Conversation.from_account_id.is_(None),
                    Conversation.is_deleted.is_(False),
                )
                role, actor_id = CreatorUserRole.END_USER, scope.end_user_id
            statement = statement.where(
                or_(Conversation.invoke_from.is_(None), Conversation.invoke_from == invoke_from)
            )
            if pinned is not None:
                pinned_ids = session.scalars(
                    select(PinnedConversation.conversation_id).where(
                        PinnedConversation.app_id == app.id,
                        PinnedConversation.created_by_role == role,
                        PinnedConversation.created_by == actor_id,
                    )
                ).all()
                if pinned:
                    if not pinned_ids:
                        return ConversationPage(tenant_id=app.tenant_id, limit=limit, has_more=False, data=())
                    statement = statement.where(Conversation.id.in_(pinned_ids))
                elif pinned_ids:
                    statement = statement.where(Conversation.id.not_in(pinned_ids))

            by_created_at = sort_by in {"created_at", "-created_at"}
            column = Conversation.created_at if by_created_at else Conversation.updated_at
            descending = sort_by.startswith("-")
            if last_id:
                last_conversation = session.scalar(statement.where(Conversation.id == last_id))
                if last_conversation is None:
                    raise LastConversationNotExistsError("The last_id cursor does not belong to these conversations.")
                timestamp = last_conversation.created_at if by_created_at else last_conversation.updated_at
                statement = statement.where(column < timestamp if descending else column > timestamp)

            conversations = session.scalars(
                statement.order_by(column.desc() if descending else column.asc()).limit(limit)
            ).all()
            # Keep the existing strict timestamp cursor, including tied timestamps.
            has_more = False
            if conversations and len(conversations) == limit:
                last = conversations[-1]
                timestamp = last.created_at if by_created_at else last.updated_at
                has_more = bool(
                    session.scalar(
                        select(exists(statement.where(column < timestamp if descending else column > timestamp)))
                    )
                )
            return ConversationPage(
                tenant_id=app.tenant_id,
                limit=limit,
                has_more=has_more,
                # Input restoration can load file metadata. The shared query service
                # performs it after this read transaction has released its connection.
                data=tuple(
                    self._to_record(conversation=conversation, inputs=conversation._inputs)
                    for conversation in conversations
                ),
            )

    def get_name_source(self, *, ref: ConversationRef) -> ConversationNameSource:
        with self._session_factory() as session:
            app, conversation = self._resolve(session=session, ref=ref)
            query = session.scalar(
                select(Message.query)
                .where(Message.app_id == app.id, Message.conversation_id == conversation.id)
                .order_by(Message.created_at.asc())
                .limit(1)
            )
            if query is None:
                raise MessageNotExistsError(
                    f"Conversation {ref.conversation_id} has no message to generate a name from."
                )
            return ConversationNameSource(tenant_id=app.tenant_id, query=query)

    def rename(self, *, ref: ConversationRef, name: str, updated_at: datetime | None) -> ConversationRecord:
        with self._session_factory.begin() as session:
            _, conversation = self._resolve(session=session, ref=ref)
            record = self._to_record(
                conversation=conversation, inputs=conversation.inputs_with_session(session=session)
            )
            conversation.name = name
            if updated_at is not None:
                conversation.updated_at = updated_at
            session.flush()
            renamed = replace(record, name=conversation.name, updated_at=conversation.updated_at)
        return renamed

    def delete(self, *, ref: ConversationRef) -> ConversationDeletion:
        with self._session_factory.begin() as session:
            app, conversation = self._resolve(session=session, ref=ref)
            retired_workspace_ids = retire_conversation(app_model=app, conversation=conversation, session=session)
            return ConversationDeletion(
                tenant_id=app.tenant_id,
                conversation_id=conversation.id,
                retired_workspace_ids=retired_workspace_ids,
            )

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        with self._session_factory.begin() as session:
            if isinstance(ref, InstalledAppConversationRef):
                app = self._get_app(session=session, installed_app=ref.installed_app)
                role = CreatorUserRole.ACCOUNT
                actor_id = ref.account_id
            else:
                app = session.scalar(
                    select(App)
                    .join(EndUser, EndUser.app_id == App.id)
                    .where(
                        App.id == ref.app_id,
                        App.tenant_id == ref.tenant_id,
                        EndUser.id == ref.end_user_id,
                        EndUser.tenant_id == App.tenant_id,
                    )
                )
                if app is None:
                    raise ConversationNotExistsError(
                        f"Conversation {ref.conversation_id} is unavailable for this end user and app."
                    )
                role = CreatorUserRole.END_USER
                actor_id = ref.end_user_id
            pin = session.scalar(
                select(PinnedConversation)
                .where(
                    PinnedConversation.app_id == app.id,
                    PinnedConversation.conversation_id == ref.conversation_id,
                    PinnedConversation.created_by_role == role,
                    PinnedConversation.created_by == actor_id,
                )
                .limit(1)
            )
            if is_pinned:
                if pin is not None:
                    return
                _, conversation = self._resolve(session=session, ref=ref)
                session.add(
                    PinnedConversation(
                        app_id=app.id,
                        conversation_id=conversation.id,
                        created_by_role=role,
                        created_by=actor_id,
                    )
                )
            elif pin is not None:
                # Unpin remains idempotent even after its conversation is deleted.
                session.delete(pin)

    @classmethod
    def _resolve(cls, *, session: Session, ref: ConversationRef) -> tuple[App, Conversation]:
        if isinstance(ref, InstalledAppConversationRef):
            app = cls._get_app(session=session, installed_app=ref.installed_app)
            conversation = cls._get_conversation(
                session=session, app_id=app.id, account_id=ref.account_id, conversation_id=ref.conversation_id
            )
            return app, conversation

        result = session.execute(
            select(App, Conversation)
            .join(Conversation, Conversation.app_id == App.id)
            .join(
                EndUser,
                (EndUser.id == ref.end_user_id) & (EndUser.app_id == App.id) & (EndUser.tenant_id == App.tenant_id),
            )
            .where(
                App.id == ref.app_id,
                App.tenant_id == ref.tenant_id,
                Conversation.id == ref.conversation_id,
                Conversation.from_source == ConversationFromSource.API,
                Conversation.from_end_user_id == ref.end_user_id,
                Conversation.from_account_id.is_(None),
                Conversation.is_deleted.is_(False),
            )
        ).one_or_none()
        if result is None:
            raise ConversationNotExistsError(
                f"Conversation {ref.conversation_id} does not belong to this end user and app."
            )
        return result[0], result[1]

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
    def _to_record(*, conversation: Conversation, inputs: dict[str, ConversationInputValue]) -> ConversationRecord:
        return ConversationRecord(
            id=conversation.id,
            name=conversation.name,
            inputs=deepcopy(inputs),
            status=conversation.status,
            introduction=conversation.introduction,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )
