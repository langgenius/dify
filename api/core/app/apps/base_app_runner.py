import logging
import time
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Optional, Union

from core.app.app_config.entities import ExternalDataVariableEntity, PromptTemplateEntity
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    AppGenerateEntity,
    EasyUIBasedAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.app.entities.queue_entities import QueueAgentMessageEvent, QueueLLMChunkEvent, QueueMessageEndEvent
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from core.app.features.hosting_moderation.hosting_moderation import HostingModerationFeature
from core.external_data_tool.external_data_fetch import ExternalDataFetch
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
)
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.moderation.input_moderation import InputModeration
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.prompt.simple_prompt_transform import ModelMode, SimplePromptTransform
from models.model import App, AppMode, Message, MessageAnnotation

if TYPE_CHECKING:
    from core.file.models import File

_logger = logging.getLogger(__name__)


class AppRunner:
    def recalc_llm_max_tokens(
        self, model_config: ModelConfigWithCredentialsEntity, prompt_messages: list[PromptMessage]
    ):
        # recalc max_tokens if sum(prompt_token +  max_tokens) over model token limit
        model_instance = ModelInstance(
            provider_model_bundle=model_config.provider_model_bundle, model=model_config.model
        )

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)

        max_tokens = 0
        for parameter_rule in model_config.model_schema.parameter_rules:
            if parameter_rule.name == "max_tokens" or (
                parameter_rule.use_template and parameter_rule.use_template == "max_tokens"
            ):
                max_tokens = (
                    model_config.parameters.get(parameter_rule.name)
                    or model_config.parameters.get(parameter_rule.use_template or "")
                ) or 0

        if model_context_tokens is None:
            return -1

        if max_tokens is None:
            max_tokens = 0

        prompt_tokens = model_instance.get_llm_num_tokens(prompt_messages)

        if prompt_tokens + max_tokens > model_context_tokens:
            max_tokens = max(model_context_tokens - prompt_tokens, 16)

            for parameter_rule in model_config.model_schema.parameter_rules:
                if parameter_rule.name == "max_tokens" or (
                    parameter_rule.use_template and parameter_rule.use_template == "max_tokens"
                ):
                    model_config.parameters[parameter_rule.name] = max_tokens

    def organize_prompt_messages(
        self,
        app_record: App,
        model_config: ModelConfigWithCredentialsEntity,
        prompt_template_entity: PromptTemplateEntity,
        inputs: Mapping[str, str],
        files: Sequence["File"],
        query: Optional[str] = None,
        context: Optional[str] = None,
        memory: Optional[TokenBufferMemory] = None,
        image_detail_config: Optional[ImagePromptMessageContent.DETAIL] = None,
    ) -> tuple[list[PromptMessage], Optional[list[str]]]:
        """
        Organize prompt messages
        :param context:
        :param app_record: app record
        :param model_config: model config entity
        :param prompt_template_entity: prompt template entity
        :param inputs: inputs
        :param files: files
        :param query: query
        :param memory: memory
        :param image_detail_config: the image quality config
        :return:
        """
        # get prompt without memory and context
        if prompt_template_entity.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
            prompt_transform: Union[SimplePromptTransform, AdvancedPromptTransform]
            prompt_transform = SimplePromptTransform()
            prompt_messages, stop = prompt_transform.get_prompt(
                app_mode=AppMode.value_of(app_record.mode),
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query or "",
                files=files,
                context=context,
                memory=memory,
                model_config=model_config,
                image_detail_config=image_detail_config,
            )
        else:
            memory_config = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False))

            model_mode = ModelMode.value_of(model_config.mode)
            prompt_template: Union[CompletionModelPromptTemplate, list[ChatModelMessage]]
            if model_mode == ModelMode.COMPLETION:
                advanced_completion_prompt_template = prompt_template_entity.advanced_completion_prompt_template
                if not advanced_completion_prompt_template:
                    raise InvokeBadRequestError("Advanced completion prompt template is required.")
                prompt_template = CompletionModelPromptTemplate(text=advanced_completion_prompt_template.prompt)

                if advanced_completion_prompt_template.role_prefix:
                    memory_config.role_prefix = MemoryConfig.RolePrefix(
                        user=advanced_completion_prompt_template.role_prefix.user,
                        assistant=advanced_completion_prompt_template.role_prefix.assistant,
                    )
            else:
                if not prompt_template_entity.advanced_chat_prompt_template:
                    raise InvokeBadRequestError("Advanced chat prompt template is required.")
                prompt_template = []
                for message in prompt_template_entity.advanced_chat_prompt_template.messages:
                    prompt_template.append(ChatModelMessage(text=message.text, role=message.role))

            prompt_transform = AdvancedPromptTransform()
            prompt_messages = prompt_transform.get_prompt(
                prompt_template=prompt_template,
                inputs=inputs,
                query=query or "",
                files=files,
                context=context,
                memory_config=memory_config,
                memory=memory,
                model_config=model_config,
                image_detail_config=image_detail_config,
            )
            stop = model_config.stop

        return prompt_messages, stop

    def direct_output(
        self,
        queue_manager: AppQueueManager,
        app_generate_entity: EasyUIBasedAppGenerateEntity,
        prompt_messages: list,
        text: str,
        stream: bool,
        usage: Optional[LLMUsage] = None,
    ) -> None:
        """
        Direct output
        :param queue_manager: application queue manager
        :param app_generate_entity: app generate entity
        :param prompt_messages: prompt messages
        :param text: text
        :param stream: stream
        :param usage: usage
        :return:
        """
        if stream:
            index = 0
            for token in text:
                chunk = LLMResultChunk(
                    model=app_generate_entity.model_conf.model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(index=index, message=AssistantPromptMessage(content=token)),
                )

                queue_manager.publish(QueueLLMChunkEvent(chunk=chunk), PublishFrom.APPLICATION_MANAGER)
                index += 1
                time.sleep(0.01)

        queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=LLMResult(
                    model=app_generate_entity.model_conf.model,
                    prompt_messages=prompt_messages,
                    message=AssistantPromptMessage(content=text),
                    usage=usage or LLMUsage.empty_usage(),
                ),
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _handle_invoke_result(
        self,
        invoke_result: Union[LLMResult, Generator[Any, None, None]],
        queue_manager: AppQueueManager,
        stream: bool,
        agent: bool = False,
    ) -> None:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :param queue_manager: application queue manager
        :param stream: stream
        :param agent: agent
        :return:
        """
        if not stream and isinstance(invoke_result, LLMResult):
            self._handle_invoke_result_direct(invoke_result=invoke_result, queue_manager=queue_manager, agent=agent)
        elif stream and isinstance(invoke_result, Generator):
            self._handle_invoke_result_stream(invoke_result=invoke_result, queue_manager=queue_manager, agent=agent)
        else:
            raise NotImplementedError(f"unsupported invoke result type: {type(invoke_result)}")

    def _handle_invoke_result_direct(
        self, invoke_result: LLMResult, queue_manager: AppQueueManager, agent: bool
    ) -> None:
        """
        Handle invoke result direct
        :param invoke_result: invoke result
        :param queue_manager: application queue manager
        :param agent: agent
        :return:
        """
        queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=invoke_result,
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _handle_invoke_result_stream(
        self, invoke_result: Generator[LLMResultChunk, None, None], queue_manager: AppQueueManager, agent: bool
    ) -> None:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :param queue_manager: application queue manager
        :param agent: agent
        :return:
        """
        model: str = ""
        prompt_messages: list[PromptMessage] = []
        text = ""
        usage = None
        for result in invoke_result:
            if not agent:
                queue_manager.publish(QueueLLMChunkEvent(chunk=result), PublishFrom.APPLICATION_MANAGER)
            else:
                queue_manager.publish(QueueAgentMessageEvent(chunk=result), PublishFrom.APPLICATION_MANAGER)

            message = result.delta.message
            if isinstance(message.content, str):
                text += message.content
            elif isinstance(message.content, list):
                for content in message.content:
                    if not isinstance(content, str):
                        # TODO(QuantumGhost): Add multimodal output support for easy ui.
                        _logger.warning("received multimodal output, type=%s", type(content))
                        text += content.data
                    else:
                        text += content  # failback to str

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = list(result.prompt_messages)

            if result.delta.usage:
                usage = result.delta.usage

        if usage is None:
            usage = LLMUsage.empty_usage()

        llm_result = LLMResult(
            model=model, prompt_messages=prompt_messages, message=AssistantPromptMessage(content=text), usage=usage
        )

        queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=llm_result,
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def moderation_for_inputs(
        self,
        *,
        app_id: str,
        tenant_id: str,
        app_generate_entity: AppGenerateEntity,
        inputs: Mapping[str, Any],
        query: str | None = None,
        message_id: str,
    ) -> tuple[bool, Mapping[str, Any], str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_generate_entity: app generate entity
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :return:
        """
        moderation_feature = InputModeration()
        return moderation_feature.check(
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_generate_entity.app_config,
            inputs=dict(inputs),
            query=query or "",
            message_id=message_id,
            trace_manager=app_generate_entity.trace_manager,
        )

    def check_hosting_moderation(
        self,
        application_generate_entity: EasyUIBasedAppGenerateEntity,
        queue_manager: AppQueueManager,
        prompt_messages: list[PromptMessage],
    ) -> bool:
        """
        Check hosting moderation
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param prompt_messages: prompt messages
        :return:
        """
        hosting_moderation_feature = HostingModerationFeature()
        moderation_result = hosting_moderation_feature.check(
            application_generate_entity=application_generate_entity, prompt_messages=prompt_messages
        )

        if moderation_result:
            self.direct_output(
                queue_manager=queue_manager,
                app_generate_entity=application_generate_entity,
                prompt_messages=prompt_messages,
                text="I apologize for any confusion, but I'm an AI assistant to be helpful, harmless, and honest.",
                stream=application_generate_entity.stream,
            )

        return moderation_result

    def fill_in_inputs_from_external_data_tools(
        self,
        tenant_id: str,
        app_id: str,
        external_data_tools: list[ExternalDataVariableEntity],
        inputs: Mapping[str, Any],
        query: str,
    ) -> Mapping[str, Any]:
        """
        Fill in variable inputs from external data tools if exists.

        :param tenant_id: workspace id
        :param app_id: app id
        :param external_data_tools: external data tools configs
        :param inputs: the inputs
        :param query: the query
        :return: the filled inputs
        """
        external_data_fetch_feature = ExternalDataFetch()
        return external_data_fetch_feature.fetch(
            tenant_id=tenant_id, app_id=app_id, external_data_tools=external_data_tools, inputs=inputs, query=query
        )

    def query_app_annotations_to_reply(
        self, app_record: App, message: Message, query: str, user_id: str, invoke_from: InvokeFrom
    ) -> Optional[MessageAnnotation]:
        """
        Query app annotations to reply
        :param app_record: app record
        :param message: message
        :param query: query
        :param user_id: user id
        :param invoke_from: invoke from
        :return:
        """
        annotation_reply_feature = AnnotationReplyFeature()
        return annotation_reply_feature.query(
            app_record=app_record, message=message, query=query, user_id=user_id, invoke_from=invoke_from
        )
