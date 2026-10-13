import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.llm_generator.llm_generator import LLMGenerator
from core.model_context import use_credit_usage_metadata
from models import Account
from models.model import App, Conversation, EndUser
from repositories.conversation_lifecycle import retire_conversation
from services.errors.conversation import ConversationNotExistsError
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.delete_conversation_task import delete_conversation_related_data

logger = logging.getLogger(__name__)


class ConversationService:
    @staticmethod
    def generate_name(*, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
        """Generate a conversation title with the appropriate credit usage metadata."""
        with use_credit_usage_metadata({"app_type": get_credit_usage_app_type(app_mode)}):
            return LLMGenerator.generate_conversation_name(tenant_id, query, conversation_id, app_id)

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
                Conversation.is_deleted == False,
            )
            .limit(1)
        )

        if not conversation:
            raise ConversationNotExistsError()

        return conversation

    @classmethod
    def delete(cls, app_model: App, conversation_id: str, user: Account | EndUser | None, *, session: Session) -> None:
        """
        Delete a conversation only if it belongs to the given user and app context.

        Conversation deletion is the product lifecycle boundary for its
        Workspace. Physical collection happens only after the retire commit.

        Raises:
            ConversationNotExistsError: When the conversation is not visible to the current user.
        """
        conversation = cls.get_conversation(app_model, conversation_id, user, session=session)
        tenant_id = app_model.tenant_id
        try:
            retired_workspace_ids = retire_conversation(app_model=app_model, conversation=conversation, session=session)
            session.commit()
        except Exception:
            session.rollback()
            raise
        cls.enqueue_delete_cleanup(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            retired_workspace_ids=retired_workspace_ids,
        )

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
