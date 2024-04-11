import json
import logging
from collections.abc import Generator
from copy import deepcopy
from typing import Any, Union

from core.agent.base_agent_runner import BaseAgentRunner
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueAgentThoughtEvent, QueueMessageEndEvent, QueueMessageFileEvent
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentType,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.tools.entities.tool_entities import ToolInvokeMeta
from core.tools.tool_engine import ToolEngine
from models.model import Message

logger = logging.getLogger(__name__)

class FunctionCallAgentRunner(BaseAgentRunner):
    def run(self, 
            message: Message, query: str, **kwargs: Any
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Run FunctionCall agent application
        """
        app_generate_entity = self.application_generate_entity

        app_config = self.app_config

        prompt_template = app_config.prompt_template.simple_prompt_template or ''
        prompt_messages = self.history_prompt_messages
        prompt_messages = self._init_system_message(prompt_template, prompt_messages)
        prompt_messages = self._organize_user_query(query, prompt_messages)

        # convert tools into ModelRuntime Tool format
        tool_instances, prompt_messages_tools = self._init_prompt_tools()

        iteration_step = 1
        max_iteration_steps = min(app_config.agent.max_iteration, 5) + 1

        # continue to run until there is not any tool call
        function_call_state = True
        llm_usage = {
            'usage': None
        }
        final_answer = ''

        def increase_usage(final_llm_usage_dict: dict[str, LLMUsage], usage: LLMUsage):
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

            # recalc llm max tokens
            self.recalc_llm_max_tokens(self.model_config, prompt_messages)
            # invoke model
            chunks: Union[Generator[LLMResultChunk, None, None], LLMResult] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_generate_entity.model_config.parameters,
                tools=prompt_messages_tools,
                stop=app_generate_entity.model_config.stop,
                stream=self.stream_tool_call,
                user=self.user_id,
                callbacks=[],
            )

            tool_calls: list[tuple[str, str, dict[str, Any]]] = []

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
                        self.queue_manager.publish(QueueAgentThoughtEvent(
                            agent_thought_id=agent_thought.id
                        ), PublishFrom.APPLICATION_MANAGER)
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

                self.queue_manager.publish(QueueAgentThoughtEvent(
                    agent_thought_id=agent_thought.id
                ), PublishFrom.APPLICATION_MANAGER)
                
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

            assistant_message = AssistantPromptMessage(
                content='',
                tool_calls=[]
            )
            if tool_calls:
                assistant_message.tool_calls=[
                    AssistantPromptMessage.ToolCall(
                        id=tool_call[0],
                        type='function',
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=tool_call[1],
                            arguments=json.dumps(tool_call[2], ensure_ascii=False)
                        )
                    ) for tool_call in tool_calls
                ]
            else:
                assistant_message.content = response
            
            prompt_messages.append(assistant_message)

            # save thought
            self.save_agent_thought(
                agent_thought=agent_thought, 
                tool_name=tool_call_names,
                tool_input=tool_call_inputs,
                thought=response,
                tool_invoke_meta=None,
                observation=None,
                answer=response,
                messages_ids=[],
                llm_usage=current_llm_usage
            )
            self.queue_manager.publish(QueueAgentThoughtEvent(
                agent_thought_id=agent_thought.id
            ), PublishFrom.APPLICATION_MANAGER)
            
            final_answer += response + '\n'

            # call tools
            tool_responses = []
            for tool_call_id, tool_call_name, tool_call_args in tool_calls:
                tool_instance = tool_instances.get(tool_call_name)
                if not tool_instance:
                    tool_response = {
                        "tool_call_id": tool_call_id,
                        "tool_call_name": tool_call_name,
                        "tool_response": f"there is not a tool named {tool_call_name}",
                        "meta": ToolInvokeMeta.error_instance(f"there is not a tool named {tool_call_name}").to_dict()
                    }
                else:
                    # invoke tool
                    tool_invoke_response, message_files, tool_invoke_meta = ToolEngine.agent_invoke(
                        tool=tool_instance,
                        tool_parameters=tool_call_args,
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                        message=self.message,
                        invoke_from=self.application_generate_entity.invoke_from,
                        agent_tool_callback=self.agent_callback,
                    )
                    # publish files
                    for message_file, save_as in message_files:
                        if save_as:
                            self.variables_pool.set_file(tool_name=tool_call_name, value=message_file.id, name=save_as)

                        # publish message file
                        self.queue_manager.publish(QueueMessageFileEvent(
                            message_file_id=message_file.id
                        ), PublishFrom.APPLICATION_MANAGER)
                        # add message file ids
                        message_file_ids.append(message_file.id)
                    
                    tool_response = {
                        "tool_call_id": tool_call_id,
                        "tool_call_name": tool_call_name,
                        "tool_response": tool_invoke_response,
                        "meta": tool_invoke_meta.to_dict()
                    }
                
                tool_responses.append(tool_response)
                prompt_messages = self._organize_assistant_message(
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
                    tool_invoke_meta={
                        tool_response['tool_call_name']: tool_response['meta'] 
                        for tool_response in tool_responses
                    },
                    observation={
                        tool_response['tool_call_name']: tool_response['tool_response'] 
                        for tool_response in tool_responses
                    },
                    answer=None,
                    messages_ids=message_file_ids
                )
                self.queue_manager.publish(QueueAgentThoughtEvent(
                    agent_thought_id=agent_thought.id
                ), PublishFrom.APPLICATION_MANAGER)

            # update prompt tool
            for prompt_tool in prompt_messages_tools:
                self.update_prompt_message_tool(tool_instances[prompt_tool.name], prompt_tool)

            iteration_step += 1

            prompt_messages = self._clear_user_prompt_image_messages(prompt_messages)

        self.update_db_variables(self.variables_pool, self.db_variables_pool)
        # publish end event
        self.queue_manager.publish(QueueMessageEndEvent(llm_result=LLMResult(
            model=model_instance.model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=final_answer
            ),
            usage=llm_usage['usage'] if llm_usage['usage'] else LLMUsage.empty_usage(),
            system_fingerprint=''
        )), PublishFrom.APPLICATION_MANAGER)

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

    def extract_tool_calls(self, llm_result_chunk: LLMResultChunk) -> Union[None, list[tuple[str, str, dict[str, Any]]]]:
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
    
    def extract_blocking_tool_calls(self, llm_result: LLMResult) -> Union[None, list[tuple[str, str, dict[str, Any]]]]:
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

    def _init_system_message(self, prompt_template: str, prompt_messages: list[PromptMessage] = None) -> list[PromptMessage]:
        """
        Initialize system message
        """
        if not prompt_messages and prompt_template:
            return [
                SystemPromptMessage(content=prompt_template),
            ]
        
        if prompt_messages and not isinstance(prompt_messages[0], SystemPromptMessage) and prompt_template:
            prompt_messages.insert(0, SystemPromptMessage(content=prompt_template))

        return prompt_messages

    def _organize_user_query(self, query,  prompt_messages: list[PromptMessage] = None) -> list[PromptMessage]:
        """
        Organize user query
        """
        if self.files:
            prompt_message_contents = [TextPromptMessageContent(data=query)]
            for file_obj in self.files:
                prompt_message_contents.append(file_obj.prompt_message_content)

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages
    
    def _organize_assistant_message(self, tool_call_id: str = None, tool_call_name: str = None, tool_response: str = None, 
                                    prompt_messages: list[PromptMessage] = None) -> list[PromptMessage]:
        """
        Organize assistant message
        """
        prompt_messages = deepcopy(prompt_messages)

        if tool_response is not None:
            prompt_messages.append(
                ToolPromptMessage(
                    content=tool_response,
                    tool_call_id=tool_call_id,
                    name=tool_call_name,
                )
            )

        return prompt_messages
    
    def _clear_user_prompt_image_messages(self, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        As for now, gpt supports both fc and vision at the first iteration.
        We need to remove the image messages from the prompt messages at the first iteration.
        """
        prompt_messages = deepcopy(prompt_messages)

        for prompt_message in prompt_messages:
            if isinstance(prompt_message, UserPromptMessage):
                if isinstance(prompt_message.content, list):
                    prompt_message.content = '\n'.join([
                        content.data if content.type == PromptMessageContentType.TEXT else 
                        '[image]' if content.type == PromptMessageContentType.IMAGE else
                        '[file]' 
                        for content in prompt_message.content 
                    ])

        return prompt_messages