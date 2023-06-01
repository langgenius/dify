from typing import Optional, Union, List

from core.completion import Completion
from core.generator.llm_generator import LLMGenerator
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from extensions.ext_database import db
from models.account import Account
from models.model import App, EndUser, Message, MessageFeedback
from services.conversation_service import ConversationService
from services.errors.message import FirstMessageNotExistsError, MessageNotExistsError, LastMessageNotExistsError, \
    SuggestedQuestionsAfterAnswerDisabledError


class MessageService:
    @classmethod
    def pagination_by_first_id(cls, app_model: App, user: Optional[Union[Account | EndUser]],
                               conversation_id: str, first_id: Optional[str], limit: int) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        if not conversation_id:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        conversation = ConversationService.get_conversation(
            app_model=app_model,
            user=user,
            conversation_id=conversation_id
        )

        if first_id:
            first_message = db.session.query(Message) \
                .filter(Message.conversation_id == conversation.id, Message.id == first_id).first()

            if not first_message:
                raise FirstMessageNotExistsError()

            history_messages = db.session.query(Message).filter(
                Message.conversation_id == conversation.id,
                Message.created_at < first_message.created_at,
                Message.id != first_message.id
            ) \
                .order_by(Message.created_at.desc()).limit(limit).all()
        else:
            history_messages = db.session.query(Message).filter(Message.conversation_id == conversation.id) \
                .order_by(Message.created_at.desc()).limit(limit).all()

        has_more = False
        if len(history_messages) == limit:
            current_page_first_message = history_messages[-1]
            rest_count = db.session.query(Message).filter(
                Message.conversation_id == conversation.id,
                Message.created_at < current_page_first_message.created_at,
                Message.id != current_page_first_message.id
            ).count()

            if rest_count > 0:
                has_more = True

        history_messages = list(reversed(history_messages))

        return InfiniteScrollPagination(
            data=history_messages,
            limit=limit,
            has_more=has_more
        )

    @classmethod
    def pagination_by_last_id(cls, app_model: App, user: Optional[Union[Account | EndUser]],
                              last_id: Optional[str], limit: int, conversation_id: Optional[str] = None,
                              include_ids: Optional[list] = None) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        base_query = db.session.query(Message)

        if conversation_id is not None:
            conversation = ConversationService.get_conversation(
                app_model=app_model,
                user=user,
                conversation_id=conversation_id
            )

            base_query = base_query.filter(Message.conversation_id == conversation.id)

        if include_ids is not None:
            base_query = base_query.filter(Message.id.in_(include_ids))

        if last_id:
            last_message = base_query.filter(Message.id == last_id).first()

            if not last_message:
                raise LastMessageNotExistsError()

            history_messages = base_query.filter(
                Message.created_at < last_message.created_at,
                Message.id != last_message.id
            ).order_by(Message.created_at.desc()).limit(limit).all()
        else:
            history_messages = base_query.order_by(Message.created_at.desc()).limit(limit).all()

        has_more = False
        if len(history_messages) == limit:
            current_page_first_message = history_messages[-1]
            rest_count = base_query.filter(
                Message.created_at < current_page_first_message.created_at,
                Message.id != current_page_first_message.id
            ).count()

            if rest_count > 0:
                has_more = True

        return InfiniteScrollPagination(
            data=history_messages,
            limit=limit,
            has_more=has_more
        )

    @classmethod
    def create_feedback(cls, app_model: App, message_id: str, user: Optional[Union[Account | EndUser]],
                        rating: Optional[str]) -> MessageFeedback:
        if not user:
            raise ValueError('user cannot be None')

        message = cls.get_message(
            app_model=app_model,
            user=user,
            message_id=message_id
        )

        feedback = message.user_feedback if isinstance(user, EndUser) else message.admin_feedback

        if not rating and feedback:
            db.session.delete(feedback)
        elif rating and feedback:
            feedback.rating = rating
        elif not rating and not feedback:
            raise ValueError('rating cannot be None when feedback not exists')
        else:
            feedback = MessageFeedback(
                app_id=app_model.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=rating,
                from_source=('user' if isinstance(user, EndUser) else 'admin'),
                from_end_user_id=(user.id if isinstance(user, EndUser) else None),
                from_account_id=(user.id if isinstance(user, Account) else None),
            )
            db.session.add(feedback)

        db.session.commit()

        return feedback

    @classmethod
    def get_message(cls, app_model: App, user: Optional[Union[Account | EndUser]], message_id: str):
        message = db.session.query(Message).filter(
            Message.id == message_id,
            Message.app_id == app_model.id,
            Message.from_source == ('api' if isinstance(user, EndUser) else 'console'),
            Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
            Message.from_account_id == (user.id if isinstance(user, Account) else None),
        ).first()

        if not message:
            raise MessageNotExistsError()

        return message

    @classmethod
    def get_suggested_questions_after_answer(cls, app_model: App, user: Optional[Union[Account | EndUser]],
                                             message_id: str, check_enabled: bool = True) -> List[Message]:
        if not user:
            raise ValueError('user cannot be None')

        app_model_config = app_model.app_model_config
        suggested_questions_after_answer = app_model_config.suggested_questions_after_answer_dict

        if check_enabled and suggested_questions_after_answer.get("enabled", False) is False:
            raise SuggestedQuestionsAfterAnswerDisabledError()

        message = cls.get_message(
            app_model=app_model,
            user=user,
            message_id=message_id
        )

        conversation = ConversationService.get_conversation(
            app_model=app_model,
            conversation_id=message.conversation_id,
            user=user
        )

        # get memory of conversation (read-only)
        memory = Completion.get_memory_from_conversation(
            tenant_id=app_model.tenant_id,
            app_model_config=app_model.app_model_config,
            conversation=conversation,
            max_token_limit=3000,
            message_limit=3,
            return_messages=False,
            memory_key="histories"
        )

        external_context = memory.load_memory_variables({})

        questions = LLMGenerator.generate_suggested_questions_after_answer(
            tenant_id=app_model.tenant_id,
            **external_context
        )

        return questions

