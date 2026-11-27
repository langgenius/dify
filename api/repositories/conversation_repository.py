"""Persist conversations within their end-user, installed-account, or Console app scope."""

from collections.abc import Iterator
from copy import deepcopy
from dataclasses import replace
from datetime import datetime
from functools import partial
from typing import cast
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import DateTime, Select, and_, case, exists, func, literal, null, or_, select, tuple_, update
from sqlalchemy.orm import InstrumentedAttribute, Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from libs.pagination import paginate_query
from machinery.context import RequestContext
from models.account import Account
from models.enums import ConversationFromSource, CreatorUserRole, FeedbackFromSource, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser, InstalledApp, Message, MessageAnnotation, MessageFeedback
from models.web import PinnedConversation
from models.workflow import WorkflowRun
from repositories.app.console_repository import find_console_app
from repositories.conversation_lifecycle import retire_conversation, retire_debug_conversation_workspaces
from repositories.log_export_queries import execute_log_export_count, read_log_export_with_retry
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
    ConsoleConversationLogFilters,
    ConsoleConversationMessage,
    ConsoleConversationPage,
    ConsoleConversationRecord,
    ConsoleConversationScope,
    ConsoleLogIdentity,
    ConsoleLogIdentitySource,
    ConversationAgentWorkspaceRetirement,
    ConversationDeletion,
    ConversationInputValue,
    ConversationListSource,
    ConversationLogExportCounts,
    ConversationLogExportRow,
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

