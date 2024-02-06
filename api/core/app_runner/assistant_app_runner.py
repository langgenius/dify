import json
import logging
from typing import cast

from core.app_runner.app_runner import AppRunner
from core.application_queue_manager import ApplicationQueueManager, PublishFrom
from core.entities.application_entities import AgentEntity, ApplicationGenerateEntity, ModelConfigEntity
from core.features.assistant_cot_runner import AssistantCotApplicationRunner
from core.features.assistant_fc_runner import AssistantFunctionCallApplicationRunner
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.moderation.base import ModerationException
from core.tools.entities.tool_entities import ToolRuntimeVariablePool
from extensions.ext_database import db
from models.model import App, Conversation, Message, MessageAgentThought, MessageChain
from models.tools import ToolConversationVariables

logger = logging.getLogger(__name__)

class AssistantApplicationRunner(AppRunner):
    """
    Assistant Application Runner
    """
    def run(self, application_generate_entity: ApplicationGenerateEntity,
            queue_manager: ApplicationQueueManager,
            conversation: Conversation,
            message: Message) -> None:
        """
        Run assistant application
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
        
        # organize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional)
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            memory=memory
        )

        # moderation
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=application_generate_entity.tenant_id,
                app_orchestration_config_entity=app_orchestration_config,
                inputs=inputs,
                query=query,
            )
        except ModerationException as e:
            self.direct_output(
                queue_manager=queue_manager,
                app_orchestration_config=app_orchestration_config,
                prompt_messages=prompt_messages,
                text=str(e),
                stream=application_generate_entity.stream
            )
            return

        if query:
            # annotation reply
            annotation_reply = self.query_app_annotations_to_reply(
                app_record=app_record,
                message=message,
                query=query,
                user_id=application_generate_entity.user_id,
                invoke_from=application_generate_entity.invoke_from
            )

            if annotation_reply:
                queue_manager.publish_annotation_reply(
                    message_annotation_id=annotation_reply.id,
                    pub_from=PublishFrom.APPLICATION_MANAGER
                )
                self.direct_output(
                    queue_manager=queue_manager,
                    app_orchestration_config=app_orchestration_config,
                    prompt_messages=prompt_messages,
                    text=annotation_reply.content,
                    stream=application_generate_entity.stream
                )
                return

        # fill in variable inputs from external data tools if exists
        external_data_tools = app_orchestration_config.external_data_variables
        if external_data_tools:
            inputs = self.fill_in_inputs_from_external_data_tools(
                tenant_id=app_record.tenant_id,
                app_id=app_record.id,
                external_data_tools=external_data_tools,
                inputs=inputs,
                query=query
            )

        # reorganize all inputs and template to prompt messages
        # Include: prompt template, inputs, query(optional), files(optional)
        #          memory(optional), external data, dataset context(optional)
        prompt_messages, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            memory=memory
        )

        # check hosting moderation
        hosting_moderation_result = self.check_hosting_moderation(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            prompt_messages=prompt_messages
        )

        if hosting_moderation_result:
            return

        agent_entity = app_orchestration_config.agent

        # load tool variables
        tool_conversation_variables = self._load_tool_variables(conversation_id=conversation.id,
                                                   user_id=application_generate_entity.user_id,
                                                   tenant_id=application_generate_entity.tenant_id)

        # convert db variables to tool variables
        tool_variables = self._convert_db_variables_to_tool_variables(tool_conversation_variables)
        
        message_chain = self._init_message_chain(
            message=message,
            query=query
        )

        # init model instance
        model_instance = ModelInstance(
            provider_model_bundle=app_orchestration_config.model_config.provider_model_bundle,
            model=app_orchestration_config.model_config.model
        )
        prompt_message, _ = self.organize_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            memory=memory,
        )

        # change function call strategy based on LLM model
        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)

        if set([ModelFeature.MULTI_TOOL_CALL, ModelFeature.TOOL_CALL]).intersection(model_schema.features or []):
            agent_entity.strategy = AgentEntity.Strategy.FUNCTION_CALLING

        # start agent runner
        if agent_entity.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT:
            assistant_cot_runner = AssistantCotApplicationRunner(
                tenant_id=application_generate_entity.tenant_id,
                application_generate_entity=application_generate_entity,
                app_orchestration_config=app_orchestration_config,
                model_config=app_orchestration_config.model_config,
                config=agent_entity,
                queue_manager=queue_manager,
                message=message,
                user_id=application_generate_entity.user_id,
                memory=memory,
                prompt_messages=prompt_message,
                variables_pool=tool_variables,
                db_variables=tool_conversation_variables,
                model_instance=model_instance
            )
            invoke_result = assistant_cot_runner.run(
                conversation=conversation,
                message=message,
                query=query,
                inputs=inputs,
            )
        elif agent_entity.strategy == AgentEntity.Strategy.FUNCTION_CALLING:
            assistant_fc_runner = AssistantFunctionCallApplicationRunner(
                tenant_id=application_generate_entity.tenant_id,
                application_generate_entity=application_generate_entity,
                app_orchestration_config=app_orchestration_config,
                model_config=app_orchestration_config.model_config,
                config=agent_entity,
                queue_manager=queue_manager,
                message=message,
                user_id=application_generate_entity.user_id,
                memory=memory,
                prompt_messages=prompt_message,
                variables_pool=tool_variables,
                db_variables=tool_conversation_variables,
                model_instance=model_instance
            )
            invoke_result = assistant_fc_runner.run(
                conversation=conversation,
                message=message,
                query=query,
            )

        # handle invoke result
        self._handle_invoke_result(
            invoke_result=invoke_result,
            queue_manager=queue_manager,
            stream=application_generate_entity.stream,
            agent=True
        )

    def _load_tool_variables(self, conversation_id: str, user_id: str, tenant_id: str) -> ToolConversationVariables:
        """
        load tool variables from database
        """
        tool_variables: ToolConversationVariables = db.session.query(ToolConversationVariables).filter(
            ToolConversationVariables.conversation_id == conversation_id,
            ToolConversationVariables.tenant_id == tenant_id
        ).first()

        if tool_variables:
            # save tool variables to session, so that we can update it later
            db.session.add(tool_variables)
        else:
            # create new tool variables
            tool_variables = ToolConversationVariables(
                conversation_id=conversation_id,
                user_id=user_id,
                tenant_id=tenant_id,
                variables_str='[]',
            )
            db.session.add(tool_variables)
            db.session.commit()

        return tool_variables
    
    def _convert_db_variables_to_tool_variables(self, db_variables: ToolConversationVariables) -> ToolRuntimeVariablePool:
        """
        convert db variables to tool variables
        """
        return ToolRuntimeVariablePool(**{
            'conversation_id': db_variables.conversation_id,
            'user_id': db_variables.user_id,
            'tenant_id': db_variables.tenant_id,
            'pool': db_variables.variables
        })

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
            all_message_tokens += agent_thought.message_tokens
            all_answer_tokens += agent_thought.answer_tokens

        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        return model_type_instance._calc_response_usage(
            model_config.model,
            model_config.credentials,
            all_message_tokens,
            all_answer_tokens
        )
