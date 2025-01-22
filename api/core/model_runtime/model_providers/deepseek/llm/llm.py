import json
from collections.abc import Generator
from typing import Optional, Union

import requests
from yarl import URL

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
)
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel


class DeepseekLargeLanguageModel(OAIAPICompatLargeLanguageModel):
    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        self._add_custom_parameters(credentials)
        return super()._invoke(model, credentials, prompt_messages, model_parameters, tools, stop, stream)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        self._add_custom_parameters(credentials)
        super().validate_credentials(model, credentials)

    @staticmethod
    def _add_custom_parameters(credentials) -> None:
        credentials["endpoint_url"] = str(URL(credentials.get("endpoint_url", "https://api.deepseek.com")))
        credentials["mode"] = LLMMode.CHAT.value
        credentials["function_calling_type"] = "tool_call"
        credentials["stream_function_calling"] = "support"

    def _handle_generate_stream_response(
        self, model: str, credentials: dict, response: requests.Response, prompt_messages: list[PromptMessage]
    ) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: model credentials
        :param response: streamed response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """
        full_assistant_content = ""
        chunk_index = 0
        is_reasoning_started = False  # Add flag to track reasoning state

        def create_final_llm_result_chunk(
            id: Optional[str], index: int, message: AssistantPromptMessage, finish_reason: str, usage: dict
        ) -> LLMResultChunk:
            # calculate num tokens
            prompt_tokens = usage and usage.get("prompt_tokens")
            if prompt_tokens is None:
                prompt_tokens = self._num_tokens_from_string(model, prompt_messages[0].content)
            completion_tokens = usage and usage.get("completion_tokens")
            if completion_tokens is None:
                completion_tokens = self._num_tokens_from_string(model, full_assistant_content)

            # transform usage
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                id=id,
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(index=index, message=message, finish_reason=finish_reason, usage=usage),
            )

        # delimiter for stream response, need unicode_escape
        import codecs

        delimiter = credentials.get("stream_mode_delimiter", "\n\n")
        delimiter = codecs.decode(delimiter, "unicode_escape")

        tools_calls: list[AssistantPromptMessage.ToolCall] = []

        def increase_tool_call(new_tool_calls: list[AssistantPromptMessage.ToolCall]):
            def get_tool_call(tool_call_id: str):
                if not tool_call_id:
                    return tools_calls[-1]

                tool_call = next((tool_call for tool_call in tools_calls if tool_call.id == tool_call_id), None)
                if tool_call is None:
                    tool_call = AssistantPromptMessage.ToolCall(
                        id=tool_call_id,
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments=""),
                    )
                    tools_calls.append(tool_call)

                return tool_call

            for new_tool_call in new_tool_calls:
                # get tool call
                tool_call = get_tool_call(new_tool_call.function.name)
                # update tool call
                if new_tool_call.id:
                    tool_call.id = new_tool_call.id
                if new_tool_call.type:
                    tool_call.type = new_tool_call.type
                if new_tool_call.function.name:
                    tool_call.function.name = new_tool_call.function.name
                if new_tool_call.function.arguments:
                    tool_call.function.arguments += new_tool_call.function.arguments

        finish_reason = None  # The default value of finish_reason is None
        message_id, usage = None, None
        for chunk in response.iter_lines(decode_unicode=True, delimiter=delimiter):
            chunk = chunk.strip()
            if chunk:
                # ignore sse comments
                if chunk.startswith(":"):
                    continue
                decoded_chunk = chunk.strip().removeprefix("data:").lstrip()
                if decoded_chunk == "[DONE]":  # Some provider returns "data: [DONE]"
                    continue

                try:
                    chunk_json: dict = json.loads(decoded_chunk)
                # stream ended
                except json.JSONDecodeError as e:
                    yield create_final_llm_result_chunk(
                        id=message_id,
                        index=chunk_index + 1,
                        message=AssistantPromptMessage(content=""),
                        finish_reason="Non-JSON encountered.",
                        usage=usage,
                    )
                    break
                # handle the error here. for issue #11629
                if chunk_json.get("error") and chunk_json.get("choices") is None:
                    raise ValueError(chunk_json.get("error"))

                if chunk_json:
                    if u := chunk_json.get("usage"):
                        usage = u
                if not chunk_json or len(chunk_json["choices"]) == 0:
                    continue

                choice = chunk_json["choices"][0]
                finish_reason = chunk_json["choices"][0].get("finish_reason")
                message_id = chunk_json.get("id")
                chunk_index += 1

                if "delta" in choice:
                    delta = choice["delta"]
                    is_reasoning = delta.get("reasoning_content")
                    delta_content = delta.get("content") or delta.get("reasoning_content")

                    assistant_message_tool_calls = None

                    if "tool_calls" in delta and credentials.get("function_calling_type", "no_call") == "tool_call":
                        assistant_message_tool_calls = delta.get("tool_calls", None)
                    elif (
                        "function_call" in delta
                        and credentials.get("function_calling_type", "no_call") == "function_call"
                    ):
                        assistant_message_tool_calls = [
                            {"id": "tool_call_id", "type": "function", "function": delta.get("function_call", {})}
                        ]

                    # assistant_message_function_call = delta.delta.function_call

                    # extract tool calls from response
                    if assistant_message_tool_calls:
                        tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
                        increase_tool_call(tool_calls)

                    if delta_content is None or delta_content == "":
                        continue

                    # Add markdown quote markers for reasoning content
                    if is_reasoning:
                        if not is_reasoning_started:
                            delta_content = "> 💭 " + delta_content
                            is_reasoning_started = True
                        elif "\n\n" in delta_content:
                            delta_content = delta_content.replace("\n\n", "\n> ")
                        elif "\n" in delta_content:
                            delta_content = delta_content.replace("\n", "\n> ")
                    elif is_reasoning_started:
                        # If we were in reasoning mode but now getting regular content,
                        # add \n\n to close the reasoning block
                        delta_content = "\n\n" + delta_content
                        is_reasoning_started = False

                    # transform assistant message to prompt message
                    assistant_prompt_message = AssistantPromptMessage(
                        content=delta_content,
                    )

                    # reset tool calls
                    tool_calls = []
                    full_assistant_content += delta_content
                elif "text" in choice:
                    choice_text = choice.get("text", "")
                    if choice_text == "":
                        continue

                    # transform assistant message to prompt message
                    assistant_prompt_message = AssistantPromptMessage(content=choice_text)
                    full_assistant_content += choice_text
                else:
                    continue

                yield LLMResultChunk(
                    id=message_id,
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=assistant_prompt_message,
                    ),
                )

            chunk_index += 1

        if tools_calls:
            yield LLMResultChunk(
                id=message_id,
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=chunk_index,
                    message=AssistantPromptMessage(tool_calls=tools_calls, content=""),
                ),
            )

        yield create_final_llm_result_chunk(
            id=message_id,
            index=chunk_index,
            message=AssistantPromptMessage(content=""),
            finish_reason=finish_reason,
            usage=usage,
        )