_LOG_IDENTITY_SEARCH_LIMIT = 20
_LOG_EXPORT_BATCH_SIZE = 500
_CONSOLE_APP_MODES_BY_KIND: dict[ConsoleConversationKind, frozenset[AppMode]] = {
    "completion": frozenset({AppMode.COMPLETION}),
    "chat": frozenset({AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}),
}
_CONSOLE_LOG_APP_MODES = _CONSOLE_APP_MODES_BY_KIND["completion"] | _CONSOLE_APP_MODES_BY_KIND["chat"]
_CONVERSATION_EXPORT_APP_MODES = _CONSOLE_LOG_APP_MODES - {AppMode.AGENT}


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
        return self._get_console_scope(context, app_id, allowed_modes=_CONSOLE_APP_MODES_BY_KIND[kind])

    def get_console_log_export_scope(self, context: RequestContext, app_id: str) -> ConsoleConversationScope:
        """Resolve the owned conversation app's mode and the caller's time zone for log export."""
        return self._get_console_scope(context, app_id, allowed_modes=_CONVERSATION_EXPORT_APP_MODES)

    def _get_console_scope(
        self, context: RequestContext, app_id: str, *, allowed_modes: frozenset[AppMode]
    ) -> ConsoleConversationScope:
        with self._session_factory() as session:
            app = self._get_console_app(session=session, context=context, app_id=app_id, allowed_modes=allowed_modes)
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
        """Return a page and total for the admitted app, with all response fields detached."""
        with self._session_factory() as session:
            app = find_console_app(session, workspace_id=scope.tenant_id, app_id=scope.app_id)
            if app is None:
                raise ConsoleAppNotFoundError("App not found.")
            if app.mode != scope.app_mode:
                raise ConsoleAppNotFoundError(
                    f"App mode changed from '{scope.app_mode}' to '{app.mode}' after admission."
                )
            completion = app.mode == AppMode.COMPLETION
            statement, column = self._filter_console_conversations(
                select(Conversation), app_id=app.id, mode=app.mode, filters=filters
            )
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

    def search_console_log_identities(
        self, context: RequestContext, app_id: str, *, keyword: str
    ) -> tuple[ConsoleLogIdentity, ...]:
        """Find visible log actors by label or ID, including former workspace members."""
        try:
            identity_id = str(UUID(keyword))
        except ValueError:
            identity_id = None

        with self._session_factory() as session:
            app = self._get_console_app(
                session=session, context=context, app_id=app_id, allowed_modes=_CONSOLE_LOG_APP_MODES
            )
            visible_logs, _ = self._filter_console_conversations(
                select(Conversation.id),
                app_id=app.id,
                mode=app.mode,
                filters=ConsoleConversationLogFilters(
                    keyword=None, start=None, end=None, annotation_status="all", sort_by="-created_at"
                ),
            )
            pattern = f"%{escape_like_pattern(keyword)}%"
            exact_end_user_match = EndUser.session_id == keyword
            account_match = Account.name.ilike(pattern, escape="\\")
            if identity_id is not None:
                exact_end_user_match = or_(exact_end_user_match, EndUser.id == identity_id)
                account_match = or_(account_match, Account.id == identity_id)

            end_users = session.execute(
                select(EndUser.id, EndUser.session_id)
                .where(
                    EndUser.tenant_id == app.tenant_id,
                    or_(exact_end_user_match, EndUser.session_id.ilike(pattern, escape="\\")),
                    visible_logs.where(
                        Conversation.from_source == ConversationFromSource.API,
                        Conversation.from_end_user_id == EndUser.id,
                    ).exists(),
                )
                .order_by(exact_end_user_match.desc(), EndUser.id)
                .limit(_LOG_IDENTITY_SEARCH_LIMIT)
            ).all()
            accounts = session.execute(
                select(Account.id, Account.name)
                .where(
                    account_match,
                    visible_logs.where(
                        Conversation.from_source == ConversationFromSource.CONSOLE,
                        Conversation.from_account_id == Account.id,
                    ).exists(),
                )
                .order_by(Account.name, Account.id)
                .limit(_LOG_IDENTITY_SEARCH_LIMIT)
            ).all()
            return (
                *(
                    ConsoleLogIdentity(identity, label, ConsoleLogIdentitySource.END_USER)
                    for identity, label in end_users
                ),
                *(
                    ConsoleLogIdentity(identity, label, ConsoleLogIdentitySource.ACCOUNT)
                    for identity, label in accounts
                ),
            )

    @staticmethod
    def _filter_console_conversations[T: tuple[object, ...]](
        statement: Select[T], *, app_id: str, mode: AppMode, filters: ConsoleConversationLogFilters
    ) -> tuple[Select[T], InstrumentedAttribute[datetime]]:
        """Apply Logs visibility and filters to a Conversation select, returning its time column."""
        completion = mode == AppMode.COMPLETION
        statement = statement.where(Conversation.app_id == app_id, Conversation.is_deleted.is_(False))
        if completion:
            statement = statement.where(Conversation.mode == AppMode.COMPLETION)
        identities = []
        if filters.end_user_ids:
            identities.append(
                and_(
                    Conversation.from_source == ConversationFromSource.API,
                    Conversation.from_end_user_id.in_(filters.end_user_ids),
                )
            )
        if filters.account_ids:
            identities.append(
                and_(
                    Conversation.from_source == ConversationFromSource.CONSOLE,
                    Conversation.from_account_id.in_(filters.account_ids),
                )
            )
        if identities:
            statement = statement.where(or_(*identities))
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
        if mode == AppMode.ADVANCED_CHAT:
            # SQL != also excludes NULL, matching the existing Console query.
            statement = statement.where(Conversation.invoke_from != InvokeFrom.DEBUGGER)
        return statement, column

    def get_console_log_export_counts(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationLogFilters
    ) -> ConversationLogExportCounts | None:
        """Count all matched conversations and their messages in one read statement.

        Require a Console conversation log scope. Recheck application ownership and mode before counting.
        Use a statement timeout on PostgreSQL and MySQL. Return None on timeout and release
        the read transaction on all paths.
        """
        with self._session_factory() as session:
            app = find_console_app(session, workspace_id=scope.tenant_id, app_id=scope.app_id)
            if app is None or app.mode != scope.app_mode:
                raise ConsoleAppNotFoundError("App not found.")
            matching, _ = self._filter_console_conversations(
                select(Conversation.id), app_id=app.id, mode=app.mode, filters=filters
            )
            if app.mode == AppMode.COMPLETION and filters.keyword:
                # Completion list search can return the same conversation for multiple matching messages.
                matching = matching.distinct()
            conversations = matching.subquery()
            # Count via the conversation_id index. A keyword selects the conversation,
            # and every message in that conversation contributes one export row.
            messages_per_conversation = (
                select(func.count()).where(Message.conversation_id == conversations.c.id).scalar_subquery()
            )
            counts = execute_log_export_count(
                session,
                select(func.count(), func.coalesce(func.sum(messages_per_conversation), 0)).select_from(conversations),
            )
            if counts is None:
                return None
            conversation_count, message_count = counts
            return ConversationLogExportCounts(
                conversation_count=int(conversation_count), message_count=int(message_count)
            )

    def iter_console_log_export_rows(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationLogFilters
    ) -> Iterator[ConversationLogExportRow]:
        """Yield one row per message of the owned app's matching conversations.

        Exclude new conversations and messages using the export start time. Release the read
        session before yielding each batch so the caller can write it outside a transaction.
        Retry eligible standby failures at the same page before advancing its cursor.
        Use a lookahead row to decide whether to continue after the last emitted message.
        """
        end_before = naive_utc_now()
        conversation_cursor: tuple[datetime, str] | None = None
        has_more_conversations = True
        while has_more_conversations:
            conversation_ids, statuses, conversation_cursor = read_log_export_with_retry(
                self._session_factory,
                scope.app_id,
                "conversation",
                partial(
                    self._console_log_export_selection,
                    scope=scope,
                    filters=filters,
                    end_before=end_before,
                    cursor=conversation_cursor,
                ),
                export_kind="conversation",
            )
            has_more_conversations = conversation_cursor is not None
            message_cursor: tuple[datetime, str] | None = None
            has_more_messages = bool(conversation_ids)
            while has_more_messages:
                rows = read_log_export_with_retry(
                    self._session_factory,
                    scope.app_id,
                    "message",
                    partial(
                        self._console_log_export_message_batch,
                        scope=scope,
                        conversation_ids=conversation_ids,
                        statuses=statuses,
                        end_before=end_before,
                        cursor=message_cursor,
                    ),
                    export_kind="conversation",
                )
                batch = rows[:_LOG_EXPORT_BATCH_SIZE]
                has_more_messages = len(rows) > _LOG_EXPORT_BATCH_SIZE
                yield from batch
                if has_more_messages:
                    last = batch[-1]
                    message_cursor = (last.created_at, last.message_id)

    def _console_log_export_selection(
        self,
        session: Session,
        *,
        scope: ConsoleConversationScope,
        filters: ConsoleConversationLogFilters,
        end_before: datetime,
        cursor: tuple[datetime, str] | None,
    ) -> tuple[tuple[str, ...], dict[str, str], tuple[datetime, str] | None]:
        """Select matching IDs and statuses within one candidate page of the owned app.

        The next cursor advances over the candidate page even when it yields no matches.
        Return None as the cursor when there are no more candidates to scan.
        """
        app = find_console_app(session, workspace_id=scope.tenant_id, app_id=scope.app_id)
        if app is None or app.mode != scope.app_mode:
            raise ConsoleAppNotFoundError("App not found.")

        # Page the inexpensive predicates before applying keyword and annotation joins.
        candidates, _ = self._filter_console_conversations(
            select(Conversation.created_at, Conversation.id),
            app_id=app.id,
            mode=app.mode,
            filters=replace(filters, keyword=None, annotation_status="all"),
        )
        candidates = candidates.where(Conversation.created_at < end_before)
        if cursor is not None:
            cursor_at, cursor_id = cursor
            # Give the app and time index an explicit bound and use IDs to break ties.
            candidates = candidates.where(
                Conversation.created_at >= cursor_at,
                or_(Conversation.created_at != cursor_at, Conversation.id > cursor_id),
            )
        page = (
            session.execute(candidates.order_by(Conversation.created_at, Conversation.id).limit(_LOG_EXPORT_BATCH_SIZE))
            .tuples()
            .all()
        )
        if not page:
            return (), {}, None

        conversation_ids = tuple(conversation_id for _, conversation_id in page)
        if filters.keyword or filters.annotation_status != "all":
            matches, _ = self._filter_console_conversations(
                select(Conversation.id).where(Conversation.id.in_(conversation_ids)),
                app_id=app.id,
                mode=app.mode,
                filters=filters,
            )
            if app.mode == AppMode.COMPLETION and filters.keyword:
                matches = matches.distinct()
            conversation_ids = tuple(session.scalars(matches))

        statuses = (
            self._chatflow_log_export_statuses(session, scope, conversation_ids, end_before)
            if conversation_ids and app.mode == AppMode.ADVANCED_CHAT
            else {}
        )
        next_cursor = (page[-1][0], page[-1][1]) if len(page) == _LOG_EXPORT_BATCH_SIZE else None
        return conversation_ids, statuses, next_cursor

    def _console_log_export_message_batch(
        self,
        session: Session,
        *,
        scope: ConsoleConversationScope,
        conversation_ids: tuple[str, ...],
        statuses: dict[str, str],
        end_before: datetime,
        cursor: tuple[datetime, str] | None,
    ) -> list[ConversationLogExportRow]:
        """Read an ordered message page plus one lookahead row for the admitted app's selected conversations."""
        app = find_console_app(session, workspace_id=scope.tenant_id, app_id=scope.app_id)
        if app is None or app.mode != scope.app_mode:
            raise ConsoleAppNotFoundError("App not found.")
        # Select only one user feedback even if old data has more than one per message.
        feedback_id = (
            select(MessageFeedback.id)
            .where(
                MessageFeedback.message_id == Message.id,
                MessageFeedback.app_id == app.id,
                MessageFeedback.from_source == FeedbackFromSource.USER,
            )
            .order_by(MessageFeedback.updated_at.desc(), MessageFeedback.id.desc())
            .limit(1)
            .correlate(Message)
            .scalar_subquery()
        )
        statement = (
            select(
                Message.conversation_id,
                Message.id,
                Message.created_at,
                EndUser.session_id,
                Conversation.from_account_id,
                Account.name,
                Message.query,
                Message.answer,
                MessageFeedback.rating,
                MessageFeedback.content,
                Message._inputs if app.mode == AppMode.COMPLETION else null(),
            )
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .outerjoin(EndUser, and_(EndUser.id == Conversation.from_end_user_id, EndUser.tenant_id == scope.tenant_id))
            .outerjoin(Account, Account.id == Conversation.from_account_id)
            .outerjoin(MessageFeedback, MessageFeedback.id == feedback_id)
            .where(
                Message.app_id == app.id,
                Conversation.app_id == app.id,
                Conversation.is_deleted.is_(False),
                Message.conversation_id.in_(conversation_ids),
                Message.created_at < end_before,
            )
            .order_by(Message.created_at, Message.id)
            .limit(_LOG_EXPORT_BATCH_SIZE + 1)
        )
        if cursor is not None:
            statement = statement.where(
                tuple_(Message.created_at, Message.id)
                > tuple_(literal(cursor[0], type_=DateTime()), literal(cursor[1], type_=Message.id.type))
            )

        rows = session.execute(statement).tuples().all()
        return [ConversationLogExportRow(*row, status=statuses.get(row[0])) for row in rows]

    @staticmethod
    def _chatflow_log_export_statuses(
        session: Session, scope: ConsoleConversationScope, conversation_ids: tuple[str, ...], end_before: datetime
    ) -> dict[str, str]:
        """Resolve the Logs status for each batch conversation's exported messages with linked runs."""
        # The Logs UI prioritizes paused, failed and partial success in that order.
        statuses = (
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.PAUSED,
        )
        priority = case({status: index for index, status in enumerate(statuses)}, value=WorkflowRun.status, else_=0)
        statement = (
            select(Message.conversation_id, func.max(priority))
            .outerjoin(
                WorkflowRun,
                and_(
                    WorkflowRun.id == Message.workflow_run_id,
                    WorkflowRun.app_id == scope.app_id,
                    WorkflowRun.tenant_id == scope.tenant_id,
                ),
            )
            .where(
                Message.app_id == scope.app_id,
                Message.conversation_id.in_(conversation_ids),
                Message.workflow_run_id.is_not(None),
                Message.created_at < end_before,
            )
            .group_by(Message.conversation_id)
        )
        return {conversation_id: statuses[index].value for conversation_id, index in session.execute(statement)}

    def get_console_detail(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationDetailSource:
        with self._session_factory() as session:
            app = self._get_console_app(
                session=session, context=context, app_id=app_id, allowed_modes=_CONSOLE_APP_MODES_BY_KIND[kind]
            )
            conversation = self._get_console_conversation(
                session=session, app_id=app.id, conversation_id=conversation_id
            )
            common = self._console_detail_record(conversation=conversation, session=session)
            if kind == "completion":
                message = conversation.first_message_with_session(session=session)
                message_source = snapshot_console_message(message=message, session=session) if message else None
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
                        first_message=message_source.record if message_source is not None else None,
                    ),
                    files=message_source.files if message_source is not None else (),
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
            app = self._get_console_app(
                session=session, context=context, app_id=app_id, allowed_modes=_CONSOLE_APP_MODES_BY_KIND[kind]
            )
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
            app = self._get_console_app(
                session=session, context=context, app_id=app_id, allowed_modes=_CONSOLE_APP_MODES_BY_KIND[kind]
            )
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

    def retire_console_debug_agent_workspaces(
        self, context: RequestContext, app_id: str
    ) -> ConversationAgentWorkspaceRetirement:
        with self._session_factory.begin() as session:
            app = find_console_app(session, workspace_id=context.active_workspace_id, app_id=app_id)
            if app is None:
                raise ConsoleAppNotFoundError("App not found.")
            if app.mode != AppMode.ADVANCED_CHAT:
                raise ConsoleAppNotFoundError(f"App mode is not in the supported list: {[AppMode.ADVANCED_CHAT.value]}")
            retired_agent_workspace_ids = retire_debug_conversation_workspaces(
                session=session,
                tenant_id=app.tenant_id,
                app_id=app.id,
                account_id=context.account_id,
            )
            return ConversationAgentWorkspaceRetirement(
                tenant_id=app.tenant_id, retired_agent_workspace_ids=retired_agent_workspace_ids
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
        *, session: Session, context: RequestContext, app_id: str, allowed_modes: frozenset[AppMode]
    ) -> App:
        app = find_console_app(session, workspace_id=context.active_workspace_id, app_id=app_id)
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
