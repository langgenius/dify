import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from models import Account
from models.model import App, AppMode, Conversation, EndUser
from repositories.conversation_access import conversation_owner_scope
from services.errors.conversation import ConversationNotExistsError
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.delete_conversation_task import delete_conversation_related_data

logger = logging.getLogger(__name__)


class ConversationService:
    @classmethod
    def get_conversation(
        cls,
        app_model: App,
        conversation_id: str,
        user: Account | EndUser | None,
        *,
        session: Session,
        lock: bool = False,
    ):
        """Read current ownership or raise; write callers may lock against history migration."""
        statement = select(Conversation).where(
            Conversation.id == conversation_id, *conversation_owner_scope(app_model.id, user)
        )
        if (
            lock
            and dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED
            and isinstance(user, EndUser)
            and app_model.mode == AppMode.ADVANCED_CHAT
        ):
            statement = statement.with_for_update()
        conversation = session.scalar(statement.limit(1))

        if not conversation:
            raise ConversationNotExistsError()

        return conversation

    @staticmethod
    def enqueue_delete_cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        """Dispatch resource collection only after the lifecycle transaction commits."""
        if retired_workspace_ids:
            enqueue_agent_resource_collection(
                tenant_id=tenant_id,
                workspace_ids=retired_workspace_ids,
            )
        try:
            delete_conversation_related_data.delay(conversation_id)
        except Exception:
            # The soft-deleted row is a durable cleanup marker picked up by the
            # periodic sweeper, so a broker outage must not resurrect or expose it.
            logger.exception("Failed to enqueue cleanup for conversation %s", conversation_id)
