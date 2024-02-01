import json
import logging
from typing import Any, Dict, Generator, List, Tuple, Union

from core.application_queue_manager import PublishFrom
from core.features.assistant_base_runner import BaseAssistantApplicationRunner
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, PromptMessage, PromptMessageTool,
                                                          SystemPromptMessage, ToolPromptMessage, UserPromptMessage)
from core.tools.errors import (ToolInvokeError, ToolNotFoundError, ToolNotSupportedError, ToolParameterValidationError,
                               ToolProviderCredentialValidationError, ToolProviderNotFoundError)
from models.model import Conversation, Message, MessageAgentThought

logger = logging.getLogger(__name__)

class AssistantFunctionCallApplicationRunner(BaseAssistantApplicationRunner):
    def run(self, conversation: Conversation,
                message: Message,
                query: str,
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Run FunctionCall agent application
        """
        app_orchestration_config = self.app_orchestration_config

        prompt_template = self.app_orchestration_config.prompt_template.simple_prompt_template or ''
        prompt_messages = self.history_prompt_messages
        prompt_messages = self.organize_prompt_messages(
            prompt_template=prompt_template,
            query=query,
            prompt_messages=prompt_messages
        )

        # convert tools into ModelRuntime Tool format
        prompt_messages_tools: List[PromptMessageTool] = []
        tool_instances = {}
        for tool in self.app_orchestration_config.agent.tools if self.app_orchestration_config.agent else []:
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

        iteration_step = 1
        max_iteration_steps = min(app_orchestration_config.agent.max_iteration, 5) + 1

        # continue to run until there is not any tool call
        function_call_state = True
        agent_thoughts: List[MessageAgentThought] = []
        llm_usage = {
            'usage': None
        }
        final_answer = ''

        def increase_usage(final_llm_usage_dict: Dict[str, LLMUsage], usage: LLMUsage):
            if not final_llm_usage_dict['usage']:
                final_llm_usage_dict['usage'] = usage
            else:
                llm_usage = final_llm_usage_dict['usage']
                llm_usage.prompt_tokens += usage.prompt_tokens
                llm_usage.completion_tokens += usage.completion_tokens
                llm_usage.prompt_price += usage.prompt_price
                llm_usage.completion_price += usage.completion_price

        model_instance = self.model_instance

        while function_call_state and iteration_step <= max_iteration_steps:
            function_call_state = False

            if iteration_step == max_iteration_steps:
                # the last iteration, remove all tools
                prompt_messages_tools = []

            message_file_ids = []
            agent_thought = self.create_agent_thought(
                message_id=message.id,
                message='',
                tool_name='',
                tool_input='',
                messages_ids=message_file_ids
            )

            # recale llm max tokens
            self.recale_llm_max_tokens(self.model_config, prompt_messages)
            # invoke model
            chunks: Union[Generator[LLMResultChunk, None, None], LLMResult] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_orchestration_config.model_config.parameters,
                tools=prompt_messages_tools,
                stop=app_orchestration_config.model_config.stop,
                stream=self.stream_tool_call,
                user=self.user_id,
                callbacks=[],
            )

            tool_calls: List[Tuple[str, str, Dict[str, Any]]] = []

            # save full response
            response = ''

            # save tool call names and inputs
            tool_call_names = ''
            tool_call_inputs = ''

            current_llm_usage = None

            if self.stream_tool_call:
                is_first_chunk = True
                for chunk in chunks:
                    if is_first_chunk:
                        self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)
                        is_first_chunk = False
                    # check if there is any tool call
                    if self.check_tool_calls(chunk):
                        function_call_state = True
                        tool_calls.extend(self.extract_tool_calls(chunk))
                        tool_call_names = ';'.join([tool_call[1] for tool_call in tool_calls])
                        try:
                            tool_call_inputs = json.dumps({
                                tool_call[1]: tool_call[2] for tool_call in tool_calls
                            }, ensure_ascii=False)
                        except json.JSONDecodeError as e:
                            # ensure ascii to avoid encoding error
                            tool_call_inputs = json.dumps({
                                tool_call[1]: tool_call[2] for tool_call in tool_calls
                            })

                    if chunk.delta.message and chunk.delta.message.content:
                        if isinstance(chunk.delta.message.content, list):
                            for content in chunk.delta.message.content:
                                response += content.data
                        else:
                            response += chunk.delta.message.content

                    if chunk.delta.usage:
                        increase_usage(llm_usage, chunk.delta.usage)
                        current_llm_usage = chunk.delta.usage

                    yield chunk
            else:
                result: LLMResult = chunks
                # check if there is any tool call
                if self.check_blocking_tool_calls(result):
                    function_call_state = True
                    tool_calls.extend(self.extract_blocking_tool_calls(result))
                    tool_call_names = ';'.join([tool_call[1] for tool_call in tool_calls])
                    try:
                        tool_call_inputs = json.dumps({
                            tool_call[1]: tool_call[2] for tool_call in tool_calls
                        }, ensure_ascii=False)
                    except json.JSONDecodeError as e:
                        # ensure ascii to avoid encoding error
                        tool_call_inputs = json.dumps({
                            tool_call[1]: tool_call[2] for tool_call in tool_calls
                        })

                if result.usage:
                    increase_usage(llm_usage, result.usage)
                    current_llm_usage = result.usage

                if result.message and result.message.content:
                    if isinstance(result.message.content, list):
                        for content in result.message.content:
                            response += content.data
                    else:
                        response += result.message.content

                if not result.message.content:
                    result.message.content = ''

                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)
                
                yield LLMResultChunk(
                    model=model_instance.model,
                    prompt_messages=result.prompt_messages,
                    system_fingerprint=result.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=result.message,
                        usage=result.usage,
                    )
                )

            if tool_calls:
                prompt_messages.append(AssistantPromptMessage(
                    content='',
                    name='',
                    tool_calls=[AssistantPromptMessage.ToolCall(
                        id=tool_call[0],
                        type='function',
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=tool_call[1],
                            arguments=json.dumps(tool_call[2], ensure_ascii=False)
                        )
                    ) for tool_call in tool_calls]
                ))

            # save thought
            self.save_agent_thought(
                agent_thought=agent_thought, 
                tool_name=tool_call_names,
                tool_input=tool_call_inputs,
                thought=response,
                observation=None,
                answer=response,
                messages_ids=[],
                llm_usage=current_llm_usage
            )

            self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)
            
            final_answer += response + '\n'

            # update prompt messages
            if response.strip():
                prompt_messages.append(AssistantPromptMessage(
                    content=response,
                ))
            
            # call tools
            tool_responses = []
            for tool_call_id, tool_call_name, tool_call_args in tool_calls:
                tool_instance = tool_instances.get(tool_call_name)
                if not tool_instance:
                    tool_response = {
                        "tool_call_id": tool_call_id,
                        "tool_call_name": tool_call_name,
                        "tool_response": f"there is not a tool named {tool_call_name}"
                    }
                    tool_responses.append(tool_response)
                else:
                    # invoke tool
                    error_response = None
                    try:
                        tool_invoke_message = tool_instance.invoke(
                            user_id=self.user_id, 
                            tool_parameters=tool_call_args, 
                        )
                        # transform tool invoke message to get LLM friendly message
                        tool_invoke_message = self.transform_tool_invoke_messages(tool_invoke_message)
                        # extract binary data from tool invoke message
                        binary_files = self.extract_tool_response_binary(tool_invoke_message)
                        # create message file
                        message_files = self.create_message_files(binary_files)
                        # publish files
                        for message_file, save_as in message_files:
                            if save_as:
                                self.variables_pool.set_file(tool_name=tool_call_name, value=message_file.id, name=save_as)

                            # publish message file
                            self.queue_manager.publish_message_file(message_file, PublishFrom.APPLICATION_MANAGER)
                            # add message file ids
                            message_file_ids.append(message_file.id)
                            
                    except ToolProviderCredentialValidationError as e:
                        error_response = f"Please check your tool provider credentials"
                    except (
                        ToolNotFoundError, ToolNotSupportedError, ToolProviderNotFoundError
                    ) as e:
                        error_response = f"there is not a tool named {tool_call_name}"
                    except (
                        ToolParameterValidationError
                    ) as e:
                        error_response = f"tool parameters validation error: {e}, please check your tool parameters"
                    except ToolInvokeError as e:
                        error_response = f"tool invoke error: {e}"
                    except Exception as e:
                        error_response = f"unknown error: {e}"

                    if error_response:
                        observation = error_response
                        tool_response = {
                            "tool_call_id": tool_call_id,
                            "tool_call_name": tool_call_name,
                            "tool_response": error_response
                        }
                        tool_responses.append(tool_response)
                    else:
                        observation = self._convert_tool_response_to_str(tool_invoke_message)
                        tool_response = {
                            "tool_call_id": tool_call_id,
                            "tool_call_name": tool_call_name,
                            "tool_response": observation
                        }
                        tool_responses.append(tool_response)

                prompt_messages = self.organize_prompt_messages(
                    prompt_template=prompt_template,
                    query=None,
                    tool_call_id=tool_call_id,
                    tool_call_name=tool_call_name,
                    tool_response=tool_response['tool_response'],
                    prompt_messages=prompt_messages,
                )

            if len(tool_responses) > 0:
                # save agent thought
                self.save_agent_thought(
                    agent_thought=agent_thought, 
                    tool_name=None,
                    tool_input=None,
                    thought=None, 
                    observation=tool_response['tool_response'], 
                    answer=None,
                    messages_ids=message_file_ids
                )
                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

            # update prompt tool
            for prompt_tool in prompt_messages_tools:
                self.update_prompt_message_tool(tool_instances[prompt_tool.name], prompt_tool)

            iteration_step += 1

        self.update_db_variables(self.variables_pool, self.db_variables_pool)
        # publish end event
        self.queue_manager.publish_message_end(LLMResult(
            model=model_instance.model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=final_answer,
            ),
            usage=llm_usage['usage'] if llm_usage['usage'] else LLMUsage.empty_usage(),
            system_fingerprint=''
        ), PublishFrom.APPLICATION_MANAGER)

    def check_tool_calls(self, llm_result_chunk: LLMResultChunk) -> bool:
        """
        Check if there is any tool call in llm result chunk
        """
        if llm_result_chunk.delta.message.tool_calls:
            return True
        return False
    
    def check_blocking_tool_calls(self, llm_result: LLMResult) -> bool:
        """
        Check if there is any blocking tool call in llm result
        """
        if llm_result.message.tool_calls:
            return True
        return False

    def extract_tool_calls(self, llm_result_chunk: LLMResultChunk) -> Union[None, List[Tuple[str, str, Dict[str, Any]]]]:
        """
        Extract tool calls from llm result chunk

        Returns:
            List[Tuple[str, str, Dict[str, Any]]]: [(tool_call_id, tool_call_name, tool_call_args)]
        """
        tool_calls = []
        for prompt_message in llm_result_chunk.delta.message.tool_calls:
            tool_calls.append((
                prompt_message.id,
                prompt_message.function.name,
                json.loads(prompt_message.function.arguments),
            ))

        return tool_calls
    
    def extract_blocking_tool_calls(self, llm_result: LLMResult) -> Union[None, List[Tuple[str, str, Dict[str, Any]]]]:
        """
        Extract blocking tool calls from llm result

        Returns:
            List[Tuple[str, str, Dict[str, Any]]]: [(tool_call_id, tool_call_name, tool_call_args)]
        """
        tool_calls = []
        for prompt_message in llm_result.message.tool_calls:
            tool_calls.append((
                prompt_message.id,
                prompt_message.function.name,
                json.loads(prompt_message.function.arguments),
            ))

        return tool_calls

    def organize_prompt_messages(self, prompt_template: str,
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
                prompt_messages = prompt_messages.copy()
                prompt_messages.append(
                    ToolPromptMessage(
                        content=tool_response,
                        tool_call_id=tool_call_id,
                        name=tool_call_name,
                    )
                )

        return prompt_messages