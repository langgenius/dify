import json
import uuid
from typing import Optional

from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    ModelConfigWithCredentialsEntity,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from extensions.ext_database import db
from core.model_runtime.model_providers import model_provider_factory
from core.model_runtime.entities.model_entities import ModelType
from core.prompt.prompt_transform import PromptTransform
from core.file.message_file_parser import MessageFileParser
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.memory.token_buffer_memory import TokenBufferMemory
from models.model import Conversation, Message, MessageAgentThought


class AgentHistoryPromptTransform(PromptTransform):
    """
    History Prompt Transform for Agent App
    """
    def __init__(self,
                 tenant_id: str,
                 app_config: AgentChatAppConfig,
                 model_config: ModelConfigWithCredentialsEntity,
                 message: Message,
                 prompt_messages: Optional[list[PromptMessage]] = None,
                 memory: Optional[TokenBufferMemory] = None,
                 ):
        self.tenant_id = tenant_id
        self.app_config = app_config
        self.model_config = model_config
        self.message = message
        self.prompt_messages = prompt_messages or []
        self.memory = memory

    def get_prompt(self) -> list[PromptMessage]:
        prompt_messages = []
        # check if there is a system message in the beginning of the conversation
        for prompt_message in self.prompt_messages:
            if isinstance(prompt_message, SystemPromptMessage):
                prompt_messages.append(prompt_message)

        if not self.memory:
            return prompt_messages

        max_token_limit = self._calculate_rest_token(self.prompt_messages, self.model_config)

        provider_instance = model_provider_factory.get_provider_instance(self.memory.model_instance.provider)
        model_type_instance = provider_instance.get_model_instance(ModelType.LLM)

        messages: list[Message] = db.session.query(Message).filter(
            Message.conversation_id == self.memory.conversation.id,
        ).order_by(Message.created_at.desc()).all()

        for message in messages:
            if message.id == self.message.id:
                continue

            prompt_messages.append(self._organize_agent_user_prompt(message))
            # number of appended prompts
            num_prompt = 1
            agent_thoughts: list[MessageAgentThought] = message.agent_thoughts
            if agent_thoughts:
                for agent_thought in agent_thoughts:
                    tools = agent_thought.tool
                    if tools:
                        tools = tools.split(';')
                        tool_calls: list[AssistantPromptMessage.ToolCall] = []
                        tool_call_response: list[ToolPromptMessage] = []
                        try:
                            tool_inputs = json.loads(agent_thought.tool_input)
                        except Exception as e:
                            tool_inputs = {tool: {} for tool in tools}
                        try:
                            tool_responses = json.loads(agent_thought.observation)
                        except Exception as e:
                            tool_responses = {tool: agent_thought.observation for tool in tools}

                        for tool in tools:
                            # generate a uuid for tool call
                            tool_call_id = str(uuid.uuid4())
                            tool_calls.append(AssistantPromptMessage.ToolCall(
                                id=tool_call_id,
                                type='function',
                                function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                    name=tool,
                                    arguments=json.dumps(tool_inputs.get(tool, {})),
                                )
                            ))
                            tool_call_response.append(ToolPromptMessage(
                                content=tool_responses.get(tool, agent_thought.observation),
                                name=tool,
                                tool_call_id=tool_call_id,
                            ))

                        prompt_messages.extend([
                            AssistantPromptMessage(
                                content=agent_thought.thought,
                                tool_calls=tool_calls,
                            ),
                            *tool_call_response
                        ])
                        num_prompt += 1 + len(tool_call_response)
                    if not tools:
                        prompt_messages.append(AssistantPromptMessage(content=agent_thought.thought))
                        num_prompt += 1
            else:
                if message.answer:
                    prompt_messages.append(AssistantPromptMessage(content=message.answer))
                    num_prompt += 1

            curr_message_tokens = model_type_instance.get_num_tokens(
                self.memory.model_instance.model,
                self.memory.model_instance.credentials,
                prompt_messages
            )
            # If tokens is overflow, drop all appended prompts in current message and break
            if curr_message_tokens > max_token_limit:
                prompt_messages = prompt_messages[:-num_prompt]
                break

        db.session.close()

        return prompt_messages

    def _organize_agent_user_prompt(self, message: Message) -> UserPromptMessage:
        message_file_parser = MessageFileParser(
            tenant_id=self.tenant_id,
            app_id=self.app_config.app_id,
        )

        files = message.message_files
        if files:
            file_extra_config = FileUploadConfigManager.convert(message.app_model_config.to_dict())

            if file_extra_config:
                file_objs = message_file_parser.transform_message_files(
                    files,
                    file_extra_config
                )
            else:
                file_objs = []

            if not file_objs:
                return UserPromptMessage(content=message.query)
            else:
                prompt_message_contents = [TextPromptMessageContent(data=message.query)]
                for file_obj in file_objs:
                    prompt_message_contents.append(file_obj.prompt_message_content)

                return UserPromptMessage(content=prompt_message_contents)
        else:
            return UserPromptMessage(content=message.query)
