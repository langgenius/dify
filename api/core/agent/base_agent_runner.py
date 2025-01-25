import json
import logging
import uuid
from datetime import UTC, datetime
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
from core.file import file_manager
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMUsage,
    PromptMessage,
    PromptMessageContent,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.tools.entities.tool_entities import (
    ToolParameter,
    ToolRuntimeVariablePool,
)
from core.tools.tool.dataset_retriever_tool import DatasetRetrieverTool
from core.tools.tool.tool import Tool
from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from factories import file_factory
from models.model import Conversation, Message, MessageAgentThought, MessageFile
from models.tools import ToolConversationVariables

logger = logging.getLogger(__name__)


class BaseAgentRunner(AppRunner):
    def __init__(
        self,
        *,
        tenant_id: str,
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
        model_instance: ModelInstance,
    ) -> None:
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
        self.history_prompt_messages = self.organize_agent_history(prompt_messages=prompt_messages or [])
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
            hit_callback=hit_callback,
        )
        # get how many agent thoughts have been created
        self.agent_thought_count = (
            db.session.query(MessageAgentThought)
            .filter(
                MessageAgentThought.message_id == self.message.id,
            )
            .count()
        )
        db.session.close()

        # check if model supports stream tool call
        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)
        features = model_schema.features if model_schema and model_schema.features else []
        self.stream_tool_call = ModelFeature.STREAM_TOOL_CALL in features
        self.files = application_generate_entity.files if ModelFeature.VISION in features else []
        self.query: Optional[str] = ""
        self._current_thoughts: list[PromptMessage] = []

    def _repack_app_generate_entity(
        self, app_generate_entity: AgentChatAppGenerateEntity
    ) -> AgentChatAppGenerateEntity:
        """
        Repack app generate entity
        """
        if app_generate_entity.app_config.prompt_template.simple_prompt_template is None:
            app_generate_entity.app_config.prompt_template.simple_prompt_template = ""

        return app_generate_entity

    def _convert_tool_to_prompt_message_tool(self, tool: AgentToolEntity) -> tuple[PromptMessageTool, Tool]:
        """
        convert tool to prompt message tool
        """
        tool_entity = ToolManager.get_agent_tool_runtime(
            tenant_id=self.tenant_id,
            app_id=self.app_config.app_id,
            agent_tool=tool,
            invoke_from=self.application_generate_entity.invoke_from,
        )
        tool_entity.load_variables(self.variables_pool)

        message_tool = PromptMessageTool(
            name=tool.tool_name,
            description=tool_entity.description.llm if tool_entity.description else "",
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            },
        )

        parameters = tool_entity.get_all_runtime_parameters()
        for parameter in parameters:
            if parameter.form != ToolParameter.ToolParameterForm.LLM:
                continue

            parameter_type = parameter.type.as_normal_type()
            if parameter.type in {
                ToolParameter.ToolParameterType.SYSTEM_FILES,
                ToolParameter.ToolParameterType.FILE,
                ToolParameter.ToolParameterType.FILES,
            }:
                continue
            enum = []
            if parameter.type == ToolParameter.ToolParameterType.SELECT:
                enum = [option.value for option in parameter.options] if parameter.options else []

            message_tool.parameters["properties"][parameter.name] = {
                "type": parameter_type,
                "description": parameter.llm_description or "",
            }

            if len(enum) > 0:
                message_tool.parameters["properties"][parameter.name]["enum"] = enum

            if parameter.required:
                message_tool.parameters["required"].append(parameter.name)

        return message_tool, tool_entity

    def _convert_dataset_retriever_tool_to_prompt_message_tool(self, tool: DatasetRetrieverTool) -> PromptMessageTool:
        """
        convert dataset retriever tool to prompt message tool
        """
        prompt_tool = PromptMessageTool(
            name=tool.identity.name if tool.identity else "unknown",
            description=tool.description.llm if tool.description else "",
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            },
        )

        for parameter in tool.get_runtime_parameters():
            parameter_type = "string"

            prompt_tool.parameters["properties"][parameter.name] = {
                "type": parameter_type,
                "description": parameter.llm_description or "",
            }

            if parameter.required:
                if parameter.name not in prompt_tool.parameters["required"]:
                    prompt_tool.parameters["required"].append(parameter.name)

        return prompt_tool

    def _init_prompt_tools(self) -> tuple[dict[str, Tool], list[PromptMessageTool]]:
        """
        Init tools
        """
        tool_instances = {}
        prompt_messages_tools = []

        for tool in self.app_config.agent.tools or [] if self.app_config.agent else []:
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
            if dataset_tool.identity is not None:
                tool_instances[dataset_tool.identity.name] = dataset_tool

        return tool_instances, prompt_messages_tools

    def update_prompt_message_tool(self, tool: Tool, prompt_tool: PromptMessageTool) -> PromptMessageTool:
        """
        update prompt message tool
        """
        # try to get tool runtime parameters
        tool_runtime_parameters = tool.get_runtime_parameters()

        for parameter in tool_runtime_parameters:
            if parameter.form != ToolParameter.ToolParameterForm.LLM:
                continue

            parameter_type = parameter.type.as_normal_type()
            if parameter.type in {
                ToolParameter.ToolParameterType.SYSTEM_FILES,
                ToolParameter.ToolParameterType.FILE,
                ToolParameter.ToolParameterType.FILES,
            }:
                continue
            enum = []
            if parameter.type == ToolParameter.ToolParameterType.SELECT:
                enum = [option.value for option in parameter.options] if parameter.options else []

            prompt_tool.parameters["properties"][parameter.name] = {
                "type": parameter_type,
                "description": parameter.llm_description or "",
            }

            if len(enum) > 0:
                prompt_tool.parameters["properties"][parameter.name]["enum"] = enum

            if parameter.required:
                if parameter.name not in prompt_tool.parameters["required"]:
                    prompt_tool.parameters["required"].append(parameter.name)

        return prompt_tool

    def create_agent_thought(
        self, message_id: str, message: str, tool_name: str, tool_input: str, messages_ids: list[str]
    ) -> MessageAgentThought:
        """
        Create agent thought
        """
        thought = MessageAgentThought(
            message_id=message_id,
            message_chain_id=None,
            thought="",
            tool=tool_name,
            tool_labels_str="{}",
            tool_meta_str="{}",
            tool_input=tool_input,
            message=message,
            message_token=0,
            message_unit_price=0,
            message_price_unit=0,
            message_files=json.dumps(messages_ids) if messages_ids else "",
            answer="",
            observation="",
            answer_token=0,
            answer_unit_price=0,
            answer_price_unit=0,
            tokens=0,
            total_price=0,
            position=self.agent_thought_count + 1,
            currency="USD",
            latency=0,
            created_by_role="account",
            created_by=self.user_id,
        )

        db.session.add(thought)
        db.session.commit()
        db.session.refresh(thought)
        db.session.close()

        self.agent_thought_count += 1

        return thought

    def save_agent_thought(
        self,
        agent_thought: MessageAgentThought,
        tool_name: str,
        tool_input: Union[str, dict],
        thought: str,
        observation: Union[str, dict, None],
        tool_invoke_meta: Union[str, dict, None],
        answer: str,
        messages_ids: list[str],
        llm_usage: LLMUsage | None = None,
    ):
        """
        Save agent thought
        """
        queried_thought = (
            db.session.query(MessageAgentThought).filter(MessageAgentThought.id == agent_thought.id).first()
        )
        if not queried_thought:
            raise ValueError(f"Agent thought {agent_thought.id} not found")
        agent_thought = queried_thought

        if thought:
            agent_thought.thought = thought

        if tool_name:
            agent_thought.tool = tool_name

        if tool_input:
            if isinstance(tool_input, dict):
                try:
                    tool_input = json.dumps(tool_input, ensure_ascii=False)
                except Exception as e:
                    tool_input = json.dumps(tool_input)

            agent_thought.tool_input = tool_input

        if observation:
            if isinstance(observation, dict):
                try:
                    observation = json.dumps(observation, ensure_ascii=False)
                except Exception as e:
                    observation = json.dumps(observation)

            agent_thought.observation = observation

        if answer:
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
        tools = agent_thought.tool.split(";") if agent_thought.tool else []
        for tool in tools:
            if not tool:
                continue
            if tool not in labels:
                tool_label = ToolManager.get_tool_label(tool)
                if tool_label:
                    labels[tool] = tool_label.to_dict()
                else:
                    labels[tool] = {"en_US": tool, "zh_Hans": tool}

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
        queried_variables = (
            db.session.query(ToolConversationVariables)
            .filter(
                ToolConversationVariables.conversation_id == self.message.conversation_id,
            )
            .first()
        )

        if not queried_variables:
            return

        db_variables = queried_variables

        db_variables.updated_at = datetime.now(UTC).replace(tzinfo=None)
        db_variables.variables_str = json.dumps(jsonable_encoder(tool_variables.pool))
        db.session.commit()
        db.session.close()

    def organize_agent_history(self, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Organize agent history
        """
        result: list[PromptMessage] = []
        # check if there is a system message in the beginning of the conversation
        for prompt_message in prompt_messages:
            if isinstance(prompt_message, SystemPromptMessage):
                result.append(prompt_message)

        messages: list[Message] = (
            db.session.query(Message)
            .filter(
                Message.conversation_id == self.message.conversation_id,
            )
            .order_by(Message.created_at.desc())
            .all()
        )

        messages = list(reversed(extract_thread_messages(messages)))

        for message in messages:
            if message.id == self.message.id:
                continue

            result.append(self.organize_agent_user_prompt(message))
            agent_thoughts: list[MessageAgentThought] = message.agent_thoughts
            if agent_thoughts:
                for agent_thought in agent_thoughts:
                    tools = agent_thought.tool
                    if tools:
                        tools = tools.split(";")
                        tool_calls: list[AssistantPromptMessage.ToolCall] = []
                        tool_call_response: list[ToolPromptMessage] = []
                        try:
                            tool_inputs = json.loads(agent_thought.tool_input)
                        except Exception as e:
                            tool_inputs = {tool: {} for tool in tools}
                        try:
                            tool_responses = json.loads(agent_thought.observation)
                        except Exception as e:
                            tool_responses = dict.fromkeys(tools, agent_thought.observation)

                        for tool in tools:
                            # generate a uuid for tool call
                            tool_call_id = str(uuid.uuid4())
                            tool_calls.append(
                                AssistantPromptMessage.ToolCall(
                                    id=tool_call_id,
                                    type="function",
                                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                        name=tool,
                                        arguments=json.dumps(tool_inputs.get(tool, {})),
                                    ),
                                )
                            )
                            tool_call_response.append(
                                ToolPromptMessage(
                                    content=tool_responses.get(tool, agent_thought.observation),
                                    name=tool,
                                    tool_call_id=tool_call_id,
                                )
                            )

                        result.extend(
                            [
                                AssistantPromptMessage(
                                    content=agent_thought.thought,
                                    tool_calls=tool_calls,
                                ),
                                *tool_call_response,
                            ]
                        )
                    if not tools:
                        result.append(AssistantPromptMessage(content=agent_thought.thought))
            else:
                if message.answer:
                    result.append(AssistantPromptMessage(content=message.answer))

        db.session.close()

        return result

    def organize_agent_user_prompt(self, message: Message) -> UserPromptMessage:
        files = db.session.query(MessageFile).filter(MessageFile.message_id == message.id).all()
        if not files:
            return UserPromptMessage(content=message.query)
        file_extra_config = FileUploadConfigManager.convert(message.app_model_config.to_dict())
        if not file_extra_config:
            return UserPromptMessage(content=message.query)

        image_detail_config = file_extra_config.image_config.detail if file_extra_config.image_config else None
        image_detail_config = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

        file_objs = file_factory.build_from_message_files(
            message_files=files, tenant_id=self.tenant_id, config=file_extra_config
        )
        if not file_objs:
            return UserPromptMessage(content=message.query)
        prompt_message_contents: list[PromptMessageContent] = []
        prompt_message_contents.append(TextPromptMessageContent(data=message.query))
        for file in file_objs:
            prompt_message_contents.append(
                file_manager.to_prompt_message_content(
                    file,
                    image_detail_config=image_detail_config,
                )
            )
        return UserPromptMessage(content=prompt_message_contents)
