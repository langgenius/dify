import time
from typing import cast, Optional, List, Tuple, Generator, Union

from core.application_queue_manager import ApplicationQueueManager, PublishFrom
from core.entities.application_entities import ModelConfigEntity, PromptTemplateEntity, AppOrchestrationConfigEntity
from core.file.file_obj import FileObj
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import PromptMessage, AssistantPromptMessage
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.prompt_transform import PromptTransform
from models.model import App


class AppRunner:
    def get_pre_calculate_rest_tokens(self, app_record: App,
                                      model_config: ModelConfigEntity,
                                      prompt_template_entity: PromptTemplateEntity,
                                      inputs: dict[str, str],
                                      files: list[FileObj],
                                      query: Optional[str] = None) -> int:
        """
        Get pre calculate rest tokens
        :param app_record: app record
        :param model_config: model config entity
        :param prompt_template_entity: prompt template entity
        :param inputs: inputs
        :param files: files
        :param query: query
        :return:
        """
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)

        max_tokens = 0
        for parameter_rule in model_config.model_schema.parameter_rules:
            if (parameter_rule.name == 'max_tokens'
                    or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                max_tokens = (model_config.parameters.get(parameter_rule.name)
                              or model_config.parameters.get(parameter_rule.use_template)) or 0

        if model_context_tokens is None:
            return -1

        if max_tokens is None:
            max_tokens = 0

        # get prompt messages without memory and context
        prompt_messages, stop = self.organize_prompt_messages(
            app_record=app_record,
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs=inputs,
            files=files,
            query=query
        )

        prompt_tokens = model_type_instance.get_num_tokens(
            model_config.model,
            model_config.credentials,
            prompt_messages
        )

        rest_tokens = model_context_tokens - max_tokens - prompt_tokens
        if rest_tokens < 0:
            raise InvokeBadRequestError("Query or prefix prompt is too long, you can reduce the prefix prompt, "
                                        "or shrink the max token, or switch to a llm with a larger token limit size.")

        return rest_tokens

    def recale_llm_max_tokens(self, model_config: ModelConfigEntity,
                              prompt_messages: List[PromptMessage]):
        # recalc max_tokens if sum(prompt_token +  max_tokens) over model token limit
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)

        max_tokens = 0
        for parameter_rule in model_config.model_schema.parameter_rules:
            if (parameter_rule.name == 'max_tokens'
                    or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                max_tokens = (model_config.parameters.get(parameter_rule.name)
                              or model_config.parameters.get(parameter_rule.use_template)) or 0

        if model_context_tokens is None:
            return -1

        if max_tokens is None:
            max_tokens = 0

        prompt_tokens = model_type_instance.get_num_tokens(
            model_config.model,
            model_config.credentials,
            prompt_messages
        )

        if prompt_tokens + max_tokens > model_context_tokens:
            max_tokens = max(model_context_tokens - prompt_tokens, 16)

            for parameter_rule in model_config.model_schema.parameter_rules:
                if (parameter_rule.name == 'max_tokens'
                        or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                    model_config.parameters[parameter_rule.name] = max_tokens

    def organize_prompt_messages(self, app_record: App,
                                 model_config: ModelConfigEntity,
                                 prompt_template_entity: PromptTemplateEntity,
                                 inputs: dict[str, str],
                                 files: list[FileObj],
                                 query: Optional[str] = None,
                                 context: Optional[str] = None,
                                 memory: Optional[TokenBufferMemory] = None) \
            -> Tuple[List[PromptMessage], Optional[List[str]]]:
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
        :return:
        """
        prompt_transform = PromptTransform()

        # get prompt without memory and context
        if prompt_template_entity.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
            prompt_messages, stop = prompt_transform.get_prompt(
                app_mode=app_record.mode,
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query if query else '',
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )
        else:
            prompt_messages = prompt_transform.get_advanced_prompt(
                app_mode=app_record.mode,
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )
            stop = model_config.stop

        return prompt_messages, stop

    def direct_output(self, queue_manager: ApplicationQueueManager,
                      app_orchestration_config: AppOrchestrationConfigEntity,
                      prompt_messages: list,
                      text: str,
                      stream: bool,
                      usage: Optional[LLMUsage] = None) -> None:
        """
        Direct output
        :param queue_manager: application queue manager
        :param app_orchestration_config: app orchestration config
        :param prompt_messages: prompt messages
        :param text: text
        :param stream: stream
        :param usage: usage
        :return:
        """
        if stream:
            index = 0
            for token in text:
                queue_manager.publish_chunk_message(LLMResultChunk(
                    model=app_orchestration_config.model_config.model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=AssistantPromptMessage(content=token)
                    )
                ), PublishFrom.APPLICATION_MANAGER)
                index += 1
                time.sleep(0.01)

        queue_manager.publish_message_end(
            llm_result=LLMResult(
                model=app_orchestration_config.model_config.model,
                prompt_messages=prompt_messages,
                message=AssistantPromptMessage(content=text),
                usage=usage if usage else LLMUsage.empty_usage()
            ),
            pub_from=PublishFrom.APPLICATION_MANAGER
        )

    def _handle_invoke_result(self, invoke_result: Union[LLMResult, Generator],
                              queue_manager: ApplicationQueueManager,
                              stream: bool) -> None:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :param queue_manager: application queue manager
        :param stream: stream
        :return:
        """
        if not stream:
            self._handle_invoke_result_direct(
                invoke_result=invoke_result,
                queue_manager=queue_manager
            )
        else:
            self._handle_invoke_result_stream(
                invoke_result=invoke_result,
                queue_manager=queue_manager
            )

    def _handle_invoke_result_direct(self, invoke_result: LLMResult,
                                     queue_manager: ApplicationQueueManager) -> None:
        """
        Handle invoke result direct
        :param invoke_result: invoke result
        :param queue_manager: application queue manager
        :return:
        """
        queue_manager.publish_message_end(
            llm_result=invoke_result,
            pub_from=PublishFrom.APPLICATION_MANAGER
        )

    def _handle_invoke_result_stream(self, invoke_result: Generator,
                                     queue_manager: ApplicationQueueManager) -> None:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :param queue_manager: application queue manager
        :return:
        """
        model = None
        prompt_messages = []
        text = ''
        usage = None
        for result in invoke_result:
            queue_manager.publish_chunk_message(result, PublishFrom.APPLICATION_MANAGER)

            text += result.delta.message.content

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = result.prompt_messages

            if not usage and result.delta.usage:
                usage = result.delta.usage

        llm_result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content=text),
            usage=usage
        )

        queue_manager.publish_message_end(
            llm_result=llm_result,
            pub_from=PublishFrom.APPLICATION_MANAGER
        )
