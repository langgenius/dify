"""Execution extra contents and feedback telemetry for installed-app messages."""

import logging
from collections.abc import Mapping, Sequence

from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.installed_app_message_service import MessageFeedbackEvent

logger = logging.getLogger(__name__)


class InstalledAppMessageRuntime:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._extra_contents: SQLAlchemyExecutionExtraContentRepository = SQLAlchemyExecutionExtraContentRepository(
            session_maker=session_factory
        )

    def get_extra_contents(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]:
        contents = self._extra_contents.get_by_message_ids(message_ids)
        return {
            message_id: [content.model_dump(mode="json", exclude_none=True) for content in items]
            for message_id, items in zip(message_ids, contents, strict=True)
        }


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
