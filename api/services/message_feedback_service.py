"""Message feedback shared by user-facing and Console management endpoints."""

import logging
from dataclasses import dataclass
from typing import Protocol

from models.enums import FeedbackRating
from services.entities.message_entities import MessageAccount, MessageActor
from services.installed_app_access_service import InstalledAppRef

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class MessageFeedbackRecord:
    id: str
    app_id: str
    conversation_id: str
    message_id: str
    rating: str
    content: str | None
    from_source: str
    from_end_user_id: str | None
    from_account_id: str | None
    created_at: str
    updated_at: str


class MessageFeedbackStore(Protocol):
    def set_feedback(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
        rating: FeedbackRating | None,
        content: str | None,
        app_wide: bool,
        installed_app: InstalledAppRef | None,
    ) -> MessageFeedbackRecord | None:
        """Commit a rating and return detached data, or revoke it and return None."""
        ...

    def get_feedbacks(
        self, *, app_id: str, app_owner_tenant_id: str, page: int, limit: int
    ) -> list[MessageFeedbackRecord]: ...


class MessageFeedbackService:
    def __init__(self, *, repository: MessageFeedbackStore) -> None:
        self._repository: MessageFeedbackStore = repository

    def set_feedback(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
        rating: FeedbackRating | None,
        content: str | None,
        installed_app: InstalledAppRef | None = None,
    ) -> None:
        """Rate the actor's own message; None revokes existing feedback.

        Explore supplies its installation to recheck admission in the write
        transaction. Other entrypoints have no installation (None).
        Content may be absent (None) or explicitly empty, and is saved as given.
        """
        feedback = self._repository.set_feedback(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            actor=actor,
            message_id=message_id,
            rating=rating,
            content=content,
            app_wide=False,
            installed_app=installed_app,
        )
        if feedback is None:
            return

        # The repository has committed and closed its session. Telemetry failure
        # must not turn a successful feedback write into a failed HTTP request.
        try:
            from core.telemetry import FeedbackCreatedEvent, TelemetryContext, emit

            emit(
                FeedbackCreatedEvent(
                    context=TelemetryContext(tenant_id=app_owner_tenant_id),
                    payload={
                        "message_id": feedback.message_id,
                        "app_id": feedback.app_id,
                        "conversation_id": feedback.conversation_id,
                        "from_end_user_id": None if isinstance(actor, MessageAccount) else actor.end_user_id,
                        "from_account_id": actor.account_id if isinstance(actor, MessageAccount) else None,
                        "rating": feedback.rating,
                        "from_source": feedback.from_source,
                        "content": feedback.content,
                    },
                )
            )
        except Exception:
            logger.warning("Failed to emit feedback telemetry for message %s", message_id, exc_info=True)

    def set_admin_feedback(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        message_id: str,
        rating: FeedbackRating | None,
        content: str | None,
    ) -> None:
        """Rate any message in an admitted Console app, without user telemetry.

        None rating revokes existing admin feedback. None content means no comment.
        Console admission owns workspace/RBAC checks; being a MessageAccount alone
        does not grant this broader message access.
        """
        self._repository.set_feedback(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            actor=MessageAccount(account_id=account_id),
            message_id=message_id,
            rating=rating,
            content=content,
            app_wide=True,
            installed_app=None,
        )

    def get_feedbacks(
        self, *, app_id: str, app_owner_tenant_id: str, page: int, limit: int
    ) -> list[MessageFeedbackRecord]:
        """List app feedback newest first, using one-based pages."""
        return self._repository.get_feedbacks(
            app_id=app_id, app_owner_tenant_id=app_owner_tenant_id, page=page, limit=limit
        )
