import json
import logging
from collections.abc import Callable, Generator
from typing import Union

from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    AppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    ConversationAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    CompletionAppBlockingResponse,
    CompletionAppStreamResponse,
)
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.file_reference import resolve_file_record_id
from models import Account
from models.annotation_reply import AnnotationReplies
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message
from services.app.generation.adapters.message_pipeline import EasyUIBasedGenerateTaskPipeline
from services.app.generation.input_adapter import AppInputAdapter
from services.app.generation.ports import ChatRecords, ChatRecordSeed
from services.workflow.execution.ports import WorkflowRuntime

logger = logging.getLogger(__name__)


class MessageBasedAppGenerator(AppInputAdapter):
    def __init__(
        self,
        *,
        records: ChatRecords,
        annotations: AnnotationReplies,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
        workflow_runtime: WorkflowRuntime | None = None,
    ) -> None:
        super().__init__(draft_variable_saver=draft_variable_saver, workflow_runtime=workflow_runtime)
        self._records = records
        self._annotations = annotations

    def _handle_response(
        self,
        application_generate_entity: Union[
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
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
            records=self._records,
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
                logger.exception("Failed to handle response, conversation_id: %s", conversation.id)
                raise e

    def _get_app_model_config(self, app_model: App, conversation: Conversation | None = None) -> AppModelConfig:
        return self._records.model_config(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            config_id=conversation.app_model_config_id if conversation else app_model.app_model_config_id,
        )

    def _init_generate_records(
        self,
        application_generate_entity: Union[
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
            AgentChatAppGenerateEntity,
        ],
        conversation: Conversation | None = None,
    ) -> tuple[Conversation, Message]:
        """
        Initialize generate records
        :param application_generate_entity: application generate entity
        :conversation conversation
        :return:
        """
        app_config = application_generate_entity.app_config

        # get from source
        end_user_id = None
        account_id = None
        if application_generate_entity.invoke_from in {InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API}:
            from_source = ConversationFromSource.API
            end_user_id = application_generate_entity.user_id
        else:
            from_source = ConversationFromSource.CONSOLE
            account_id = application_generate_entity.user_id

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

        # get conversation name
        query = application_generate_entity.query or "New conversation"
        conversation_name = (query[:20] + "…") if len(query) > 20 else query

        created_new_conversation = conversation is None
        conversation, message = self._records.initialize(
            tenant_id=app_config.tenant_id,
            app_id=app_config.app_id,
            conversation_id=conversation.id if conversation else None,
            seed=ChatRecordSeed(
                conversation={
                    "app_model_config_id": app_model_config_id,
                    "model_provider": model_provider,
                    "model_id": model_id,
                    "override_model_configs": json.dumps(override_model_configs) if override_model_configs else None,
                    "mode": app_config.app_mode.value,
                    "name": conversation_name,
                    "inputs": application_generate_entity.inputs,
                    "introduction": introduction,
                    "system_instruction": "",
                    "system_instruction_tokens": 0,
                    "status": "normal",
                    "invoke_from": application_generate_entity.invoke_from.value,
                    "from_source": from_source,
                    "from_end_user_id": end_user_id,
                    "from_account_id": account_id,
                },
                message={
                    "model_provider": model_provider,
                    "model_id": model_id,
                    "override_model_configs": json.dumps(override_model_configs) if override_model_configs else None,
                    "inputs": application_generate_entity.inputs,
                    "query": application_generate_entity.query,
                    "message": "",
                    "message_tokens": 0,
                    "message_unit_price": 0,
                    "message_price_unit": 0,
                    "answer": "",
                    "answer_tokens": 0,
                    "answer_unit_price": 0,
                    "answer_price_unit": 0,
                    "parent_message_id": (
                        application_generate_entity.parent_message_id
                        if isinstance(application_generate_entity, ConversationAppGenerateEntity)
                        else None
                    ),
                    "provider_response_latency": 0,
                    "total_price": 0,
                    "currency": "USD",
                    "invoke_from": application_generate_entity.invoke_from.value,
                    "from_source": from_source,
                    "from_end_user_id": end_user_id,
                    "from_account_id": account_id,
                    "app_mode": app_config.app_mode,
                },
                files=[
                    {
                        "type": file.type,
                        "transfer_method": file.transfer_method,
                        "belongs_to": MessageFileBelongsTo.USER,
                        "url": file.remote_url,
                        "upload_file_id": resolve_file_record_id(file.reference),
                        "created_by_role": CreatorUserRole.ACCOUNT if account_id else CreatorUserRole.END_USER,
                        "created_by": account_id or end_user_id or "",
                    }
                    for file in application_generate_entity.files
                ],
            ),
        )
        if isinstance(application_generate_entity, ConversationAppGenerateEntity):
            application_generate_entity.conversation_id = conversation.id
            application_generate_entity.is_new_conversation = created_new_conversation
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
