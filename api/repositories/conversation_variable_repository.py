"""Conversation-variable persistence with fully scoped, bounded sessions."""

from collections.abc import Callable
from typing import override

from sqlalchemy import JSON, ColumnElement, Select, cast, func, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.variables import VariableBase
from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from machinery.context import RequestContext
from models import App, AppMode, ConversationVariable
from models.enums import AppStatus, ConversationFromSource
from models.model import Conversation, EndUser
from repositories.app.console_repository import find_console_app
from services.conversation_variable_query import (
    CONVERSATION_VARIABLE_LIMIT,
    ConversationVariableAppNotFoundError,
    ConversationVariablePage,
    ConversationVariableQuery,
    ConversationVariableRecord,
)
from services.entities.conversation_entities import EndUserConversationRef
from services.errors.conversation import ConversationNotExistsError, ConversationVariableNotExistsError


class ConversationVariableRepository(ConversationVariableQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def require_app(self, context: RequestContext, app_id: str) -> None:
        with self._session_factory() as session:
            app = find_console_app(session, workspace_id=context.active_workspace_id, app_id=app_id)
            if app is None:
                raise ConversationVariableAppNotFoundError("App not found.")
            if AppMode.value_of(app.mode) != AppMode.ADVANCED_CHAT:
                modes = {AppMode.ADVANCED_CHAT.value}
                raise ConversationVariableAppNotFoundError(f"App mode is not in the supported list: {modes}")

    @override
    def list_variables(
        self, context: RequestContext, app_id: str, conversation_id: str
    ) -> list[ConversationVariableRecord]:
        with self._session_factory() as session:
            rows = session.scalars(
                select(ConversationVariable)
                .join(App, App.id == ConversationVariable.app_id)
                .where(
                    App.id == app_id,
                    App.tenant_id == context.active_workspace_id,
                    App.status == AppStatus.NORMAL,
                    App.mode == AppMode.ADVANCED_CHAT,
                    ConversationVariable.conversation_id == conversation_id,
                )
                .order_by(ConversationVariable.created_at)
                .limit(CONVERSATION_VARIABLE_LIMIT)
            )
            # Decode inside the owned session; neither rows nor lazy loads escape.
            return [
                ConversationVariableRecord(
                    id=row.id,
                    variable=row.to_variable(),
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                )
                for row in rows
            ]

    @override
    def get_page(
        self,
        *,
        ref: EndUserConversationRef,
        last_id: str | None,
        limit: int,
        variable_name: str | None,
    ) -> ConversationVariablePage:
        with self._session_factory() as session:
            stmt = self._variables(session=session, ref=ref)
            if variable_name:
                stmt = stmt.where(
                    self._name_filter(variable_name=variable_name, dialect_name=session.get_bind().dialect.name)
                )
            if last_id:
                cursor = session.scalar(stmt.where(ConversationVariable.id == last_id))
                if cursor is None:
                    raise ConversationVariableNotExistsError()
                # Keep the existing strict timestamp cursor, including its tie behavior.
                stmt = stmt.where(ConversationVariable.created_at > cursor.created_at)
            rows = session.scalars(stmt.order_by(ConversationVariable.created_at).limit(limit + 1)).all()
            return ConversationVariablePage(
                limit=limit,
                has_more=len(rows) > limit,
                data=tuple(self._record(row) for row in rows[:limit]),
            )

    def update(
        self,
        *,
        ref: EndUserConversationRef,
        variable_id: str,
        transform: Callable[[VariableBase], VariableBase],
    ) -> ConversationVariableRecord:
        """Apply a pure transformation in the write transaction; it must perform no external I/O."""
        with self._session_factory.begin() as session:
            stmt = self._variables(session=session, ref=ref)
            row = session.scalar(stmt.where(ConversationVariable.id == variable_id).with_for_update())
            if row is None:
                raise ConversationVariableNotExistsError()
            variable = transform(row.to_variable())
            row.data = variable.model_dump_json()
            row.updated_at = naive_utc_now()
            record = ConversationVariableRecord(
                id=row.id,
                variable=variable,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        return record

    @staticmethod
    def _name_filter(*, variable_name: str, dialect_name: str) -> ColumnElement[bool]:
        # The stored payload is TEXT, while PostgreSQL's extractor requires JSON.
        name = (
            func.json_extract_path_text(cast(ConversationVariable.data, JSON), "name")
            if dialect_name == "postgresql"
            else func.json_extract(ConversationVariable.data, "$.name")
        )
        return name.ilike(f"%{escape_like_pattern(variable_name)}%", escape="\\")

    @staticmethod
    def _variables(*, session: Session, ref: EndUserConversationRef) -> Select[tuple[ConversationVariable]]:
        owner = (
            select(Conversation.id)
            .join(App, App.id == Conversation.app_id)
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
        )
        if session.scalar(owner) is None:
            raise ConversationNotExistsError(
                f"Conversation {ref.conversation_id} does not belong to this end user and app."
            )
        return select(ConversationVariable).where(
            ConversationVariable.app_id == ref.app_id,
            ConversationVariable.conversation_id.in_(owner),
        )

    @staticmethod
    def _record(row: ConversationVariable) -> ConversationVariableRecord:
        return ConversationVariableRecord(
            id=row.id,
            variable=row.to_variable(),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
