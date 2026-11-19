import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account
from models.model import App, Conversation, EndUser
from repositories.conversation_lifecycle import retire_superseded_debug_conversations
from services.errors.conversation import ConversationNotExistsError
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.delete_conversation_task import delete_conversation_related_data

logger = logging.getLogger(__name__)


class ConversationService:
    @classmethod
    def get_conversation(
        cls, app_model: App, conversation_id: str, user: Account | EndUser | None, *, session: Session
    ):
        conversation = session.scalar(
            select(Conversation)
            .where(
                Conversation.id == conversation_id,
                Conversation.app_id == app_model.id,
                Conversation.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Conversation.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Conversation.from_account_id == (user.id if isinstance(user, Account) else None),
                Conversation.is_deleted.is_(False),
            )
            .limit(1)
        )

        if not conversation:
            raise ConversationNotExistsError()

        return conversation

    @staticmethod
    def retire_superseded_debug_conversations(
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        account_id: str,
        current_conversation_id: str,
    ) -> None:
        """Retire superseded debug workspaces and enqueue collection after commit.

        Preconditions: the caller just persisted ``current_conversation_id`` as
        a debug Conversation of ``app_id`` for ``account_id``. Postconditions:
        the retirement is committed before collection is published so the
        backend never destroys a workspace a rollback would restore.
        """
        retired_workspace_ids = retire_superseded_debug_conversations(
            session=session,
            tenant_id=tenant_id,
            app_id=app_id,
            account_id=account_id,
            current_conversation_id=current_conversation_id,
        )
        session.commit()
        if retired_workspace_ids:
            enqueue_agent_resource_collection(tenant_id=tenant_id, workspace_ids=retired_workspace_ids)

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
