import json
import logging
from collections.abc import Generator
from datetime import UTC, datetime
from typing import Optional, Union, cast

from sqlalchemy import and_

from core.app.app_config.entities import EasyUIBasedAppConfig, EasyUIBasedAppModelConfigFrom
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    AgentChatAppGenerateEntity,
    AppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    CompletionAppBlockingResponse,
    CompletionAppStreamResponse,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from extensions.ext_database import db
from models import Account
from models.enums import CreatedByRole
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message, MessageFile
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError

logger = logging.getLogger(__name__)


class MessageBasedAppGenerator(BaseAppGenerator):
    def _handle_response(
        self,
        application_generate_entity: Union[
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
            AgentChatAppGenerateEntity,
            AgentChatAppGenerateEntity,
        ],
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Union[Account, EndUser],
        stream: bool = False,
    ) -> Union[
        ChatbotAppBlockingResponse,
        CompletionAppBlockingResponse,
        Generator[Union[ChatbotAppStreamResponse, CompletionAppStreamResponse], None, None],
    ]:
        """
        Handle response.
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param user: user
        :param stream: is stream
        :return:
        """
        # init generate task pipeline
        generate_task_pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            stream=stream,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if len(e.args) > 0 and e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedError()
            else:
                logger.exception(f"Failed to handle response, conversation_id: {conversation.id}")
                raise e

    def _get_conversation_by_user(
        self, app_model: App, conversation_id: str, user: Union[Account, EndUser]
    ) -> Conversation:
        conversation_filter = [
            Conversation.id == conversation_id,
            Conversation.app_id == app_model.id,
            Conversation.status == "normal",
            Conversation.is_deleted.is_(False),
        ]

        if isinstance(user, Account):
            conversation_filter.append(Conversation.from_account_id == user.id)
        else:
            conversation_filter.append(Conversation.from_end_user_id == user.id if user else None)

        conversation = db.session.query(Conversation).filter(and_(*conversation_filter)).first()

        if not conversation:
            raise ConversationNotExistsError()

        if conversation.status != "normal":
            raise ConversationCompletedError()

        return conversation

    def _get_app_model_config(self, app_model: App, conversation: Optional[Conversation] = None) -> AppModelConfig:
        if conversation:
            app_model_config = (
                db.session.query(AppModelConfig)
                .filter(AppModelConfig.id == conversation.app_model_config_id, AppModelConfig.app_id == app_model.id)
                .first()
            )

            if not app_model_config:
                raise AppModelConfigBrokenError()
        else:
            if app_model.app_model_config_id is None:
                raise AppModelConfigBrokenError()

            app_model_config = app_model.app_model_config

            if not app_model_config:
                raise AppModelConfigBrokenError()

        return app_model_config

    def _init_generate_records(
        self,
        application_generate_entity: Union[
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
            AgentChatAppGenerateEntity,
            AdvancedChatAppGenerateEntity,
        ],
        conversation: Optional[Conversation] = None,
    ) -> tuple[Conversation, Message]:
        """
        Initialize generate records
        :param application_generate_entity: application generate entity
        :conversation conversation
        :return:
        """
        app_config: EasyUIBasedAppConfig = cast(EasyUIBasedAppConfig, application_generate_entity.app_config)

        # get from source
        end_user_id = None
        account_id = None
        if application_generate_entity.invoke_from in {InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API}:
            from_source = "api"
            end_user_id = application_generate_entity.user_id
        else:
            from_source = "console"
            account_id = application_generate_entity.user_id

        if isinstance(application_generate_entity, AdvancedChatAppGenerateEntity):
            app_model_config_id = None
            override_model_configs = None
            model_provider = None
            model_id = None
        else:
            app_model_config_id = app_config.app_model_config_id
            model_provider = application_generate_entity.model_conf.provider
            model_id = application_generate_entity.model_conf.model
            override_model_configs = None
            if app_config.app_model_config_from == EasyUIBasedAppModelConfigFrom.ARGS and app_config.app_mode in {
                AppMode.AGENT_CHAT,
                AppMode.CHAT,
                AppMode.COMPLETION,
            }:
                override_model_configs = app_config.app_model_config_dict

        # get conversation introduction
        introduction = self._get_conversation_introduction(application_generate_entity)

        if not conversation:
            conversation = Conversation(
                app_id=app_config.app_id,
                app_model_config_id=app_model_config_id,
                model_provider=model_provider,
                model_id=model_id,
                override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
                mode=app_config.app_mode.value,
                name="New conversation",
                inputs=application_generate_entity.inputs,
                introduction=introduction,
                system_instruction="",
                system_instruction_tokens=0,
                status="normal",
                invoke_from=application_generate_entity.invoke_from.value,
                from_source=from_source,
                from_end_user_id=end_user_id,
                from_account_id=account_id,
            )

            db.session.add(conversation)
            db.session.commit()
            db.session.refresh(conversation)
        else:
            conversation.updated_at = datetime.now(UTC).replace(tzinfo=None)
            db.session.commit()

        message = Message(
            app_id=app_config.app_id,
            model_provider=model_provider,
            model_id=model_id,
            override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
            conversation_id=conversation.id,
            inputs=application_generate_entity.inputs,
            query=application_generate_entity.query or "",
            message="",
            message_tokens=0,
            message_unit_price=0,
            message_price_unit=0,
            answer="",
            answer_tokens=0,
            answer_unit_price=0,
            answer_price_unit=0,
            parent_message_id=getattr(application_generate_entity, "parent_message_id", None),
            provider_response_latency=0,
            total_price=0,
            currency="USD",
            invoke_from=application_generate_entity.invoke_from.value,
            from_source=from_source,
            from_end_user_id=end_user_id,
            from_account_id=account_id,
        )

        db.session.add(message)
        db.session.commit()
        db.session.refresh(message)

        for file in application_generate_entity.files:
            message_file = MessageFile(
                message_id=message.id,
                type=file.type,
                transfer_method=file.transfer_method,
                belongs_to="user",
                url=file.remote_url,
                upload_file_id=file.related_id,
                created_by_role=(CreatedByRole.ACCOUNT if account_id else CreatedByRole.END_USER),
                created_by=account_id or end_user_id or "",
            )
            db.session.add(message_file)
            db.session.commit()

        return conversation, message

    def _get_conversation_introduction(self, application_generate_entity: AppGenerateEntity) -> str:
        """
        Get conversation introduction
        :param application_generate_entity: application generate entity
        :return: conversation introduction
        """
        app_config = application_generate_entity.app_config
        introduction = app_config.additional_features.opening_statement

        if introduction:
            try:
                inputs = application_generate_entity.inputs
                prompt_template = PromptTemplateParser(template=introduction)
                prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
                introduction = prompt_template.format(prompt_inputs)
            except KeyError:
                pass

        return introduction or ""

    def _get_conversation(self, conversation_id: str):
        """
        Get conversation by conversation id
        :param conversation_id: conversation id
        :return: conversation
        """
        conversation = db.session.query(Conversation).filter(Conversation.id == conversation_id).first()

        if not conversation:
            raise ConversationNotExistsError()

        return conversation

    def _get_message(self, message_id: str) -> Optional[Message]:
        """
        Get message by message id
        :param message_id: message id
        :return: message
        """
        message = db.session.query(Message).filter(Message.id == message_id).first()

        return message
