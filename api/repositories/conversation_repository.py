"""Persist conversations within their end-user, installed-account, or Console app scope."""

from copy import deepcopy
from dataclasses import replace
from datetime import datetime
from typing import cast

from pydantic import JsonValue
from sqlalchemy import Select, exists, func, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from libs.pagination import paginate_query
from machinery.context import RequestContext
from models.account import Account
from models.enums import ConversationFromSource, CreatorUserRole, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser, InstalledApp, Message, MessageAnnotation
from models.web import PinnedConversation
from repositories.app.console_repository import find_console_app
from repositories.conversation_lifecycle import retire_conversation
from repositories.message_projection import snapshot_console_message
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import (
    ConsoleChatConversationDetail,
    ConsoleChatConversationRecord,
    ConsoleCompletionConversationDetail,
    ConsoleCompletionConversationRecord,
    ConsoleConversationAccount,
    ConsoleConversationAnnotation,
    ConsoleConversationDetail,
    ConsoleConversationDetailSource,
    ConsoleConversationFilters,
    ConsoleConversationKind,
    ConsoleConversationMessage,
    ConsoleConversationPage,
    ConsoleConversationRecord,
    ConsoleConversationScope,
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
from services.errors.base import NoPermissionError
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

    def get_console_scope(
        self, context: RequestContext, app_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationScope:
        with self._session_factory() as session:
            app = self._get_console_app(session=session, context=context, app_id=app_id, kind=kind)
            account = session.get(Account, context.account_id)
            if account is None:
                raise NoPermissionError("The admitted account no longer exists.")
            assert account.timezone is not None
            return ConsoleConversationScope(
                app_id=app.id,
                tenant_id=app.tenant_id,
                app_mode=app.mode,
                timezone=account.timezone,
            )

    def get_console_page(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationFilters
    ) -> ConsoleConversationPage:
        with self._session_factory() as session:
            app = find_console_app(session, workspace_id=scope.tenant_id, app_id=scope.app_id)
            if app is None:
                raise ConsoleAppNotFoundError("App not found.")
            if app.mode != scope.app_mode:
                raise ConsoleAppNotFoundError(
                    f"App mode changed from '{scope.app_mode}' to '{app.mode}' after admission."
                )
            completion = app.mode == AppMode.COMPLETION
            statement = select(Conversation).where(Conversation.app_id == app.id, Conversation.is_deleted.is_(False))
            if completion:
                statement = statement.where(Conversation.mode == AppMode.COMPLETION)
            if filters.keyword:
                pattern = f"%{escape_like_pattern(filters.keyword)}%"
                statement = statement.join(Message, Message.conversation_id == Conversation.id)
                matches = [
                    Message.query.ilike(pattern, escape="\\"),
                    Message.answer.ilike(pattern, escape="\\"),
                ]
                if not completion:
                    statement = statement.outerjoin(EndUser, Conversation.from_end_user_id == EndUser.id)
                    matches.extend(
                        [
                            Conversation.name.ilike(pattern, escape="\\"),
                            Conversation.introduction.ilike(pattern, escape="\\"),
                            EndUser.session_id.ilike(pattern, escape="\\"),
                        ]
                    )
                    statement = statement.group_by(Conversation.id)
                # Completion historically counts each matching message join row.
                statement = statement.where(or_(*matches))

            column = (
                Conversation.created_at
                if completion or filters.sort_by in {"created_at", "-created_at"}
                else Conversation.updated_at
            )
            if filters.start is not None:
                statement = statement.where(column >= filters.start)
            if filters.end is not None:
                statement = statement.where(column <= filters.end)
            if filters.annotation_status == "annotated":
                statement = statement.join(
                    MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
                ).group_by(Conversation.id)
            elif filters.annotation_status == "not_annotated":
                statement = (
                    statement.outerjoin(MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id)
                    .group_by(Conversation.id)
                    .having(func.count(MessageAnnotation.id) == 0)
                )
            if app.mode == AppMode.ADVANCED_CHAT:
                # SQL != also excludes NULL, matching the existing Console query.
                statement = statement.where(Conversation.invoke_from != InvokeFrom.DEBUGGER)
            statement = statement.order_by(
                column.desc() if completion or filters.sort_by.startswith("-") else column.asc()
            )
            page = paginate_query(statement, session=session, page=filters.page, per_page=filters.limit)
            return ConsoleConversationPage(
                tenant_id=app.tenant_id,
                page=page.page,
                per_page=page.per_page,
                total=page.total,
                has_next=page.has_next,
                items=tuple(
                    self._console_record(conversation=item, session=session, completion=completion)
                    for item in page.items
                ),
            )

    def get_console_detail(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationDetailSource:
        with self._session_factory() as session:
            app = self._get_console_app(session=session, context=context, app_id=app_id, kind=kind)
            conversation = self._get_console_conversation(
                session=session, app_id=app.id, conversation_id=conversation_id
            )
            common = self._console_detail_record(conversation=conversation, session=session)
            if kind == "completion":
                message = conversation.first_message_with_session(session=session)
                first_message, files = (
                    snapshot_console_message(message=message, session=session) if message else (None, ())
                )
                return ConsoleConversationDetailSource(
                    tenant_id=app.tenant_id,
                    record=ConsoleCompletionConversationDetail(
                        id=common.id,
                        status=common.status,
                        from_source=common.from_source,
                        from_end_user_id=common.from_end_user_id,
                        from_account_id=common.from_account_id,
                        created_at=common.created_at,
                        model_config=common.model_config,
                        first_message=first_message,
                    ),
                    files=files,
                )
            return ConsoleConversationDetailSource(
                tenant_id=app.tenant_id,
                record=ConsoleChatConversationDetail(
                    id=common.id,
                    status=common.status,
                    from_source=common.from_source,
                    from_end_user_id=common.from_end_user_id,
                    from_account_id=common.from_account_id,
                    created_at=common.created_at,
                    model_config=common.model_config,
                    updated_at=conversation.updated_at,
                    annotated=conversation.annotated_with_session(session=session),
                    introduction=conversation.introduction,
                    message_count=conversation.message_count_with_session(session=session),
                    user_feedback_stats=conversation.user_feedback_stats_with_session(session=session),
                    admin_feedback_stats=conversation.admin_feedback_stats_with_session(session=session),
                ),
                files=(),
            )

    def mark_console_read(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> None:
        with self._session_factory.begin() as session:
            app = self._get_console_app(session=session, context=context, app_id=app_id, kind=kind)
            self._get_console_conversation(session=session, app_id=app.id, conversation_id=conversation_id)
            session.execute(
                update(Conversation)
                .where(
                    Conversation.id == conversation_id,
                    Conversation.app_id == app.id,
                    Conversation.read_at.is_(None),
                )
                .values(
                    {
                        Conversation.read_at: naive_utc_now(),
                        Conversation.read_account_id: context.account_id,
                        # Marking a log read must not reorder the conversation list.
                        Conversation.updated_at: Conversation.updated_at,
                    }
                )
            )

    @staticmethod
    def _get_console_conversation(*, session: Session, app_id: str, conversation_id: str) -> Conversation:
        # Console details include every actor's history and soft-deleted rows.
        conversation = session.scalar(
            select(Conversation).where(Conversation.id == conversation_id, Conversation.app_id == app_id)
        )
        if conversation is None:
            raise ConversationNotExistsError(f"Conversation {conversation_id} is unavailable for app {app_id}.")
        return conversation

    @staticmethod
    def _console_detail_record(*, conversation: Conversation, session: Session) -> ConsoleConversationDetail:
        return ConsoleConversationDetail(
            id=conversation.id,
            status=conversation.status,
            from_source=conversation.from_source,
            from_end_user_id=conversation.from_end_user_id,
            from_account_id=conversation.from_account_id,
            created_at=conversation.created_at,
            model_config=deepcopy(cast(dict[str, JsonValue], conversation.model_config_with_session(session=session))),
        )

    @classmethod
    def _console_record(
        cls, *, conversation: Conversation, session: Session, completion: bool
    ) -> ConsoleCompletionConversationRecord | ConsoleChatConversationRecord:
        # Keep established config/feedback/summary policies in their current
        # DB-only owners; this snapshot must not restore attachments or URLs.
        detail = cls._console_detail_record(conversation=conversation, session=session)
        common = ConsoleConversationRecord(
            id=detail.id,
            status=detail.status,
            from_source=detail.from_source,
            from_end_user_id=detail.from_end_user_id,
            from_end_user_session_id=conversation.from_end_user_session_id_with_session(session=session),
            from_account_id=detail.from_account_id,
            from_account_name=conversation.from_account_name_with_session(session=session),
            read_at=conversation.read_at,
            created_at=detail.created_at,
            updated_at=conversation.updated_at,
            model_config=detail.model_config,
            user_feedback_stats=conversation.user_feedback_stats_with_session(session=session),
            admin_feedback_stats=conversation.admin_feedback_stats_with_session(session=session),
        )
        if completion:
            annotation = conversation.annotation_with_session(session=session)
            account = annotation.account_with_session(session=session) if annotation is not None else None
            annotation_record = (
                ConsoleConversationAnnotation(
                    id=annotation.id,
                    question=annotation.question,
                    content=annotation.content,
                    account=(
                        ConsoleConversationAccount(id=account.id, name=account.name, email=account.email)
                        if account is not None
                        else None
                    ),
                    created_at=annotation.created_at,
                )
                if annotation is not None
                else None
            )
            message = conversation.first_message_with_session(session=session)
            first_message = (
                ConsoleConversationMessage(
                    inputs=deepcopy(message._inputs),
                    query=message.query,
                    message=deepcopy(cast(JsonValue, message.message)),
                    answer=message.answer,
                )
                if message is not None
                else None
            )
            return ConsoleCompletionConversationRecord(
                id=common.id,
                status=common.status,
                from_source=common.from_source,
                from_end_user_id=common.from_end_user_id,
                from_end_user_session_id=common.from_end_user_session_id,
                from_account_id=common.from_account_id,
                from_account_name=common.from_account_name,
                read_at=common.read_at,
                created_at=common.created_at,
                updated_at=common.updated_at,
                model_config=common.model_config,
                user_feedback_stats=common.user_feedback_stats,
                admin_feedback_stats=common.admin_feedback_stats,
                annotation=annotation_record,
                first_message=first_message,
            )
        return ConsoleChatConversationRecord(
            id=common.id,
            status=common.status,
            from_source=common.from_source,
            from_end_user_id=common.from_end_user_id,
            from_end_user_session_id=common.from_end_user_session_id,
            from_account_id=common.from_account_id,
            from_account_name=common.from_account_name,
            read_at=common.read_at,
            created_at=common.created_at,
            updated_at=common.updated_at,
            model_config=common.model_config,
            user_feedback_stats=common.user_feedback_stats,
            admin_feedback_stats=common.admin_feedback_stats,
            name=conversation.name,
            summary_or_query=conversation.summary_or_query_with_session(session=session),
            annotated=conversation.annotated_with_session(session=session),
            message_count=conversation.message_count_with_session(session=session),
            status_count=conversation.status_count_with_session(session=session),
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

    def delete_console(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> ConversationDeletion:
        with self._session_factory.begin() as session:
            app = self._get_console_app(session=session, context=context, app_id=app_id, kind=kind)
            # Console log queries see all users; deletion still requires the
            # current account's Console conversation, as in the original API.
            conversation = self._get_conversation(
                session=session, app_id=app.id, account_id=context.account_id, conversation_id=conversation_id
            )
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
    def _get_console_app(
        *, session: Session, context: RequestContext, app_id: str, kind: ConsoleConversationKind
    ) -> App:
        app = find_console_app(session, workspace_id=context.active_workspace_id, app_id=app_id)
        allowed_modes = (
            {AppMode.COMPLETION}
            if kind == "completion"
            else {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}
        )
        if app is None:
            raise ConsoleAppNotFoundError("App not found.")
        if app.mode not in allowed_modes:
            mode_values = sorted(mode.value for mode in allowed_modes)
            raise ConsoleAppNotFoundError(f"App mode is not in the supported list: {mode_values}")
        return app

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
