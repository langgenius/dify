"""Boundaries to the existing message runtime and execution extra contents."""

import logging
from collections.abc import Mapping, Sequence

from flask import current_app
from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models import Account, App, InstalledApp
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.account_errors import AccountNotFoundError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_message_service import MessageFeedbackEvent
from services.message_service import MessageService

logger = logging.getLogger(__name__)


class InstalledAppMessageRuntime:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory
        self._extra_contents: SQLAlchemyExecutionExtraContentRepository = SQLAlchemyExecutionExtraContentRepository(
            session_maker=session_factory
        )

    def get_extra_contents(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]:
        contents = self._extra_contents.get_by_message_ids(message_ids)
        return {
            message_id: [content.model_dump(mode="json", exclude_none=True) for content in items]
            for message_id, items in zip(message_ids, contents, strict=True)
        }

    def get_suggested_questions(self, *, installed_app: InstalledAppRef, account_id: str, message_id: str) -> list[str]:
        with self._session_factory(expire_on_commit=False) as session:
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
            account = session.get(Account, account_id)
            if account is None:
                raise AccountNotFoundError(f"Account {account_id} no longer exists")

        # TODO: Migrate the legacy history, model configuration, and provider
        # lookups together. They still use db.session internally. A separate app
        # context releases that scoped session without touching the request's.
        with current_app.app_context():
            return MessageService.get_suggested_questions_after_answer(
                app_model=app,
                user=account,
                message_id=message_id,
                invoke_from=InvokeFrom.EXPLORE,
                session=db.session(),
            )


def emit_installed_app_feedback(*, feedback: MessageFeedbackEvent) -> None:
    # Feedback has already committed. Telemetry failure must not reject it.
    try:
        from core.telemetry import FeedbackCreatedEvent, TelemetryContext, emit

        emit(
            FeedbackCreatedEvent(
                context=TelemetryContext(tenant_id=feedback.tenant_id),
                payload={
                    "message_id": feedback.message_id,
                    "app_id": feedback.app_id,
                    "conversation_id": feedback.conversation_id,
                    "from_end_user_id": None,
                    "from_account_id": feedback.account_id,
                    "rating": feedback.rating,
                    "from_source": "admin",
                    "content": feedback.content,
                },
            )
        )
    except Exception:
        logger.warning("Failed to emit feedback telemetry for message %s", feedback.message_id, exc_info=True)
