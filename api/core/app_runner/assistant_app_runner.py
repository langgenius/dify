import json
import logging
from typing import cast, Tuple
from datetime import datetime

from core.agent.agent.agent_llm_callback import AgentLLMCallback
from core.app_runner.app_runner import AppRunner
from core.features.assistant_cot_runner import AssistantCotApplicationRunner
from core.features.assistant_fc_runner import AssistantFunctionCallApplicationRunner
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.entities.application_entities import ApplicationGenerateEntity, ModelConfigEntity, \
    AgentEntity, AgentToolEntity
from core.application_queue_manager import ApplicationQueueManager
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import PromptMessageTool
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

from core.tools.tool_manager import ToolManager
from core.tools.entities.tool_entities import ToolParamter, ToolRuntimeVariablePool
from core.tools.provider.tool import Tool

from extensions.ext_database import db
from models.model import Conversation, Message, App, MessageChain, MessageAgentThought
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

        agent_entity = app_orchestration_config.agent
        tools = agent_entity.tools

        # load tool variables
        tool_conversation_variables = self._load_tool_variables(conversation_id=conversation.id,
                                                   user_id=application_generate_entity.user_id,
                                                   tanent_id=application_generate_entity.tenant_id)

        # convert db variables to tool variables
        tool_variables = self._convert_db_variables_to_tool_variables(tool_conversation_variables)

        # convert tools into ModelRuntime Tool format
        prompt_messages_tools = []
        tool_instances = {}
        for tool in tools:
            prompt_tool, tool_entity = self._convert_tool_to_prompt_message_tool(application_generate_entity, tool)
            # load tool variables into tool entity memory
            tool_entity.load_variables(tool_variables)
            prompt_messages_tools.append(prompt_tool)
            # save tool entity
            tool_instances[tool.tool_name] = tool_entity
        
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

        # init model instance
        model_instance = ModelInstance(
            provider_model_bundle=app_orchestration_config.model_config.provider_model_bundle,
            model=app_orchestration_config.model_config.model
        )

        prompt_message, _ = self.originze_prompt_messages(
            app_record=app_record,
            model_config=app_orchestration_config.model_config,
            prompt_template_entity=app_orchestration_config.prompt_template,
            inputs=inputs,
            files=files,
            query=query,
            memory=memory,
        )

        # start agent runner
        if agent_entity.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT:
            assistant_cot_runner = AssistantCotApplicationRunner(
                tenant_id=application_generate_entity.tenant_id,
                app_orchestration_config=app_orchestration_config,
                model_config=app_orchestration_config.model_config,
                config=agent_entity,
                queue_manager=queue_manager,
                message=message,
                user_id=application_generate_entity.user_id,
                agent_llm_callback=agent_llm_callback,
                callback=agent_callback,
                memory=memory,
                prompt_messages=prompt_message
            )
            invoke_result = assistant_cot_runner.run(
                model_instance=model_instance,
                conversation=conversation,
                tool_instances=tool_instances,
                message=message,
                prompt_messages_tools=prompt_messages_tools,
                query=query,
            )
        elif agent_entity.strategy == AgentEntity.Strategy.FUNCTION_CALLING:
            assistant_cot_runner = AssistantFunctionCallApplicationRunner(
                tenant_id=application_generate_entity.tenant_id,
                app_orchestration_config=app_orchestration_config,
                model_config=app_orchestration_config.model_config,
                config=agent_entity,
                queue_manager=queue_manager,
                message=message,
                user_id=application_generate_entity.user_id,
                agent_llm_callback=agent_llm_callback,
                callback=agent_callback,
                memory=memory,
                prompt_messages=prompt_message
            )
            invoke_result = assistant_cot_runner.run(
                model_instance=model_instance,
                conversation=conversation,
                tool_instances=tool_instances,
                message=message,
                prompt_messages_tools=prompt_messages_tools,
                query=query,
            )

        # handle invoke result
        self._handle_invoke_result(
            invoke_result=invoke_result,
            queue_manager=queue_manager,
            stream=application_generate_entity.stream
        )

    def _load_tool_variables(self, conversation_id: str, user_id: str, tanent_id: str) -> ToolConversationVariables:
        """
        load tool variables from database
        """
        tool_variables: ToolConversationVariables = db.session.query(ToolConversationVariables).filter(
            ToolConversationVariables.conversation_id == conversation_id,
            ToolConversationVariables.tenant_id == tanent_id
        ).first()

        if tool_variables:
            # save tool variables to session, so that we can update it later
            db.session.add(tool_variables)
        else:
            # create new tool variables
            tool_variables = ToolConversationVariables(
                conversation_id=conversation_id,
                user_id=user_id,
                tenant_id=tanent_id,
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
    
    def _update_db_variables(self, tool_variables: ToolRuntimeVariablePool, db_variables: ToolConversationVariables):
        """
        convert tool variables to db variables
        """
        db_variables.updated_at = datetime.utcnow()
        db_variables.variables_str = tool_variables.json()
        db.session.commit()

    def _convert_tool_to_prompt_message_tool(self, application_generate_entity: ApplicationGenerateEntity, tool: AgentToolEntity
                                             ) -> Tuple[PromptMessageTool, Tool]:
        """
            convert tool to prompt message tool
        """
        tool_entity = ToolManager.get_tool_runtime(
            provider_type=tool.provider_type, provider_name=tool.provider_id, tool_name=tool.tool_name, 
            tanent_id=application_generate_entity.tenant_id
        )

        message_tool = PromptMessageTool(
            name=tool.tool_name,
            description=tool_entity.description.llm,
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            }
        )

        for parameter in tool_entity.parameters:
            parameter_type = 'string'
            enum = []
            if parameter.type == ToolParamter.ToolParameterType.STRING:
                parameter_type = 'string'
            elif parameter.type == ToolParamter.ToolParameterType.BOOLEAN:
                parameter_type = 'boolean'
            elif parameter.type == ToolParamter.ToolParameterType.NUMBER:
                parameter_type = 'number'
            elif parameter.type == ToolParamter.ToolParameterType.SELECT:
                for option in parameter.options:
                    enum.append(option.value)
                parameter_type = 'string'
            else:
                raise ValueError(f"parameter type {parameter.type} is not supported")
            
            message_tool.parameters['properties'][parameter.name] = {
                "type": parameter_type,
                "description": parameter.llm_description or '',
            }

            if len(enum) > 0:
                message_tool.parameters['properties'][parameter.name]['enum'] = enum

            if parameter.required:
                message_tool.parameters['required'].append(parameter.name)

        return message_tool, tool_entity

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
