import json
import logging
from collections import defaultdict
from collections.abc import Generator
from copy import deepcopy
from typing import Any, Union

from core.agent.base_agent_runner import BaseAgentRunner
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueAgentThoughtEvent, QueueMessageEndEvent, QueueMessageFileEvent
from core.file import file_manager
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
    PromptMessage,
    PromptMessageContentType,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.message_entities import ImagePromptMessageContent, PromptMessageContentUnionTypes
from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from core.tools.entities.tool_entities import ToolInvokeMeta
from core.tools.tool_engine import ToolEngine
from core.workflow.nodes.agent.exc import AgentMaxIterationError
from models.model import Message

logger = logging.getLogger(__name__)


class FunctionCallAgentRunner(BaseAgentRunner):
    def run(self, message: Message, query: str, **kwargs: Any) -> Generator[LLMResultChunk, None, None]:
        """
        Run FunctionCall agent application
        """
        self.query = query
        app_generate_entity = self.application_generate_entity

        app_config = self.app_config
        assert app_config is not None, "app_config is required"
        assert app_config.agent is not None, "app_config.agent is required"

        # convert tools into ModelRuntime Tool format
        tool_instances, prompt_messages_tools = self._init_prompt_tools()

        assert app_config.agent

        iteration_step = 1
        max_iteration_steps = min(app_config.agent.max_iteration, 99) + 1

        # continue to run until there is not any tool call
        function_call_state = True
        llm_usage: dict[str, LLMUsage | None] = {"usage": None}
        final_answer = ""
        prompt_messages: list = []  # Initialize prompt_messages

        # get tracing instance
        trace_manager = app_generate_entity.trace_manager

        def increase_usage(final_llm_usage_dict: dict[str, LLMUsage | None], usage: LLMUsage):
            if not final_llm_usage_dict["usage"]:
                final_llm_usage_dict["usage"] = usage
            else:
                llm_usage = final_llm_usage_dict["usage"]
                llm_usage.prompt_tokens += usage.prompt_tokens
                llm_usage.completion_tokens += usage.completion_tokens
                llm_usage.total_tokens += usage.total_tokens
                llm_usage.prompt_price += usage.prompt_price
                llm_usage.completion_price += usage.completion_price
                llm_usage.total_price += usage.total_price

        model_instance = self.model_instance

        while function_call_state and iteration_step <= max_iteration_steps:
            function_call_state = False

            if iteration_step == max_iteration_steps:
                # the last iteration, remove all tools
                prompt_messages_tools = []

            message_file_ids: list[str] = []
            agent_thought_id = self.create_agent_thought(
                message_id=message.id, message="", tool_name="", tool_input="", messages_ids=message_file_ids
            )

            # recalc llm max tokens
            prompt_messages = self._organize_prompt_messages()
            self.recalc_llm_max_tokens(self.model_config, prompt_messages)
            # invoke model
            chunks: Union[Generator[LLMResultChunk, None, None], LLMResult] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_generate_entity.model_conf.parameters,
                tools=prompt_messages_tools,
                stop=app_generate_entity.model_conf.stop,
                stream=self.stream_tool_call,
                user=self.user_id,
                callbacks=[],
            )

            tool_calls: list[tuple[str, str, dict[str, Any]]] = []

            # save full response
            response = ""

            # save tool call names and inputs
            tool_call_names = ""
            tool_call_inputs = ""

            current_llm_usage = None

            if isinstance(chunks, Generator):
                is_first_chunk = True
                for chunk in chunks:
                    if is_first_chunk:
                        self.queue_manager.publish(
                            QueueAgentThoughtEvent(agent_thought_id=agent_thought_id), PublishFrom.APPLICATION_MANAGER
                        )
                        is_first_chunk = False
                    # check if there is any tool call
                    if self.check_tool_calls(chunk):
                        function_call_state = True
                        tool_calls.extend(self.extract_tool_calls(chunk) or [])
                        tool_call_names = ";".join([tool_call[1] for tool_call in tool_calls])

                        tool_call_inputs = self._prepare_tool_inputs(tool_calls)

                    if chunk.delta.message and chunk.delta.message.content:
                        if isinstance(chunk.delta.message.content, list):
                            for content in chunk.delta.message.content:
                                response += content.data
                        else:
                            response += str(chunk.delta.message.content)

                    if chunk.delta.usage:
                        increase_usage(llm_usage, chunk.delta.usage)
                        current_llm_usage = chunk.delta.usage

                    yield chunk
            else:
                result = chunks
                # check if there is any tool call
                if self.check_blocking_tool_calls(result):
                    function_call_state = True
                    tool_calls.extend(self.extract_blocking_tool_calls(result) or [])
                    tool_call_names = ";".join([tool_call[1] for tool_call in tool_calls])

                    tool_call_inputs = self._prepare_tool_inputs(tool_calls)

                if result.usage:
                    increase_usage(llm_usage, result.usage)
                    current_llm_usage = result.usage

                if result.message and result.message.content:
                    if isinstance(result.message.content, list):
                        for content in result.message.content:
                            response += content.data
                    else:
                        response += str(result.message.content)

                if not result.message.content:
                    result.message.content = ""

                self.queue_manager.publish(
                    QueueAgentThoughtEvent(agent_thought_id=agent_thought_id), PublishFrom.APPLICATION_MANAGER
                )

                yield LLMResultChunk(
                    model=model_instance.model,
                    prompt_messages=result.prompt_messages,
                    system_fingerprint=result.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=result.message,
                        usage=result.usage,
                    ),
                )

            assistant_message = AssistantPromptMessage(content=response, tool_calls=[])
            if tool_calls:
                assistant_message.tool_calls = [
                    AssistantPromptMessage.ToolCall(
                        id=tool_call[0],
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=tool_call[1], arguments=json.dumps(tool_call[2], ensure_ascii=False)
                        ),
                    )
                    for tool_call in tool_calls
                ]

            self._current_thoughts.append(assistant_message)

            # save thought
            self.save_agent_thought(
                agent_thought_id=agent_thought_id,
                tool_name=tool_call_names,
                tool_input=tool_call_inputs,
                thought=response,
                tool_invoke_meta=None,
                observation=None,
                answer=response,
                messages_ids=[],
                llm_usage=current_llm_usage,
            )
            self.queue_manager.publish(
                QueueAgentThoughtEvent(agent_thought_id=agent_thought_id), PublishFrom.APPLICATION_MANAGER
            )

            final_answer += response + "\n"

            # Check if max iteration is reached and model still wants to call tools
            if iteration_step == max_iteration_steps and tool_calls:
                raise AgentMaxIterationError(app_config.agent.max_iteration)

            # call tools
            tool_responses = []
            for tool_call_id, tool_call_name, tool_call_args in tool_calls:
                tool_instance = tool_instances.get(tool_call_name)
                if not tool_instance:
                    error_message = f"there is not a tool named {tool_call_name}"
                    tool_invoke_meta = ToolInvokeMeta.error_instance(error_message)
                    tool_invoke_response = error_message
                    tool_response = self._create_tool_response(
                        tool_call_id,
                        tool_call_name,
                        tool_call_args,
                        tool_invoke_response,
                        tool_invoke_meta,
                        False,
                    )
                    tool_responses.append(tool_response)
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
                        trace_manager=trace_manager,
                        app_id=self.application_generate_entity.app_config.app_id,
                        message_id=self.message.id,
                        conversation_id=self.conversation.id,
                    )
                    # publish files
                    for message_file_id in message_files:
                        # publish message file
                        self.queue_manager.publish(
                            QueueMessageFileEvent(message_file_id=message_file_id), PublishFrom.APPLICATION_MANAGER
                        )
                        # add message file ids
                        message_file_ids.append(message_file_id)

                    direct_flag = (tool_invoke_meta.extra or {}).get("return_direct", False)
                    tool_response = self._create_tool_response(
                        tool_call_id,
                        tool_call_name,
                        tool_call_args,
                        tool_invoke_response,
                        tool_invoke_meta,
                        direct_flag,
                    )
                    tool_responses.append(tool_response)

            if len(tool_responses) > 0:
                all_direct = all(tr.get("direct_flag") is True for tr in tool_responses)
                if all_direct:
                    llm_final_usage = llm_usage.get("usage") or LLMUsage.empty_usage()
                    yield from self._handle_direct_return(
                        agent_thought_id,
                        tool_responses,
                        response or "",
                        message_file_ids,
                        prompt_messages,
                        llm_final_usage,
                    )
                    return

                for tr in tool_responses:
                    if tr["tool_response"] is not None:
                        self._current_thoughts.append(
                            ToolPromptMessage(
                                content=str(tr["tool_response"]),
                                tool_call_id=tr["tool_call_id"],
                                name=tr["tool_call_name"],
                            )
                        )
                # save agent thought
                tool_invoke_meta_dict = self._aggregate_by_tool_name(tool_responses, "meta")
                observation = self._aggregate_by_tool_name(tool_responses, "tool_response")

                self.save_agent_thought(
                    agent_thought_id=agent_thought_id,
                    tool_name="",
                    tool_input="",
                    thought="",
                    tool_invoke_meta=tool_invoke_meta_dict,
                    observation=observation,
                    answer="",
                    messages_ids=message_file_ids,
                )
                self.queue_manager.publish(
                    QueueAgentThoughtEvent(agent_thought_id=agent_thought_id), PublishFrom.APPLICATION_MANAGER
                )

            # update prompt tool
            for prompt_tool in prompt_messages_tools:
                self.update_prompt_message_tool(tool_instances[prompt_tool.name], prompt_tool)

            iteration_step += 1

        # yield final answer
        # calculate usage
        llm_final_usage = llm_usage.get("usage") or LLMUsage.empty_usage()
        yield from self._yield_final_answer(
            final_answer=final_answer,
            prompt_messages=prompt_messages,
            usage=llm_final_usage,
            delta_content="",
        )

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

    def extract_tool_calls(self, llm_result_chunk: LLMResultChunk) -> list[tuple[str, str, dict[str, Any]]]:
        """
        Extract tool calls from llm result chunk

        Returns:
            List[Tuple[str, str, Dict[str, Any]]]: [(tool_call_id, tool_call_name, tool_call_args)]
        """
        tool_calls = []
        for prompt_message in llm_result_chunk.delta.message.tool_calls:
            args = {}
            if prompt_message.function.arguments != "":
                args = json.loads(prompt_message.function.arguments)

            tool_calls.append(
                (
                    prompt_message.id,
                    prompt_message.function.name,
                    args,
                )
            )

        return tool_calls

    def extract_blocking_tool_calls(self, llm_result: LLMResult) -> list[tuple[str, str, dict[str, Any]]]:
        """
        Extract blocking tool calls from llm result

        Returns:
            List[Tuple[str, str, Dict[str, Any]]]: [(tool_call_id, tool_call_name, tool_call_args)]
        """
        tool_calls = []
        for prompt_message in llm_result.message.tool_calls:
            args = {}
            if prompt_message.function.arguments != "":
                args = json.loads(prompt_message.function.arguments)

            tool_calls.append(
                (
                    prompt_message.id,
                    prompt_message.function.name,
                    args,
                )
            )

        return tool_calls

    def _prepare_tool_inputs(self, tool_calls: list[tuple[str, str, dict[str, Any]]]) -> str:
        """
        Prepare tool inputs from tool calls, handling multiple calls to the same tool.

        :param tool_calls: List of tool calls (id, name, args).
        :return: JSON string of organized tool inputs.
        """
        # Organize tool inputs by tool name, handling multiple calls to the same tool
        tool_inputs_map = defaultdict(list)
        for _, name, args in tool_calls:
            tool_inputs_map[name].append(args)

        # Flatten single inputs for backward compatibility or simpler structure
        final_tool_inputs = self._flatten(tool_inputs_map)

        # Handle non-serializable objects by converting them to strings
        return json.dumps(final_tool_inputs, ensure_ascii=False, default=str)

    def _create_tool_response(
        self,
        tool_call_id: str,
        tool_call_name: str,
        tool_call_args: dict[str, Any],
        tool_invoke_response: str | None,
        tool_invoke_meta: ToolInvokeMeta,
        direct_flag: bool,
    ) -> dict[str, Any]:
        """
        Create a standardized tool response dictionary.

        :param tool_call_id: The ID of the tool call.
        :param tool_call_name: The name of the tool called.
        :param tool_call_args: The arguments passed to the tool.
        :param tool_invoke_response: The response string from the tool invocation.
        :param tool_invoke_meta: Metadata associated with the tool invocation.
        :param direct_flag: Boolean flag indicating if this is a direct return.
        :return: A dictionary containing structured tool response data.
        """
        return {
            "tool_call_id": tool_call_id,
            "tool_call_name": tool_call_name,
            "tool_response": tool_invoke_response,
            "tool_call_args": tool_call_args,
            "meta": tool_invoke_meta.to_dict(),
            "direct_flag": direct_flag,
        }

    @staticmethod
    def _aggregate_by_tool_name(
        tool_responses: list[dict[str, Any]], value_key: str, default: Any = None
    ) -> dict[str, Any]:
        """
        Aggregate tool response values by tool name.

        :param tool_responses: The list of tool responses.
        :param value_key: The key to retrieve the value from the tool response.
        :param default: The default value if the key is missing.
        :return: A dictionary of aggregated values.
        """
        agg = defaultdict(list)
        for tr in tool_responses:
            if "tool_call_name" in tr:
                agg[tr["tool_call_name"]].append(tr.get(value_key, default))
        return FunctionCallAgentRunner._flatten(agg)

    @staticmethod
    def _flatten(agg_dict: dict[str, list[Any]]) -> dict[str, Any]:
        """
        Flatten a dictionary of lists into a dictionary of single values.
        If a list has only one element, it is replaced by that element.

        :param agg_dict: The dictionary to flatten.
        :return: The flattened dictionary.
        """
        return {k: (v[0] if len(v) == 1 else v) for k, v in agg_dict.items()}

    def _yield_final_answer(
        self,
        final_answer: str,
        prompt_messages: list[PromptMessage],
        usage: LLMUsage,
        delta_content: str = "",
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Yield the final answer as an LLMResultChunk and publish the MessageEndEvent.

        :param final_answer: The final answer content.
        :param prompt_messages: The prompt messages.
        :param usage: The usage statistics.
        :param delta_content: The content to be yielded in the chunk delta.
                              Defaults to "" to avoid duplicate display when yielding final answer.
        :return: A generator yielding LLMResultChunk.
        """
        yield LLMResultChunk(
            model=self.model_instance.model,
            prompt_messages=prompt_messages,
            system_fingerprint="",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=delta_content),
                usage=usage,
            ),
        )

        self.queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=LLMResult(
                    model=self.model_instance.model,
                    prompt_messages=prompt_messages,
                    message=AssistantPromptMessage(content=final_answer),
                    usage=usage,
                    system_fingerprint="",
                )
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _save_and_publish_thought(self, thought_id: str, **kwargs):
        """
        Save and publish an agent thought.

        :param thought_id: The thought ID.
        :param kwargs: Additional arguments to be passed to save_agent_thought.
        """
        self.save_agent_thought(agent_thought_id=thought_id, **kwargs)
        self.queue_manager.publish(QueueAgentThoughtEvent(agent_thought_id=thought_id), PublishFrom.APPLICATION_MANAGER)

    def _handle_direct_return(
        self,
        agent_thought_id: str,
        tool_responses: list[dict[str, Any]],
        thought: str,
        message_file_ids: list[str],
        prompt_messages: list[PromptMessage],
        usage: LLMUsage,
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Handle the direct return process when a tool is invoked with return_direct=True.

        :param agent_thought_id: The agent thought ID.
        :param tool_responses: The tool responses.
        :param thought: The thought content.
        :param message_file_ids: The message file IDs.
        :param prompt_messages: The prompt messages.
        :param usage: The usage statistics.
        :return: A generator yielding LLMResultChunk.
        """
        final_answer = "\n".join(
            [str(tr["tool_response"]) for tr in tool_responses if tr.get("tool_response") is not None]
        )
        tool_invoke_meta = self._aggregate_by_tool_name(tool_responses, "meta")
        observation = self._aggregate_by_tool_name(tool_responses, "tool_response")
        tool_input = self._aggregate_by_tool_name(tool_responses, "tool_call_args", default={})
        tool_name = ";".join(sorted({tr["tool_call_name"] for tr in tool_responses}))

        self._save_and_publish_thought(
            thought_id=agent_thought_id,
            tool_name=tool_name,
            tool_input=tool_input,
            thought=thought,
            tool_invoke_meta=tool_invoke_meta,
            observation=observation,
            answer=final_answer,
            messages_ids=message_file_ids,
        )

        final_answer_thought_id = self.create_agent_thought(
            message_id=self.message.id,
            message=final_answer,
            tool_name="",
            tool_input="",
            messages_ids=message_file_ids,
        )
        # In Dify's UI, the thought process is split into steps:
        # 1. Tool call step (Action): Requires `tool` and `observation` fields.
        # 2. Final answer step (Response): Requires `thought` and `answer` fields.
        # Even in `return_direct` mode, we must create this second thought with the final answer
        # to ensure the frontend renders the "Final Answer" bubble correctly after the tool card.
        # This maintains visual consistency with the standard ReAct loop.
        self._save_and_publish_thought(
            thought_id=final_answer_thought_id,
            tool_name="",
            tool_input="",
            thought=final_answer,
            tool_invoke_meta={},
            observation={},
            answer=final_answer,
            messages_ids=message_file_ids,
        )

        # In return_direct mode, we should NOT stream the content via delta_content.
        # 1. For text tools: The frontend will render the result via the AgentThought event (final_answer).
        #    Streaming it here would duplicate the content.
        # 2. For rich media tools (e.g., ECharts, JSON): The tool output is structured data.
        #    Forcing it into delta_content (which expects text) would send raw JSON strings (e.g., "{'a': 1}")
        #    to the chat bubble, which breaks the frontend renderer and looks bad.
        # Therefore, we send delta_content="" to keep the chat bubble clean and rely on the
        # tool's native rendering logic (AgentThought) to display the result.
        yield from self._yield_final_answer(
            final_answer=final_answer,
            prompt_messages=prompt_messages,
            usage=usage,
            delta_content="",
        )

    def _init_system_message(self, prompt_template: str, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Initialize system message
        """
        if not prompt_messages and prompt_template:
            return [
                SystemPromptMessage(content=prompt_template),
            ]

        if prompt_messages and not isinstance(prompt_messages[0], SystemPromptMessage) and prompt_template:
            prompt_messages.insert(0, SystemPromptMessage(content=prompt_template))

        return prompt_messages or []

    def _organize_user_query(self, query: str, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Organize user query
        """
        if self.files:
            # get image detail config
            image_detail_config = (
                self.application_generate_entity.file_upload_config.image_config.detail
                if (
                    self.application_generate_entity.file_upload_config
                    and self.application_generate_entity.file_upload_config.image_config
                )
                else None
            )
            image_detail_config = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

            prompt_message_contents: list[PromptMessageContentUnionTypes] = []
            for file in self.files:
                prompt_message_contents.append(
                    file_manager.to_prompt_message_content(
                        file,
                        image_detail_config=image_detail_config,
                    )
                )
            prompt_message_contents.append(TextPromptMessageContent(data=query))

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=query))

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
                    prompt_message.content = "\n".join(
                        [
                            content.data
                            if content.type == PromptMessageContentType.TEXT
                            else "[image]"
                            if content.type == PromptMessageContentType.IMAGE
                            else "[file]"
                            for content in prompt_message.content
                        ]
                    )

        return prompt_messages

    def _organize_prompt_messages(self):
        prompt_template = self.app_config.prompt_template.simple_prompt_template or ""
        self.history_prompt_messages = self._init_system_message(prompt_template, self.history_prompt_messages)
        query_prompt_messages = self._organize_user_query(self.query or "", [])

        self.history_prompt_messages = AgentHistoryPromptTransform(
            model_config=self.model_config,
            prompt_messages=[*query_prompt_messages, *self._current_thoughts],
            history_messages=self.history_prompt_messages,
            memory=self.memory,
        ).get_prompt()

        prompt_messages = [*self.history_prompt_messages, *query_prompt_messages, *self._current_thoughts]
        if len(self._current_thoughts) != 0:
            # clear messages after the first iteration
            prompt_messages = self._clear_user_prompt_image_messages(prompt_messages)
        return prompt_messages
