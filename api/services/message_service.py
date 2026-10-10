import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import (
    App,
    EndUser,
    Message,
    MessageFeedback,
)
from repositories.execution_extra_content_repository import ExecutionExtraContentRepository
from repositories.sqlalchemy_execution_extra_content_repository import (
    SQLAlchemyExecutionExtraContentRepository,
)
from services.conversation_service import ConversationService
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
)

logger = logging.getLogger(__name__)


def _create_execution_extra_content_repository() -> ExecutionExtraContentRepository:
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    return SQLAlchemyExecutionExtraContentRepository(session_maker=session_maker)


def attach_message_extra_contents(messages: Sequence[Message]) -> None:
    if not messages:
        return

    repository = _create_execution_extra_content_repository()
    extra_contents_lists = repository.get_by_message_ids([message.id for message in messages])

    for index, message in enumerate(messages):
        contents = extra_contents_lists[index] if index < len(extra_contents_lists) else []
        message.set_extra_contents([content.model_dump(mode="json", exclude_none=True) for content in contents])


class MessageService:
    @classmethod
    def pagination_by_first_id(
        cls,
        app_model: App,
        user: Account | EndUser | None,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        order: str = "asc",
        *,
        session: Session,
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        if not conversation_id:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        conversation = ConversationService.get_conversation(
            app_model=app_model, user=user, conversation_id=conversation_id, session=session
        )

        fetch_limit = limit + 1

        if first_id:
            first_message = session.scalar(
                select(Message).where(Message.conversation_id == conversation.id, Message.id == first_id).limit(1)
            )

            if not first_message:
                raise FirstMessageNotExistsError()

            history_messages = session.scalars(
                select(Message)
                .where(
                    Message.conversation_id == conversation.id,
                    Message.created_at < first_message.created_at,
                    Message.id != first_message.id,
                )
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
            ).all()
        else:
            history_messages = session.scalars(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
            ).all()

        has_more = False
        if len(history_messages) > limit:
            has_more = True
            history_messages = history_messages[:-1]

        if order == "asc":
            history_messages = list(reversed(history_messages))

        attach_message_extra_contents(history_messages)

        return InfiniteScrollPagination(data=history_messages, limit=limit, has_more=has_more)

    @classmethod
    def pagination_by_last_id(
        cls,
        app_model: App,
        user: Account | EndUser | None,
        last_id: str | None,
        limit: int,
        conversation_id: str | None = None,
        include_ids: list | None = None,
        *,
        session: Session,
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        stmt = select(Message)

        fetch_limit = limit + 1

        if conversation_id is not None:
            conversation = ConversationService.get_conversation(
                app_model=app_model, user=user, conversation_id=conversation_id, session=session
            )

            stmt = stmt.where(Message.conversation_id == conversation.id)

        # Check if include_ids is not None and not empty to avoid WHERE false condition
        if include_ids is not None:
            if len(include_ids) == 0:
                return InfiniteScrollPagination(data=[], limit=limit, has_more=False)
            stmt = stmt.where(Message.id.in_(include_ids))

        if last_id:
            last_message = session.scalar(stmt.where(Message.id == last_id).limit(1))

            if not last_message:
                raise LastMessageNotExistsError()

            history_messages = session.scalars(
                stmt.where(Message.created_at < last_message.created_at, Message.id != last_message.id)
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
            ).all()
        else:
            history_messages = session.scalars(stmt.order_by(Message.created_at.desc()).limit(fetch_limit)).all()

        has_more = False
        if len(history_messages) > limit:
            has_more = True
            history_messages = history_messages[:-1]

        return InfiniteScrollPagination(data=history_messages, limit=limit, has_more=has_more)

    @classmethod
    def create_feedback(
        cls,
        *,
        app_model: App,
        message_id: str,
        user: Account | EndUser | None,
        rating: FeedbackRating | None,
        content: str | None,
        session: Session,
    ):
        if not user:
            raise ValueError("user cannot be None")

        message = cls.get_message(app_model=app_model, user=user, message_id=message_id, session=session)

        feedback = (
            message.user_feedback_with_session(session=session)
            if isinstance(user, EndUser)
            else message.admin_feedback_with_session(session=session)
        )

        if not rating and feedback:
            session.delete(feedback)
        elif rating and feedback:
            feedback.rating = rating
            feedback.content = content
        elif not rating and not feedback:
            raise ValueError("rating cannot be None when feedback not exists")
        else:
            assert rating is not None
            feedback = MessageFeedback(
                app_id=app_model.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=rating,
                content=content,
                from_source=(FeedbackFromSource.USER if isinstance(user, EndUser) else FeedbackFromSource.ADMIN),
                from_end_user_id=(user.id if isinstance(user, EndUser) else None),
                from_account_id=(user.id if isinstance(user, Account) else None),
            )
            session.add(feedback)

        session.commit()
        if rating:
            cls._emit_feedback_telemetry(
                app_model=app_model, message=message, user=user, rating=rating, content=content
            )

        return feedback

    @classmethod
    def _emit_feedback_telemetry(
        cls,
        *,
        app_model: App,
        message: Message,
        user: Account | EndUser,
        rating: FeedbackRating | None,
        content: str | None,
    ) -> None:
        try:
            from core.telemetry import FeedbackCreatedEvent, TelemetryContext, emit

            if message.id is None:
                return

            emit(
                FeedbackCreatedEvent(
                    context=TelemetryContext(tenant_id=app_model.tenant_id),
                    payload={
                        "message_id": message.id,
                        "app_id": app_model.id,
                        "conversation_id": message.conversation_id,
                        "from_end_user_id": user.id if isinstance(user, EndUser) else None,
                        "from_account_id": user.id if isinstance(user, Account) else None,
                        "rating": rating.value if rating else None,
                        "from_source": (
                            FeedbackFromSource.USER if isinstance(user, EndUser) else FeedbackFromSource.ADMIN
                        ).value,
                        "content": content,
                    },
                )
            )
        except Exception:
            logger.warning("Failed to emit feedback_created telemetry", exc_info=True)

    @classmethod
    def get_all_messages_feedbacks(cls, app_model: App, page: int, limit: int, *, session: Session):
        """Get all feedbacks of an app"""
        offset = (page - 1) * limit
        feedbacks = session.scalars(
            select(MessageFeedback)
            .where(MessageFeedback.app_id == app_model.id)
            .order_by(MessageFeedback.created_at.desc(), MessageFeedback.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()

        return [record.to_dict() for record in feedbacks]

    @classmethod
    def get_message(cls, app_model: App, user: Account | EndUser | None, message_id: str, *, session: Session):
        message = session.scalar(
            select(Message)
            .where(
                Message.id == message_id,
                Message.app_id == app_model.id,
                Message.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Message.from_account_id == (user.id if isinstance(user, Account) else None),
            )
            .limit(1)
        )

        if not message:
            raise MessageNotExistsError()

        return message
