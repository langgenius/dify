import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Union, cast

from core.agent.entities import AgentEntity, AgentToolEntity
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    ModelConfigWithCredentialsEntity,
)
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.file.message_file_parser import MessageFileParser
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.entities.tool_entities import (
    ToolInvokeMessage,
    ToolParameter,
    ToolRuntimeVariablePool,
)
from core.tools.tool.dataset_retriever_tool import DatasetRetrieverTool
from core.tools.tool.tool import Tool
from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from models.model import Conversation, Message, MessageAgentThought
from models.tools import ToolConversationVariables
from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform

logger = logging.getLogger(__name__)

class BaseAgentRunner(AppRunner):
    def __init__(self, tenant_id: str,
                 application_generate_entity: AgentChatAppGenerateEntity,
                 conversation: Conversation,
                 app_config: AgentChatAppConfig,
                 model_config: ModelConfigWithCredentialsEntity,
                 config: AgentEntity,
                 queue_manager: AppQueueManager,
                 message: Message,
                 user_id: str,
                 memory: Optional[TokenBufferMemory] = None,
                 prompt_messages: Optional[list[PromptMessage]] = None,
                 variables_pool: Optional[ToolRuntimeVariablePool] = None,
                 db_variables: Optional[ToolConversationVariables] = None,
                 model_instance: ModelInstance = None
                 ) -> None:
        """
        Agent runner
        :param tenant_id: tenant id
        :param app_config: app generate entity
        :param model_config: model config
        :param config: dataset config
        :param queue_manager: queue manager
        :param message: message
        :param user_id: user id
        :param agent_llm_callback: agent llm callback
        :param callback: callback
        :param memory: memory
        """
        self.tenant_id = tenant_id
        self.application_generate_entity = application_generate_entity
        self.conversation = conversation
        self.app_config = app_config
        self.model_config = model_config
        self.config = config
        self.queue_manager = queue_manager
        self.message = message
        self.user_id = user_id
        self.memory = memory
        self.history_prompt_messages = AgentHistoryPromptTransform(
            tenant_id=tenant_id,
            app_config=app_config,
            model_config=model_config,
            message=message,
            prompt_messages=prompt_messages or [],
            memory=memory
        ).get_prompt()
        self.variables_pool = variables_pool
        self.db_variables_pool = db_variables
        self.model_instance = model_instance

        # init callback
        self.agent_callback = DifyAgentCallbackHandler()
        # init dataset tools
        hit_callback = DatasetIndexToolCallbackHandler(
            queue_manager=queue_manager,
            app_id=self.app_config.app_id,
            message_id=message.id,
            user_id=user_id,
            invoke_from=self.application_generate_entity.invoke_from,
        )
        self.dataset_tools = DatasetRetrieverTool.get_dataset_tools(
            tenant_id=tenant_id,
            dataset_ids=app_config.dataset.dataset_ids if app_config.dataset else [],
            retrieve_config=app_config.dataset.retrieve_config if app_config.dataset else None,
            return_resource=app_config.additional_features.show_retrieve_source,
            invoke_from=application_generate_entity.invoke_from,
            hit_callback=hit_callback
        )
        # get how many agent thoughts have been created
        self.agent_thought_count = db.session.query(MessageAgentThought).filter(
            MessageAgentThought.message_id == self.message.id,
        ).count()
        db.session.close()

        # check if model supports stream tool call
        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)
        if model_schema and ModelFeature.STREAM_TOOL_CALL in (model_schema.features or []):
            self.stream_tool_call = True
        else:
            self.stream_tool_call = False

        # check if model supports vision
        if model_schema and ModelFeature.VISION in (model_schema.features or []):
            self.files = application_generate_entity.files
        else:
            self.files = []

    def _repack_app_generate_entity(self, app_generate_entity: AgentChatAppGenerateEntity) \
            -> AgentChatAppGenerateEntity:
        """
        Repack app generate entity
        """
        if app_generate_entity.app_config.prompt_template.simple_prompt_template is None:
            app_generate_entity.app_config.prompt_template.simple_prompt_template = ''

        return app_generate_entity

    def _convert_tool_response_to_str(self, tool_response: list[ToolInvokeMessage]) -> str:
        """
        Handle tool response
        """
        result = ''
        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                result += response.message
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                result += f"result link: {response.message}. please tell user to check it."
            elif response.type == ToolInvokeMessage.MessageType.IMAGE_LINK or \
                 response.type == ToolInvokeMessage.MessageType.IMAGE:
                result += "image has been created and sent to user already, you do not need to create it, just tell the user to check it now."
            else:
                result += f"tool response: {response.message}."

        return result
    
    def _convert_tool_to_prompt_message_tool(self, tool: AgentToolEntity) -> tuple[PromptMessageTool, Tool]:
        """
            convert tool to prompt message tool
        """
        tool_entity = ToolManager.get_agent_tool_runtime(
            tenant_id=self.tenant_id,
            app_id=self.app_config.app_id,
            agent_tool=tool,
        )
        tool_entity.load_variables(self.variables_pool)

        message_tool = PromptMessageTool(
            name=tool.tool_name,
            description=tool_entity.description.llm,
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            }
        )

        parameters = tool_entity.get_all_runtime_parameters()
        for parameter in parameters:
            if parameter.form != ToolParameter.ToolParameterForm.LLM:
                continue

            parameter_type = 'string'
            enum = []
            if parameter.type == ToolParameter.ToolParameterType.STRING:
                parameter_type = 'string'
            elif parameter.type == ToolParameter.ToolParameterType.BOOLEAN:
                parameter_type = 'boolean'
            elif parameter.type == ToolParameter.ToolParameterType.NUMBER:
                parameter_type = 'number'
            elif parameter.type == ToolParameter.ToolParameterType.SELECT:
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
    
    def _convert_dataset_retriever_tool_to_prompt_message_tool(self, tool: DatasetRetrieverTool) -> PromptMessageTool:
        """
        convert dataset retriever tool to prompt message tool
        """
        prompt_tool = PromptMessageTool(
            name=tool.identity.name,
            description=tool.description.llm,
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            }
        )

        for parameter in tool.get_runtime_parameters():
            parameter_type = 'string'
        
            prompt_tool.parameters['properties'][parameter.name] = {
                "type": parameter_type,
                "description": parameter.llm_description or '',
            }

            if parameter.required:
                if parameter.name not in prompt_tool.parameters['required']:
                    prompt_tool.parameters['required'].append(parameter.name)

        return prompt_tool
    
    def _init_prompt_tools(self) -> tuple[dict[str, Tool], list[PromptMessageTool]]:
        """
        Init tools
        """
        tool_instances = {}
        prompt_messages_tools = []

        for tool in self.app_config.agent.tools if self.app_config.agent else []:
            try:
                prompt_tool, tool_entity = self._convert_tool_to_prompt_message_tool(tool)
            except Exception:
                # api tool may be deleted
                continue
            # save tool entity
            tool_instances[tool.tool_name] = tool_entity
            # save prompt tool
            prompt_messages_tools.append(prompt_tool)

        # convert dataset tools into ModelRuntime Tool format
        for dataset_tool in self.dataset_tools:
            prompt_tool = self._convert_dataset_retriever_tool_to_prompt_message_tool(dataset_tool)
            # save prompt tool
            prompt_messages_tools.append(prompt_tool)
            # save tool entity
            tool_instances[dataset_tool.identity.name] = dataset_tool

        return tool_instances, prompt_messages_tools

    def update_prompt_message_tool(self, tool: Tool, prompt_tool: PromptMessageTool) -> PromptMessageTool:
        """
        update prompt message tool
        """
        # try to get tool runtime parameters
        tool_runtime_parameters = tool.get_runtime_parameters() or []

        for parameter in tool_runtime_parameters:
            if parameter.form != ToolParameter.ToolParameterForm.LLM:
                continue

            parameter_type = 'string'
            enum = []
            if parameter.type == ToolParameter.ToolParameterType.STRING:
                parameter_type = 'string'
            elif parameter.type == ToolParameter.ToolParameterType.BOOLEAN:
                parameter_type = 'boolean'
            elif parameter.type == ToolParameter.ToolParameterType.NUMBER:
                parameter_type = 'number'
            elif parameter.type == ToolParameter.ToolParameterType.SELECT:
                for option in parameter.options:
                    enum.append(option.value)
                parameter_type = 'string'
            else:
                raise ValueError(f"parameter type {parameter.type} is not supported")
        
            prompt_tool.parameters['properties'][parameter.name] = {
                "type": parameter_type,
                "description": parameter.llm_description or '',
            }

            if len(enum) > 0:
                prompt_tool.parameters['properties'][parameter.name]['enum'] = enum

            if parameter.required:
                if parameter.name not in prompt_tool.parameters['required']:
                    prompt_tool.parameters['required'].append(parameter.name)

        return prompt_tool
        
    def create_agent_thought(self, message_id: str, message: str, 
                             tool_name: str, tool_input: str, messages_ids: list[str]
                             ) -> MessageAgentThought:
        """
        Create agent thought
        """
        thought = MessageAgentThought(
            message_id=message_id,
            message_chain_id=None,
            thought='',
            tool=tool_name,
            tool_labels_str='{}',
            tool_meta_str='{}',
            tool_input=tool_input,
            message=message,
            message_token=0,
            message_unit_price=0,
            message_price_unit=0,
            message_files=json.dumps(messages_ids) if messages_ids else '',
            answer='',
            observation='',
            answer_token=0,
            answer_unit_price=0,
            answer_price_unit=0,
            tokens=0,
            total_price=0,
            position=self.agent_thought_count + 1,
            currency='USD',
            latency=0,
            created_by_role='account',
            created_by=self.user_id,
        )

        db.session.add(thought)
        db.session.commit()
        db.session.refresh(thought)
        db.session.close()

        self.agent_thought_count += 1

        return thought

    def save_agent_thought(self, 
                           agent_thought: MessageAgentThought, 
                           tool_name: str,
                           tool_input: Union[str, dict],
                           thought: str, 
                           observation: Union[str, dict], 
                           tool_invoke_meta: Union[str, dict],
                           answer: str,
                           messages_ids: list[str],
                           llm_usage: LLMUsage = None) -> MessageAgentThought:
        """
        Save agent thought
        """
        agent_thought = db.session.query(MessageAgentThought).filter(
            MessageAgentThought.id == agent_thought.id
        ).first()

        if thought is not None:
            agent_thought.thought = thought

        if tool_name is not None:
            agent_thought.tool = tool_name

        if tool_input is not None:
            if isinstance(tool_input, dict):
                try:
                    tool_input = json.dumps(tool_input, ensure_ascii=False)
                except Exception as e:
                    tool_input = json.dumps(tool_input)

            agent_thought.tool_input = tool_input

        if observation is not None:
            if isinstance(observation, dict):
                try:
                    observation = json.dumps(observation, ensure_ascii=False)
                except Exception as e:
                    observation = json.dumps(observation)
                    
            agent_thought.observation = observation

        if answer is not None:
            agent_thought.answer = answer

        if messages_ids is not None and len(messages_ids) > 0:
            agent_thought.message_files = json.dumps(messages_ids)
        
        if llm_usage:
            agent_thought.message_token = llm_usage.prompt_tokens
            agent_thought.message_price_unit = llm_usage.prompt_price_unit
            agent_thought.message_unit_price = llm_usage.prompt_unit_price
            agent_thought.answer_token = llm_usage.completion_tokens
            agent_thought.answer_price_unit = llm_usage.completion_price_unit
            agent_thought.answer_unit_price = llm_usage.completion_unit_price
            agent_thought.tokens = llm_usage.total_tokens
            agent_thought.total_price = llm_usage.total_price

        # check if tool labels is not empty
        labels = agent_thought.tool_labels or {}
        tools = agent_thought.tool.split(';') if agent_thought.tool else []
        for tool in tools:
            if not tool:
                continue
            if tool not in labels:
                tool_label = ToolManager.get_tool_label(tool)
                if tool_label:
                    labels[tool] = tool_label.to_dict()
                else:
                    labels[tool] = {'en_US': tool, 'zh_Hans': tool}

        agent_thought.tool_labels_str = json.dumps(labels)

        if tool_invoke_meta is not None:
            if isinstance(tool_invoke_meta, dict):
                try:
                    tool_invoke_meta = json.dumps(tool_invoke_meta, ensure_ascii=False)
                except Exception as e:
                    tool_invoke_meta = json.dumps(tool_invoke_meta)

            agent_thought.tool_meta_str = tool_invoke_meta

        db.session.commit()
        db.session.close()
    
    def update_db_variables(self, tool_variables: ToolRuntimeVariablePool, db_variables: ToolConversationVariables):
        """
        convert tool variables to db variables
        """
        db_variables = db.session.query(ToolConversationVariables).filter(
            ToolConversationVariables.conversation_id == self.message.conversation_id,
        ).first()

        db_variables.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db_variables.variables_str = json.dumps(jsonable_encoder(tool_variables.pool))
        db.session.commit()
        db.session.close()
        