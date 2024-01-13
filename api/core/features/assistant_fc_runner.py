import json
import logging

from typing import Union, Generator, Dict, Any, Tuple, List

from core.model_runtime.entities.message_entities import PromptMessageTool, PromptMessage, UserPromptMessage,\
      SystemPromptMessage, AssistantPromptMessage, ToolPromptMessage
from core.model_runtime.entities.llm_entities import LLMResultChunk, LLMResult, LLMUsage
from core.model_manager import ModelInstance

from core.tools.provider.tool import Tool
from core.tools.errors import ToolInvokeError, ToolNotFoundError, \
    ToolNotSupportedError, ToolProviderNotFoundError, ToolParamterValidationError, \
          ToolProviderCredentialValidationError

from core.features.assistant_base_runner import BaseAssistantApplicationRunner

from extensions.ext_database import db
from models.model import Conversation, Message, MessageAgentThought

logger = logging.getLogger(__name__)

class AssistantFunctionCallApplicationRunner(BaseAssistantApplicationRunner):
    def run(self, model_instance: ModelInstance,
        conversation: Conversation,
        tool_instances: Dict[str, Tool],
        message: Message,
        prompt_messages_tools: list[PromptMessageTool],
        query: str,
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Run Cot agent application
        """
        app_orchestration_config = self.app_orchestration_config

        # get application generate entity
        prompt_template = self.app_orchestration_config.prompt_template.simple_prompt_template or ''

        prompt_messages = self.originze_prompt_messages(
            prompt_template=prompt_template,
            query=query,
        )

        # recale llm max tokens
        self.recale_llm_max_tokens(self.model_config, prompt_messages)

        iteration_step = 1
        max_iteration_steps = 5

        # continue to run until there is not any tool call
        function_call_state = True
        agent_thought: MessageAgentThought = None
        llm_usage = {
            'usage': None
        }
        final_answer = ''

        def increse_usage(final_llm_usage_dict: Dict[str, LLMUsage], usage: LLMUsage):
            if not final_llm_usage_dict['usage']:
                final_llm_usage_dict['usage'] = usage
            else:
                llm_usage = final_llm_usage_dict['usage']
                llm_usage.prompt_tokens += usage.prompt_tokens
                llm_usage.completion_tokens += usage.completion_tokens
                llm_usage.prompt_price += usage.prompt_price
                llm_usage.completion_price += usage.completion_price

        while function_call_state and iteration_step <= max_iteration_steps:
            function_call_state = False
            
            # invoke model
            chunks: Generator[LLMResultChunk, None, None] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_orchestration_config.model_config.parameters,
                tools=prompt_messages_tools,
                stop=app_orchestration_config.model_config.stop,
                stream=True,
                user=self.user_id,
                callbacks=[self.agent_llm_callback],
            )

            tool_calls: List[Tuple[str, str, Dict[str, Any]]] = []

            # save full response
            response = ''

            for chunk in chunks:
                # check if there is any tool call
                if self.check_tool_calls(chunk):
                    function_call_state = True
                    tool_calls.extend(self.extract_tool_calls(chunk))

                for prompt_message in chunk.prompt_messages:
                    if isinstance(prompt_message, AssistantPromptMessage):
                        if prompt_message.content and prompt_message.content != '' \
                              and isinstance(prompt_message.content, str):
                            response += prompt_message.content

                if chunk.delta.usage:
                    increse_usage(llm_usage, chunk.delta.usage)

                yield chunk

            if agent_thought is not None:
                # save last agent thought's response
                self.save_agent_thought(agent_thought, thought=None, answer=response)

            final_answer += response + '\n'

            # call tools
            tool_responses = []
            for tool_call_id, tool_call_name, tool_call_args in tool_calls:
                tool_instance = tool_instances.get(tool_call_name)
                # create agent thought
                agent_thought = self.create_agent_thought(
                    message_id=message.id,
                    message=message.message,
                    tool_name=tool_call_name,
                    tool_input=json.dumps(tool_call_args),
                )
                self.queue_manager.publish_agent_thought(agent_thought)

                if not tool_instance:
                    logger.error(f"failed to find tool instance: {tool_call_name}")
                    tool_responses.append({
                        "tool_call_id": tool_call_id,
                        "tool_call_name": tool_call_name,
                        "tool_response": f"there is not a tool named {tool_call_name}"
                    })
                    self.save_agent_thought(agent_thought, thought=None, answer=f"there is not a tool named {tool_call_name}")
                else:
                    # invoke tool
                    error_response = None
                    try:
                        tool_response = tool_instance.invoke(
                            user_id=self.user_id, 
                            tool_paramters=tool_call_args, 
                        )
                    except ToolProviderCredentialValidationError as e:
                        error_response = f"Plese check your tool provider credentials"
                    except (
                        ToolNotFoundError, ToolNotSupportedError, ToolProviderNotFoundError
                    ) as e:
                        error_response = f"there is not a tool named {tool_call_name}"
                    except (
                        ToolParamterValidationError
                    ) as e:
                        error_response = f"tool paramters validation error: {e}, please check your tool paramters"
                    except ToolInvokeError as e:
                        error_response = f"tool invoke error: {e}"
                    except Exception as e:
                        error_response = f"unknown error: {e}"
                    
                    if error_response:
                        thought = error_response
                        logger.error(error_response)
                        tool_responses.append({
                            "tool_call_id": tool_call_id,
                            "tool_call_name": tool_call_name,
                            "tool_response": error_response
                        })
                    else:
                        thought = self._handle_tool_response(tool_response)
                        tool_responses.append({
                            "tool_call_id": tool_call_id,
                            "tool_call_name": tool_call_name,
                            "tool_response": self._handle_tool_response(tool_response)
                        })
                    
                    self.save_agent_thought(agent_thought, thought=thought, answer='')

                prompt_messages = self.originze_prompt_messages(
                    prompt_template=prompt_template,
                    query=query,
                    tool_call_id=tool_call_id,
                    tool_call_name=tool_call_name,
                    tool_response=self._handle_tool_response(tool_response),
                    prompt_messages=prompt_messages,
                )

            iteration_step += 1

        # publish end event
        self.queue_manager.publish_message_end(LLMResult(
            model=model_instance.model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=final_answer,
            ),
            usage=llm_usage['usage'],
            system_fingerprint=''
        ))

    def check_tool_calls(self, llm_result_chunk: LLMResultChunk) -> bool:
        """
        Check if there is any tool call in llm result chunk
        """
        for prompt_message in llm_result_chunk.prompt_messages:
            if isinstance(prompt_message, AssistantPromptMessage):
                if not prompt_message.tool_calls:
                    continue

                if len(prompt_message.tool_calls) > 0:
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