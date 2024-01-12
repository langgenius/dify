import json
import logging
from typing import cast

from core.agent.agent.agent_llm_callback import AgentLLMCallback
from core.app_runner.app_runner import AppRunner
from core.application_queue_manager import ApplicationQueueManager
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.entities.application_entities import ApplicationGenerateEntity, ModelConfigEntity, PromptTemplateEntity
from core.features.agent_runner import AgentRunnerFeature
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from extensions.ext_database import db
from models.model import App, Conversation, Message, MessageAgentThought, MessageChain

logger = logging.getLogger(__name__)


class AgentApplicationRunner(AppRunner):
    """
    Agent Application Runner
    """

    def run(self, application_generate_entity: ApplicationGenerateEntity,
            queue_manager: ApplicationQueueManager,
            conversation: Conversation,
            message: Message) -> None:
        """
        Run agent application
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

        inputs = application_generate_entity.inputs
        query = application_generate_entity.query
        files = application_generate_entity.files

        # Pre-calculate the number of tokens of the prompt messages,
        # and return the rest number of tokens by model context token size limit and max token size limit.
        # If the rest number of tokens is not enough, raise exception.
        # Include: prompt template, inputs, query(optional), files(optional)
        # Not Include: memory, external data, dataset context
        self.get_pre_calculate_rest_tokens(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query
        )

        memory = None
        if application_generate_entity.conversation_id:
            # get memory of conversation (read-only)
            model_instance = ModelInstance(
                provider_model_bundle=app_orchestration_config.model_config.provider_model_bundle,
                model=app_orchestration_config.model_config.model
            )

            memory = TokenBufferMemory(
                conversation=conversation,
                model_instance=model_instance
            )

        # reorganize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional)
        prompt_messages, stop = self.organize_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            context=None,
            memory=memory
        )

        # Create MessageChain
        message_chain = self._init_message_chain(
            message=message,
            query=query
        )

        # add agent callback to record agent thoughts
        agent_callback = AgentLoopGatherCallbackHandler(
            model_config=app_orchestration_config.model_config,
            message=message,
            queue_manager=queue_manager,
            message_chain=message_chain
        )

        # init LLM Callback
        agent_llm_callback = AgentLLMCallback(
            agent_callback=agent_callback
        )

        agent_runner = AgentRunnerFeature(
            tenant_id=application_generate_entity.tenant_id,
            app_orchestration_config=app_orchestration_config,
            model_config=app_orchestration_config.model_config,
            config=app_orchestration_config.agent,
            queue_manager=queue_manager,
            message=message,
            user_id=application_generate_entity.user_id,
            agent_llm_callback=agent_llm_callback,
            callback=agent_callback,
            memory=memory
        )

        # agent run
        result = agent_runner.run(
            query=query,
            invoke_from=application_generate_entity.invoke_from
        )

        if result:
            self._save_message_chain(
                message_chain=message_chain,
                output_text=result
            )

        if (result
                and app_orchestration_config.prompt_template.prompt_type == PromptTemplateEntity.PromptType.SIMPLE
                and app_orchestration_config.prompt_template.simple_prompt_template
        ):
            # Direct output if agent result exists and has pre prompt
            self.direct_output(
                queue_manager=queue_manager,
                app_orchestration_config=app_orchestration_config,
                prompt_messages=prompt_messages,
                stream=application_generate_entity.stream,
                text=result,
                usage=self._get_usage_of_all_agent_thoughts(
                    model_config=app_orchestration_config.model_config,
                    message=message
                )
            )
        else:
            # As normal LLM run, agent result as context
            context = result

            # reorganize all inputs and template to prompt messages
            # Include: prompt template, inputs, query(optional), files(optional)
            #          memory(optional), external data, dataset context(optional)
            prompt_messages, stop = self.organize_prompt_messages(
                app_record=app_record,
                model_config=app_orchestration_config.model_config,
                prompt_template_entity=app_orchestration_config.prompt_template,
                inputs=inputs,
                files=files,
                query=query,
                context=context,
                memory=memory
            )

            # Re-calculate the max tokens if sum(prompt_token +  max_tokens) over model token limit
            self.recale_llm_max_tokens(
                model_config=app_orchestration_config.model_config,
                prompt_messages=prompt_messages
            )

            # Invoke model
            model_instance = ModelInstance(
                provider_model_bundle=app_orchestration_config.model_config.provider_model_bundle,
                model=app_orchestration_config.model_config.model
            )

            invoke_result = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_orchestration_config.model_config.parameters,
                stop=stop,
                stream=application_generate_entity.stream,
                user=application_generate_entity.user_id,
            )

            # handle invoke result
            self._handle_invoke_result(
                invoke_result=invoke_result,
                queue_manager=queue_manager,
                stream=application_generate_entity.stream
            )

    def _init_message_chain(self, message: Message, query: str) -> MessageChain:
        """
        Init MessageChain
        :param message: message
        :param query: query
        :return:
        """
        message_chain = MessageChain(
            message_id=message.id,
            type="AgentExecutor",
            input=json.dumps({
                "input": query
            })
        )

        db.session.add(message_chain)
        db.session.commit()

        return message_chain

    def _save_message_chain(self, message_chain: MessageChain, output_text: str) -> None:
        """
        Save MessageChain
        :param message_chain: message chain
        :param output_text: output text
        :return:
        """
        message_chain.output = json.dumps({
            "output": output_text
        })
        db.session.commit()

    def _get_usage_of_all_agent_thoughts(self, model_config: ModelConfigEntity,
                                         message: Message) -> LLMUsage:
        """
        Get usage of all agent thoughts
        :param model_config: model config
        :param message: message
        :return:
        """
        agent_thoughts = (db.session.query(MessageAgentThought)
                          .filter(MessageAgentThought.message_id == message.id).all())

        all_message_tokens = 0
        all_answer_tokens = 0
        for agent_thought in agent_thoughts:
            all_message_tokens += agent_thought.message_token
            all_answer_tokens += agent_thought.answer_token

        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        return model_type_instance._calc_response_usage(
            model_config.model,
            model_config.credentials,
            all_message_tokens,
            all_answer_tokens
        )
