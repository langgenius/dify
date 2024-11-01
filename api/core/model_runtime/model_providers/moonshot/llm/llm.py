import json
from collections.abc import Generator
from typing import Optional, Union, cast

import requests

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContent,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
)
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel


class MoonshotLargeLanguageModel(OAIAPICompatLargeLanguageModel):
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
        self._add_function_call(model, credentials)
        user = user[:32] if user else None
        # {"response_format": "json_object"} need convert to {"response_format": {"type": "json_object"}}
        if "response_format" in model_parameters:
            model_parameters["response_format"] = {"type": model_parameters.get("response_format")}
        return super()._invoke(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        self._add_custom_parameters(credentials)
        super().validate_credentials(model, credentials)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        return AIModelEntity(
            model=model,
            label=I18nObject(en_US=model, zh_Hans=model),
            model_type=ModelType.LLM,
            features=[ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL, ModelFeature.STREAM_TOOL_CALL]
            if credentials.get("function_calling_type") == "tool_call"
            else [],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: int(credentials.get("context_size", 4096)),
                ModelPropertyKey.MODE: LLMMode.CHAT.value,
            },
            parameter_rules=[
                ParameterRule(
                    name="temperature",
                    use_template="temperature",
                    label=I18nObject(en_US="Temperature", zh_Hans="温度"),
                    type=ParameterType.FLOAT,
                ),
                ParameterRule(
                    name="max_tokens",
                    use_template="max_tokens",
                    default=512,
                    min=1,
                    max=int(credentials.get("max_tokens", 4096)),
                    label=I18nObject(en_US="Max Tokens", zh_Hans="最大标记"),
                    type=ParameterType.INT,
                ),
                ParameterRule(
                    name="top_p",
                    use_template="top_p",
                    label=I18nObject(en_US="Top P", zh_Hans="Top P"),
                    type=ParameterType.FLOAT,
                ),
            ],
        )

    def _add_custom_parameters(self, credentials: dict) -> None:
        credentials["mode"] = "chat"
        if "endpoint_url" not in credentials or credentials["endpoint_url"] == "":
            credentials["endpoint_url"] = "https://api.moonshot.cn/v1"

    def _add_function_call(self, model: str, credentials: dict) -> None:
        model_schema = self.get_model_schema(model, credentials)
        if model_schema and {ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL}.intersection(
            model_schema.features or []
        ):
            credentials["function_calling_type"] = "tool_call"

    def _convert_prompt_message_to_dict(self, message: PromptMessage, credentials: Optional[dict] = None) -> dict:
        """
        Convert PromptMessage to dict for OpenAI API format
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                sub_messages = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(PromptMessageContent, message_content)
                        sub_message_dict = {"type": "text", "text": message_content.data}
                        sub_messages.append(sub_message_dict)
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(ImagePromptMessageContent, message_content)
                        sub_message_dict = {
                            "type": "image_url",
                            "image_url": {"url": message_content.data, "detail": message_content.detail.value},
                        }
                        sub_messages.append(sub_message_dict)
                message_dict = {"role": "user", "content": sub_messages}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
            if message.tool_calls:
                message_dict["tool_calls"] = []
                for function_call in message.tool_calls:
                    message_dict["tool_calls"].append(
                        {
                            "id": function_call.id,
                            "type": function_call.type,
                            "function": {
                                "name": function_call.function.name,
                                "arguments": function_call.function.arguments,
                            },
                        }
                    )
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = {"role": "tool", "content": message.content, "tool_call_id": message.tool_call_id}
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name:
            message_dict["name"] = message.name

        return message_dict

    def _extract_response_tool_calls(self, response_tool_calls: list[dict]) -> list[AssistantPromptMessage.ToolCall]:
        """
        Extract tool calls from response

        :param response_tool_calls: response tool calls
        :return: list of tool calls
        """
        tool_calls = []
        if response_tool_calls:
            for response_tool_call in response_tool_calls:
                function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=response_tool_call["function"]["name"]
                    if response_tool_call.get("function", {}).get("name")
                    else "",
                    arguments=response_tool_call["function"]["arguments"]
                    if response_tool_call.get("function", {}).get("arguments")
                    else "",
                )

                tool_call = AssistantPromptMessage.ToolCall(
                    id=response_tool_call["id"] if response_tool_call.get("id") else "",
                    type=response_tool_call["type"] if response_tool_call.get("type") else "",
                    function=function,
                )
                tool_calls.append(tool_call)

        return tool_calls

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

        def create_final_llm_result_chunk(
            index: int, message: AssistantPromptMessage, finish_reason: str
        ) -> LLMResultChunk:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_string(model, prompt_messages[0].content)
            completion_tokens = self._num_tokens_from_string(model, full_assistant_content)

            # transform usage
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(index=index, message=message, finish_reason=finish_reason, usage=usage),
            )

        tools_calls: list[AssistantPromptMessage.ToolCall] = []
        finish_reason = "Unknown"

        def increase_tool_call(new_tool_calls: list[AssistantPromptMessage.ToolCall]):
            def get_tool_call(tool_name: str):
                if not tool_name:
                    return tools_calls[-1]

                tool_call = next((tool_call for tool_call in tools_calls if tool_call.function.name == tool_name), None)
                if tool_call is None:
                    tool_call = AssistantPromptMessage.ToolCall(
                        id="",
                        type="",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name=tool_name, arguments=""),
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

        for chunk in response.iter_lines(decode_unicode=True, delimiter="\n\n"):
            if chunk:
                # ignore sse comments
                if chunk.startswith(":"):
                    continue
                decoded_chunk = chunk.strip().lstrip("data: ").lstrip()
                chunk_json = None
                try:
                    chunk_json = json.loads(decoded_chunk)
                # stream ended
                except json.JSONDecodeError as e:
                    yield create_final_llm_result_chunk(
                        index=chunk_index + 1,
                        message=AssistantPromptMessage(content=""),
                        finish_reason="Non-JSON encountered.",
                    )
                    break
                if not chunk_json or len(chunk_json["choices"]) == 0:
                    continue

                choice = chunk_json["choices"][0]
                finish_reason = chunk_json["choices"][0].get("finish_reason")
                chunk_index += 1

                if "delta" in choice:
                    delta = choice["delta"]
                    delta_content = delta.get("content")

                    assistant_message_tool_calls = delta.get("tool_calls", None)
                    # assistant_message_function_call = delta.delta.function_call

                    # extract tool calls from response
                    if assistant_message_tool_calls:
                        tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
                        increase_tool_call(tool_calls)

                    if delta_content is None or delta_content == "":
                        continue

                    # transform assistant message to prompt message
                    assistant_prompt_message = AssistantPromptMessage(
                        content=delta_content, tool_calls=tool_calls if assistant_message_tool_calls else []
                    )

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

                # check payload indicator for completion
                yield LLMResultChunk(
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
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=chunk_index,
                    message=AssistantPromptMessage(tool_calls=tools_calls, content=""),
                ),
            )

        yield create_final_llm_result_chunk(
            index=chunk_index, message=AssistantPromptMessage(content=""), finish_reason=finish_reason
        )
