import json
from typing import Union

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.llm_generator.llm_generator import LLMGenerator
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.model import App, AppMode, AppModelConfig, EndUser, Message, MessageFeedback
from services.conversation_service import ConversationService
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.workflow_service import WorkflowService


class MessageService:
    @classmethod
    def pagination_by_first_id(
        cls,
        app_model: App,
        user: Union[Account, EndUser] | None,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        order: str = "asc",
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        if not conversation_id:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        conversation = ConversationService.get_conversation(
            app_model=app_model, user=user, conversation_id=conversation_id
        )

        fetch_limit = limit + 1

        if first_id:
            first_message = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id, Message.id == first_id)
                .first()
            )

            if not first_message:
                raise FirstMessageNotExistsError()

            history_messages = (
                db.session.query(Message)
                .where(
                    Message.conversation_id == conversation.id,
                    Message.created_at < first_message.created_at,
                    Message.id != first_message.id,
                )
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
                .all()
            )
        else:
            history_messages = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
                .all()
            )

        has_more = False
        if len(history_messages) > limit:
            has_more = True
            history_messages = history_messages[:-1]

        if order == "asc":
            history_messages = list(reversed(history_messages))

        return InfiniteScrollPagination(data=history_messages, limit=limit, has_more=has_more)

    @classmethod
    def pagination_by_last_id(
        cls,
        app_model: App,
        user: Union[Account, EndUser] | None,
        last_id: str | None,
        limit: int,
        conversation_id: str | None = None,
        include_ids: list | None = None,
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        base_query = db.session.query(Message)

        fetch_limit = limit + 1

        if conversation_id is not None:
            conversation = ConversationService.get_conversation(
                app_model=app_model, user=user, conversation_id=conversation_id
            )

            base_query = base_query.where(Message.conversation_id == conversation.id)

        # Check if include_ids is not None and not empty to avoid WHERE false condition
        if include_ids is not None:
            if len(include_ids) == 0:
                return InfiniteScrollPagination(data=[], limit=limit, has_more=False)
            base_query = base_query.where(Message.id.in_(include_ids))

        if last_id:
            last_message = base_query.where(Message.id == last_id).first()

            if not last_message:
                raise LastMessageNotExistsError()

            history_messages = (
                base_query.where(Message.created_at < last_message.created_at, Message.id != last_message.id)
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
                .all()
            )
        else:
            history_messages = base_query.order_by(Message.created_at.desc()).limit(fetch_limit).all()

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
        user: Union[Account, EndUser] | None,
        rating: str | None,
        content: str | None,
    ):
        if not user:
            raise ValueError("user cannot be None")

        message = cls.get_message(app_model=app_model, user=user, message_id=message_id)

        feedback = message.user_feedback if isinstance(user, EndUser) else message.admin_feedback

        if not rating and feedback:
            db.session.delete(feedback)
        elif rating and feedback:
            feedback.rating = rating
            feedback.content = content
        elif not rating and not feedback:
            raise ValueError("rating cannot be None when feedback not exists")
        else:
            feedback = MessageFeedback(
                app_id=app_model.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=rating,
                content=content,
                from_source=("user" if isinstance(user, EndUser) else "admin"),
                from_end_user_id=(user.id if isinstance(user, EndUser) else None),
                from_account_id=(user.id if isinstance(user, Account) else None),
            )
            db.session.add(feedback)

        db.session.commit()

        return feedback

    @classmethod
    def get_all_messages_feedbacks(cls, app_model: App, page: int, limit: int):
        """Get all feedbacks of an app"""
        offset = (page - 1) * limit
        feedbacks = (
            db.session.query(MessageFeedback)
            .where(MessageFeedback.app_id == app_model.id)
            .order_by(MessageFeedback.created_at.desc(), MessageFeedback.id.desc())
            .limit(limit)
            .offset(offset)
            .all()
        )

        return [record.to_dict() for record in feedbacks]

    @classmethod
    def get_message(cls, app_model: App, user: Union[Account, EndUser] | None, message_id: str):
        message = (
            db.session.query(Message)
            .where(
                Message.id == message_id,
                Message.app_id == app_model.id,
                Message.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Message.from_account_id == (user.id if isinstance(user, Account) else None),
            )
            .first()
        )

        if not message:
            raise MessageNotExistsError()

        return message

    @classmethod
    def get_suggested_questions_after_answer(
        cls, app_model: App, user: Union[Account, EndUser] | None, message_id: str, invoke_from: InvokeFrom
    ) -> list[str]:
        if not user:
            raise ValueError("user cannot be None")

        message = cls.get_message(app_model=app_model, user=user, message_id=message_id)

        conversation = ConversationService.get_conversation(
            app_model=app_model, conversation_id=message.conversation_id, user=user
        )

        model_manager = ModelManager()

        if app_model.mode == AppMode.ADVANCED_CHAT:
            workflow_service = WorkflowService()
            if invoke_from == InvokeFrom.DEBUGGER:
                workflow = workflow_service.get_draft_workflow(app_model=app_model)
            else:
                workflow = workflow_service.get_published_workflow(app_model=app_model)

            if workflow is None:
                return []

            app_config = AdvancedChatAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

            if not app_config.additional_features:
                raise ValueError("Additional features not found")

            if not app_config.additional_features.suggested_questions_after_answer:
                raise SuggestedQuestionsAfterAnswerDisabledError()

            model_instance = model_manager.get_default_model_instance(
                tenant_id=app_model.tenant_id, model_type=ModelType.LLM
            )
        else:
            if not conversation.override_model_configs:
                app_model_config = (
                    db.session.query(AppModelConfig)
                    .where(AppModelConfig.id == conversation.app_model_config_id, AppModelConfig.app_id == app_model.id)
                    .first()
                )
            else:
                conversation_override_model_configs = json.loads(conversation.override_model_configs)
                app_model_config = AppModelConfig(
                    id=conversation.app_model_config_id,
                    app_id=app_model.id,
                )

                app_model_config = app_model_config.from_model_config_dict(conversation_override_model_configs)
            if not app_model_config:
                raise ValueError("did not find app model config")

            suggested_questions_after_answer = app_model_config.suggested_questions_after_answer_dict
            if suggested_questions_after_answer.get("enabled", False) is False:
                raise SuggestedQuestionsAfterAnswerDisabledError()

            model_instance = model_manager.get_model_instance(
                tenant_id=app_model.tenant_id,
                provider=app_model_config.model_dict["provider"],
                model_type=ModelType.LLM,
                model=app_model_config.model_dict["name"],
            )

        # get memory of conversation (read-only)
        memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        histories = memory.get_history_prompt_text(
            max_token_limit=3000,
            message_limit=3,
        )

        with measure_time() as timer:
            questions_sequence = LLMGenerator.generate_suggested_questions_after_answer(
                tenant_id=app_model.tenant_id, histories=histories
            )
            questions: list[str] = list(questions_sequence)

        # get tracing instance
        trace_manager = TraceQueueManager(app_id=app_model.id)
        trace_manager.add_trace_task(
            TraceTask(
                TraceTaskName.SUGGESTED_QUESTION_TRACE, message_id=message_id, suggested_question=questions, timer=timer
            )
        )

        return questions
