"""Persist and materialize messages within an admitted installation."""

from typing import cast, override

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import App, Conversation, InstalledApp, Message, MessageAgentThought, MessageFeedback
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import FirstMessageNotExistsError, MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_message_service import (
    FeedbackRatingRequiredError,
    InstalledAppMessageStore,
    MessageAgentThoughtRecord,
    MessageFeedbackEvent,
    MessageFeedbackRecord,
    MessageFileRecord,
    MessageInputValue,
    MessagePage,
    MessageRating,
    MessageRecord,
)


class SQLAlchemyInstalledAppMessageRepository(InstalledAppMessageStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def get_page(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage:
        with self._session_factory() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            if not conversation_id:
                return MessagePage(limit=limit, has_more=False, data=())
            conversation = session.scalar(
                select(Conversation).where(
                    Conversation.id == conversation_id,
                    Conversation.app_id == app.id,
                    Conversation.from_source == ConversationFromSource.CONSOLE,
                    Conversation.from_account_id == account_id,
                    Conversation.from_end_user_id.is_(None),
                    Conversation.is_deleted.is_(False),
                )
            )
            if conversation is None:
                raise ConversationNotExistsError(
                    f"Conversation {conversation_id} does not belong to this account and app."
                )
            statement = select(Message).where(Message.conversation_id == conversation.id)
            if first_id:
                first_message = session.scalar(statement.where(Message.id == first_id))
                if first_message is None:
                    raise FirstMessageNotExistsError(
                        f"The first_id cursor {first_id} does not belong to conversation {conversation_id}."
                    )
                statement = statement.where(
                    Message.created_at < first_message.created_at, Message.id != first_message.id
                )
            messages = list(session.scalars(statement.order_by(Message.created_at.desc()).limit(limit + 1)).all())
            has_more = len(messages) > limit
            # Preserve ascending presentation of each newest-first page and the
            # existing strict timestamp cursor, including tied timestamps.
            messages = messages[:limit]
            messages.reverse()
            return MessagePage(
                limit=limit,
                has_more=has_more,
                data=tuple(self._to_record(message=message, session=session) for message in messages),
            )

    @override
    def set_feedback(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        message_id: str,
        rating: MessageRating | None,
        content: str | None,
    ) -> MessageFeedbackEvent | None:
        with self._session_factory.begin() as session:
            app = self._get_app(session=session, installed_app=installed_app)
            message = session.scalar(
                select(Message).where(
                    Message.id == message_id,
                    Message.app_id == app.id,
                    Message.from_source == ConversationFromSource.CONSOLE,
                    Message.from_account_id == account_id,
                    Message.from_end_user_id.is_(None),
                )
            )
            if message is None:
                raise MessageNotExistsError(f"Message {message_id} does not belong to this account and app.")
            feedback = message.admin_feedback_with_session(session=session)
            if rating is None:
                if feedback is None:
                    raise FeedbackRatingRequiredError(
                        f"Message {message_id} has no admin feedback to remove; a rating is required."
                    )
                session.delete(feedback)
                return None
            if feedback is None:
                session.add(
                    MessageFeedback(
                        app_id=app.id,
                        conversation_id=message.conversation_id,
                        message_id=message.id,
                        rating=FeedbackRating(rating),
                        content=content,
                        from_source=FeedbackFromSource.ADMIN,
                        from_end_user_id=None,
                        from_account_id=account_id,
                    )
                )
            else:
                feedback.rating = FeedbackRating(rating)
                feedback.content = content
            return MessageFeedbackEvent(
                tenant_id=app.tenant_id,
                app_id=app.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                account_id=account_id,
                rating=rating,
                content=content,
            )

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
    def _to_record(*, message: Message, session: Session) -> MessageRecord:
        # Retain model input/file restoration (including its file I/O and legacy
        # commit) until that boundary is migrated; do not recreate the file factory.
        inputs = cast(dict[str, MessageInputValue], message.inputs_with_session(session=session))
        feedback = message.user_feedback_with_session(session=session)
        thoughts = [
            SQLAlchemyInstalledAppMessageRepository._thought_record(thought)
            for thought in message.agent_thoughts_with_session(session=session)
        ]
        files = [
            MessageFileRecord(
                id=file["id"],
                filename=file["filename"],
                type=file["type"],
                url=file.get("url"),
                mime_type=file.get("mime_type"),
                size=file.get("size"),
                transfer_method=file["transfer_method"],
                belongs_to=file.get("belongs_to"),
                upload_file_id=file.get("upload_file_id"),
            )
            for file in message.message_files_with_session(session=session)
        ]
        return MessageRecord(
            id=message.id,
            conversation_id=message.conversation_id,
            parent_message_id=message.parent_message_id,
            inputs=inputs,
            query=message.query,
            answer=message.re_sign_file_url_answer,
            feedback=MessageFeedbackRecord(rating=feedback.rating.value) if feedback is not None else None,
            retriever_resources=cast(list[dict[str, JsonValue]] | None, message.retriever_resources),
            created_at=message.created_at,
            agent_thoughts=thoughts,
            message_files=files,
            message_tokens=message.message_tokens,
            answer_tokens=message.answer_tokens,
            provider_response_latency=message.provider_response_latency,
            total_price=message.total_price,
            currency=message.currency,
            status=message.status.value,
            error=message.error,
            metadata=cast(JsonValue, message.message_metadata_dict),
        )

    @staticmethod
    def _thought_record(thought: MessageAgentThought) -> MessageAgentThoughtRecord:
        return MessageAgentThoughtRecord(
            id=thought.id,
            message_id=thought.message_id,
            message_chain_id=thought.message_chain_id,
            position=thought.position,
            thought=thought.thought,
            answer=thought.answer,
            tool=thought.tool,
            tool_labels=cast(JsonValue, thought.tool_labels),
            tool_input=thought.tool_input,
            created_at=thought.created_at,
            observation=thought.observation,
            files=cast(list[str], thought.files),
        )
