"""Message ownership and history reads within the caller's bounded read session."""

from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.memory.token_buffer_memory import PreparedHistory, TokenBufferMemory
from models import Account, App, Conversation, EndUser, Message
from models.model import AppModelConfig
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageAccount, MessageActor
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageActorNotFoundError, MessageNotExistsError
from services.message_suggested_questions_service import SuggestedQuestionsContext


class SuggestedQuestionsRecords(NamedTuple):
    app: App
    conversation: Conversation


class MessageRepository:
    def __init__(self, session: Session) -> None:
        self._session: Session = session

    def get_context(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        message_id: str,
    ) -> SuggestedQuestionsRecords:
        app = self._session.scalar(select(App).where(App.id == app_id, App.tenant_id == app_owner_tenant_id))
        if app is None or app.mode != expected_app_mode:
            raise AppDefinitionUnavailableError(
                f"App {app_id} is unavailable in tenant {app_owner_tenant_id} with mode {expected_app_mode}"
            )

        account_id = None
        end_user_id = None
        if isinstance(actor, MessageAccount):
            account_id = actor.account_id
            if self._session.get(Account, account_id) is None:
                raise MessageActorNotFoundError(f"Account {account_id} no longer exists")
            source = "console"
        else:
            end_user_id = actor.end_user_id
            end_user = self._session.scalar(
                select(EndUser).where(
                    EndUser.id == end_user_id, EndUser.app_id == app_id, EndUser.tenant_id == app_owner_tenant_id
                )
            )
            if end_user is None:
                raise MessageActorNotFoundError(
                    f"End user {end_user_id} does not exist for app {app_id} in tenant {app_owner_tenant_id}"
                )
            source = "api"

        message = self._session.scalar(
            select(Message).where(
                Message.id == message_id,
                Message.app_id == app_id,
                Message.from_source == source,
                Message.from_account_id == account_id,
                Message.from_end_user_id == end_user_id,
            )
        )
        if message is None:
            raise MessageNotExistsError()

        conversation = self._session.scalar(
            select(Conversation).where(
                Conversation.id == message.conversation_id,
                Conversation.app_id == app_id,
                Conversation.from_source == source,
                Conversation.from_account_id == account_id,
                Conversation.from_end_user_id == end_user_id,
                Conversation.is_deleted.is_(False),
            )
        )
        if conversation is None:
            raise ConversationNotExistsError()
        return SuggestedQuestionsRecords(app, conversation)

    def get_model_config(self, *, app_id: str, config_id: str | None) -> AppModelConfig | None:
        """Return the app-owned configuration; a missing pointer or row returns None."""
        if config_id is None:
            return None
        return self._session.scalar(
            select(AppModelConfig).where(AppModelConfig.id == config_id, AppModelConfig.app_id == app_id)
        )

    def load_history(self, *, context: SuggestedQuestionsContext) -> PreparedHistory:
        # Model resolution separates the two read phases. Reload only the app
        # and conversation needed by the history reader, retaining their owner
        # scope without repeating actor and target-message admission queries.
        app = self._session.scalar(select(App).where(App.id == context.app_id, App.tenant_id == context.tenant_id))
        if app is None or app.mode != context.app_mode:
            raise AppDefinitionUnavailableError(
                f"App {context.app_id} is unavailable in tenant {context.tenant_id} with mode {context.app_mode}"
            )
        actor = context.actor
        account_id = actor.account_id if isinstance(actor, MessageAccount) else None
        end_user_id = None if isinstance(actor, MessageAccount) else actor.end_user_id
        conversation = self._session.scalar(
            select(Conversation).where(
                Conversation.id == context.conversation_id,
                Conversation.app_id == context.app_id,
                Conversation.from_source == ("console" if isinstance(actor, MessageAccount) else "api"),
                Conversation.from_account_id == account_id,
                Conversation.from_end_user_id == end_user_id,
                Conversation.is_deleted.is_(False),
            )
        )
        if conversation is None:
            raise ConversationNotExistsError()
        return TokenBufferMemory.load_history(
            conversation=conversation,
            app_record=app,
            session=self._session,
            message_limit=3,
        )
