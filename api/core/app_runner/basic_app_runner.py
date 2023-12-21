from decimal import Decimal
from typing import cast, Optional, Tuple

from core.entities.application_entities import ApplicationGenerateEntity, PromptTemplateEntity, ModelConfigEntity, \
    AppOrchestrationConfigEntity
from core.application_queue_manager import ApplicationQueueManager
from core.file.file_obj import FileObj
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.model_runtime.entities.model_entities import ModelPropertyKey, AIModelEntity
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.moderation.base import ModerationAction, ModerationException
from core.moderation.factory import ModerationFactory
from core.prompt.prompt_transform import PromptTransform
from extensions.ext_database import db
from models.model import Conversation, Message, App


class BasicApplicationRunner:
    """
    Basic Application Runner
    """

    def run(self, application_generate_entity: ApplicationGenerateEntity,
            queue_manager: ApplicationQueueManager,
            conversation: Conversation,
            message: Message) -> None:
        """
        Run application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param conversation: conversation
        :param message: message
        :return:
        """
        app_record = db.session.query(App).filter(App.id == application_generate_entity.app_id).first()
        if not app_record:
            raise ValueError(f"App not found")

        app_orchestration_config = application_generate_entity.app_orchestration_config_entity

        # Pre-calculate the number of tokens of the prompt messages,
        # and return the rest number of tokens by model context token size limit and max token size limit.
        # If the rest number of tokens is not enough, raise exception.
        # Include: prompt template, inputs, query(optional), files(optional)
        # Not Include: memory, external data, dataset context
        rest_tokens = self.get_pre_calculate_rest_tokens(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=application_generate_entity.inputs,
            files=application_generate_entity.files,
            query=application_generate_entity.query
        )

        memory = None
        if application_generate_entity.conversation_id:
            # get memory of conversation (read-only)
            memory = TokenBufferMemory(
                conversation=conversation,
                model_config=app_orchestration_config.model_config
            )

        # todo organize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory, external data, dataset context
        prompt_messages = []

        # moderation
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=application_generate_entity.tenant_id,
                app_orchestration_config_entity=app_orchestration_config,
                inputs=application_generate_entity.inputs,
                query=application_generate_entity.query,
            )
        except ModerationException as e:
            self.direct_output(
                queue_manager=queue_manager,
                app_orchestration_config=app_orchestration_config,
                prompt_messages=prompt_messages,
                text=str(e)
            )
            return

        # annotation reply

        # reorganize all inputs and template to prompt messages

        # Pre-calculate the number of tokens of the prompt messages,
        # and return the rest number of tokens by model context token size limit and max token size limit

        # Dynamic append memory to prompt messages within the limit of the rest number of tokens

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
        model_instance = model_config.provider_model_bundle.model_instance
        model_instance = cast(LargeLanguageModel, model_instance)

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)

        max_tokens = 0
        for parameter_rule in model_config.model_schema.parameter_rules:
            if (parameter_rule.name == 'max_tokens'
                    or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                max_tokens = (model_config.parameters.get(parameter_rule.name)
                              or model_config.parameters.get(parameter_rule.use_template))

        if model_context_tokens is None:
            return -1

        if max_tokens is None:
            max_tokens = 0

        prompt_transform = PromptTransform()

        # get prompt without memory and context
        if prompt_template_entity.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
            prompt_messages, _ = prompt_transform.get_prompt(
                app_mode=app_record.mode,
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query if query else '',
                files=files,
                context=None,
                memory=None,
                model_config=model_config
            )
        else:
            prompt_messages = prompt_transform.get_advanced_prompt(
                app_mode=app_record.mode,
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query,
                files=files,
                context=None,
                memory=None,
                model_config=model_config
            )

        prompt_tokens = model_instance.get_num_tokens(
            model_config.model,
            prompt_messages
        )

        rest_tokens = model_context_tokens - max_tokens - prompt_tokens
        if rest_tokens < 0:
            raise InvokeBadRequestError("Query or prefix prompt is too long, you can reduce the prefix prompt, "
                                        "or shrink the max token, or switch to a llm with a larger token limit size.")

        return rest_tokens

    def moderation_for_inputs(self, app_id: str,
                              tenant_id: str,
                              app_orchestration_config_entity: AppOrchestrationConfigEntity,
                              inputs: dict,
                              query: str) -> Tuple[bool, dict, str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_orchestration_config_entity: app orchestration config entity
        :param inputs: inputs
        :param query: query
        :return:
        """
        if not app_orchestration_config_entity.sensitive_word_avoidance:
            return False, inputs, query

        sensitive_word_avoidance_config = app_orchestration_config_entity.sensitive_word_avoidance
        type = sensitive_word_avoidance_config.type

        moderation = ModerationFactory(
            name=type,
            app_id=app_id,
            tenant_id=tenant_id,
            config=sensitive_word_avoidance_config.config
        )

        moderation_result = moderation.moderation_for_inputs(inputs, query)

        if not moderation_result.flagged:
            return False, inputs, query

        if moderation_result.action == ModerationAction.DIRECT_OUTPUT:
            raise ModerationException(moderation_result.preset_response)
        elif moderation_result.action == ModerationAction.OVERRIDED:
            inputs = moderation_result.inputs
            query = moderation_result.query

        return True, inputs, query

    def direct_output(self, queue_manager: ApplicationQueueManager,
                      app_orchestration_config: AppOrchestrationConfigEntity,
                      prompt_messages: list,
                      text: str) -> None:
        """
        Direct output
        :param queue_manager: application queue manager
        :param app_orchestration_config: app orchestration config
        :param prompt_messages: prompt messages
        :param text: text
        :return:
        """
        queue_manager.publish_message_end(
            llm_result=LLMResult(
                model=app_orchestration_config.model_config.model,
                prompt_messages=prompt_messages,
                message=AssistantPromptMessage(content=text),
                usage=LLMUsage(
                    prompt_tokens=0,
                    prompt_unit_price=Decimal('0.0'),
                    prompt_price_unit=Decimal('0.0'),
                    prompt_price=Decimal('0.0'),
                    completion_tokens=0,
                    completion_unit_price=Decimal('0.0'),
                    completion_price_unit=Decimal('0.0'),
                    completion_price=Decimal('0.0'),
                    total_tokens=0,
                    total_price=Decimal('0.0'),
                    currency="",
                    latency=.0
                )
            )
        )
