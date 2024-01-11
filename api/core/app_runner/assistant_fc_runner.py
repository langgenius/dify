import json
import logging

from typing import cast, Literal, Union, Generator, Dict, Any, Tuple, List

from core.entities.application_entities import ApplicationGenerateEntity, PromptTemplateEntity, ModelConfigEntity, \
      AgentPromptEntity, AgentEntity
from core.model_runtime.utils.encoders import jsonable_encoder
from core.model_runtime.entities.message_entities import PromptMessageTool, PromptMessage, UserPromptMessage,\
      SystemPromptMessage, AssistantPromptMessage, ToolPromptMessage
from core.model_runtime.entities.llm_entities import LLMResultChunk
from core.model_manager import ModelInstance

from core.tools.provider.tool import Tool

from core.app_runner.app_runner import AppRunner
from core.application_queue_manager import ApplicationQueueManager
from core.agent.agent.agent_llm_callback import AgentLLMCallback

from extensions.ext_database import db
from models.model import Conversation, Message, MessageAgentThought

logger = logging.getLogger(__name__)

class AssistantCotApplicationRunner(AppRunner):
    def run(self, application_generate_entity: ApplicationGenerateEntity,
        queue_manager: ApplicationQueueManager,
        model_instance: ModelInstance,
        agent_llm_callback: AgentLLMCallback,
        conversation: Conversation,
        tool_instances: Dict[str, Tool],
        message: Message,
        prompt_messages_tools: list[PromptMessageTool],
        agent_entity: AgentEntity,
        query: str,
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Run Cot agent application
        """
        app_orchestration_config = application_generate_entity.app_orchestration_config_entity

        # get prompt template
        orchestration_config = application_generate_entity.app_orchestration_config_entity
        prompt_template = orchestration_config.prompt_template.simple_prompt_template or ''

        prompt_messages = self.originze_prompt_messages(
            prompt_template=prompt_template,
            query=query,
            prompt_messages=application_generate_entity,
        )

        # recale llm max tokens
        self.recale_llm_max_tokens(model_instance, prompt_messages)

        iteration_step = 1
        max_iteration_steps = 5

        # continue to run until there is not any tool call
        function_call_state = True

        while function_call_state and iteration_step <= max_iteration_steps:
            function_call_state = False
            
            # invoke model
            llm_result: Generator[LLMResultChunk, None, None] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_orchestration_config.model_config.parameters,
                tools=prompt_messages_tools,
                stop=app_orchestration_config.model_config.stop,
                stream=True,
                user=application_generate_entity.user_id,
                callbacks=[agent_llm_callback],
            )

            tool_calls: List[Tuple[str, str, Dict[str, Any]]] = []

            for chunk in llm_result:
                # check if there is any tool call
                if self.check_tool_calls(chunk):
                    function_call_state = True
                    tool_calls.extend(self.extract_tool_calls(chunk))

                yield chunk

            # call tools
            for tool_call_id, tool_call_name, tool_call_args in tool_calls:
                tool_instance = tool_instances.get(tool_call_name)
                if not tool_instance:
                    logger.error(f"failed to find tool instance: {tool_call_name}")
                    continue
                
                # invoke tool
                tool_response = tool_instance.invoke(
                    user_id=application_generate_entity.user_id, 
                    tool_paramters=tool_call_args, 
                )

                prompt_messages = self.originze_prompt_messages(
                    prompt_template=prompt_template,
                    query=query,
                    tool_call_id=tool_call_id,
                    tool_call_name=tool_call_name,
                    tool_response=tool_response,
                    prompt_messages=prompt_messages,
                )

    def check_tool_calls(self, llm_result_chunk: LLMResultChunk) -> bool:
        """
        Check if there is any tool call in llm result chunk
        """
        for prompt_message in llm_result_chunk.prompt_messages:
            if isinstance(prompt_message, AssistantPromptMessage):
                if not prompt_message.tool_calls:
                    continue

                for tool_call in prompt_message.tool_calls:
                    return True

        return False

    def extract_tool_calls(self, llm_result_chunk: LLMResultChunk) -> Union[None, List[Tuple[str, str, Dict[str, Any]]]]:
        """
        Extract tool calls from llm result chunk

        Returns:
            List[Tuple[str, str, Dict[str, Any]]]: [(tool_call_id, tool_call_name, tool_call_args)]
        """
        tool_calls = []
        for prompt_message in llm_result_chunk.prompt_messages:
            if isinstance(prompt_message, AssistantPromptMessage):
                for tool_call in prompt_message.tool_calls:
                    try:
                        tool_calls.append((tool_call.id, tool_call.function.name, json.loads(tool_call.function.arguments)))
                    except Exception as e:
                        logger.error(f"failed to parse tool call: {tool_call}")

        return tool_calls
    
    def originze_prompt_messages(self, prompt_template: str,
                                 query: str = None, 
                                 tool_call_id: str = None, tool_call_name: str = None, tool_response: str = None,
                                 prompt_messages: list[PromptMessage] = None
                                 ) -> list[PromptMessage]:
        """
        Organize prompt messages
        """
        
        if not prompt_messages:
            prompt_messages = [
                SystemPromptMessage(content=prompt_template),
                UserPromptMessage(content=query),
            ]
        else:
            if tool_response:
                prompt_messages = prompt_messages.copy().append(
                    ToolPromptMessage(
                        content=tool_response,
                        tool_call_id=tool_call_id,
                        name=tool_call_name,
                    )
                )
            if query:
                prompt_messages = prompt_messages.copy().append(
                    UserPromptMessage(content=query)
                )

        return prompt_messages