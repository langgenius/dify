"""Materialized Console conversation-variable reads with owned sessions."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models import App, AppMode, ConversationVariable
from models.enums import AppStatus
from repositories.app.console_repository import find_console_app
from services.conversation_variable_query import (
    CONVERSATION_VARIABLE_LIMIT,
    ConversationVariableAppNotFoundError,
    ConversationVariableQuery,
    ConversationVariableRecord,
)


class ConversationVariableQueryRepository(ConversationVariableQuery):
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
