import logging
from collections.abc import Generator
from typing import Optional, Union, cast

from openai import OpenAI, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_chunk import ChoiceDeltaFunctionCall, ChoiceDeltaToolCall
from openai.types.chat.chat_completion_message import FunctionCall

from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.fireworks._common import _CommonFireworks

logger = logging.getLogger(__name__)

FIREWORKS_BLOCK_MODE_PROMPT = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>
"""  # noqa: E501


class FireworksLargeLanguageModel(_CommonFireworks, LargeLanguageModel):
    """
    Model class for Fireworks large language model.
    """

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
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """

        return self._chat_generate(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

    def _code_block_mode_wrapper(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> Union[LLMResult, Generator]:
        """
        Code block mode wrapper for invoking large language model
        """
        if "response_format" in model_parameters and model_parameters["response_format"] in {"JSON", "XML"}:
            stop = stop or []
            self._transform_chat_json_prompts(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
                response_format=model_parameters["response_format"],
            )
            model_parameters.pop("response_format")

            return self._invoke(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
            )

    def _transform_chat_json_prompts(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        response_format: str = "JSON",
    ) -> None:
        """
        Transform json prompts
        """
        if stop is None:
            stop = []
        if "```\n" not in stop:
            stop.append("```\n")
        if "\n```" not in stop:
            stop.append("\n```")

        if len(prompt_messages) > 0 and isinstance(prompt_messages[0], SystemPromptMessage):
            prompt_messages[0] = SystemPromptMessage(
                content=FIREWORKS_BLOCK_MODE_PROMPT.replace("{{instructions}}", prompt_messages[0].content).replace(
                    "{{block}}", response_format
                )
            )
            prompt_messages.append(AssistantPromptMessage(content=f"\n```{response_format}\n"))
        else:
            prompt_messages.insert(
                0,
                SystemPromptMessage(
                    content=FIREWORKS_BLOCK_MODE_PROMPT.replace(
                        "{{instructions}}", f"Please output a valid {response_format} object."
                    ).replace("{{block}}", response_format)
                ),
            )
            prompt_messages.append(AssistantPromptMessage(content=f"\n```{response_format}"))

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        return self._num_tokens_from_messages(model, prompt_messages, tools)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)

            client.chat.completions.create(
                messages=[{"role": "user", "content": "ping"}], model=model, temperature=0, max_tokens=10, stream=False
            )
        except Exception as e:
            raise CredentialsValidateFailedError(str(e))

    def _chat_generate(
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
        credentials_kwargs = self._to_credential_kwargs(credentials)
        client = OpenAI(**credentials_kwargs)

        extra_model_kwargs = {}

        if tools:
            extra_model_kwargs["functions"] = [
                {"name": tool.name, "description": tool.description, "parameters": tool.parameters} for tool in tools
            ]

        if stop:
            extra_model_kwargs["stop"] = stop

        if user:
            extra_model_kwargs["user"] = user

        # chat model
        response = client.chat.completions.create(
            messages=[self._convert_prompt_message_to_dict(m) for m in prompt_messages],
            model=model,
            stream=stream,
            **model_parameters,
            **extra_model_kwargs,
        )

        if stream:
            return self._handle_chat_generate_stream_response(model, credentials, response, prompt_messages, tools)
        return self._handle_chat_generate_response(model, credentials, response, prompt_messages, tools)

    def _handle_chat_generate_response(
        self,
        model: str,
        credentials: dict,
        response: ChatCompletion,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return: llm response
        """
        assistant_message = response.choices[0].message
        # assistant_message_tool_calls = assistant_message.tool_calls
        assistant_message_function_call = assistant_message.function_call

        # extract tool calls from response
        # tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
        function_call = self._extract_response_function_call(assistant_message_function_call)
        tool_calls = [function_call] if function_call else []

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_message.content, tool_calls=tool_calls)

        # calculate num tokens
        if response.usage:
            # transform usage
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens
        else:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_messages(model, prompt_messages, tools)
            completion_tokens = self._num_tokens_from_messages(model, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        response = LLMResult(
            model=response.model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
            system_fingerprint=response.system_fingerprint,
        )

        return response

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        response: Stream[ChatCompletionChunk],
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> Generator:
        """
        Handle llm chat stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return: llm response chunk generator
        """
        full_assistant_content = ""
        delta_assistant_message_function_call_storage: Optional[ChoiceDeltaFunctionCall] = None
        prompt_tokens = 0
        completion_tokens = 0
        final_tool_calls = []
        final_chunk = LLMResultChunk(
            model=model,
            prompt_messages=prompt_messages,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=""),
            ),
        )

        for chunk in response:
            if len(chunk.choices) == 0:
                if chunk.usage:
                    # calculate num tokens
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens
                continue

            delta = chunk.choices[0]
            has_finish_reason = delta.finish_reason is not None

            if (
                not has_finish_reason
                and (delta.delta.content is None or delta.delta.content == "")
                and delta.delta.function_call is None
            ):
                continue

            # assistant_message_tool_calls = delta.delta.tool_calls
            assistant_message_function_call = delta.delta.function_call

            # extract tool calls from response
            if delta_assistant_message_function_call_storage is not None:
                # handle process of stream function call
                if assistant_message_function_call:
                    # message has not ended ever
                    delta_assistant_message_function_call_storage.arguments += assistant_message_function_call.arguments
                    continue
                else:
                    # message has ended
                    assistant_message_function_call = delta_assistant_message_function_call_storage
                    delta_assistant_message_function_call_storage = None
            else:
                if assistant_message_function_call:
                    # start of stream function call
                    delta_assistant_message_function_call_storage = assistant_message_function_call
                    if delta_assistant_message_function_call_storage.arguments is None:
                        delta_assistant_message_function_call_storage.arguments = ""
                    if not has_finish_reason:
                        continue

            # tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
            function_call = self._extract_response_function_call(assistant_message_function_call)
            tool_calls = [function_call] if function_call else []
            if tool_calls:
                final_tool_calls.extend(tool_calls)

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(content=delta.delta.content or "", tool_calls=tool_calls)

            full_assistant_content += delta.delta.content or ""

            if has_finish_reason:
                final_chunk = LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                    ),
                )

        if not prompt_tokens:
            prompt_tokens = self._num_tokens_from_messages(model, prompt_messages, tools)

        if not completion_tokens:
            full_assistant_prompt_message = AssistantPromptMessage(
                content=full_assistant_content, tool_calls=final_tool_calls
            )
            completion_tokens = self._num_tokens_from_messages(model, [full_assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)
        final_chunk.delta.usage = usage

        yield final_chunk

    def _extract_response_tool_calls(
        self, response_tool_calls: list[ChatCompletionMessageToolCall | ChoiceDeltaToolCall]
    ) -> list[AssistantPromptMessage.ToolCall]:
        """
        Extract tool calls from response

        :param response_tool_calls: response tool calls
        :return: list of tool calls
        """
        tool_calls = []
        if response_tool_calls:
            for response_tool_call in response_tool_calls:
                function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=response_tool_call.function.name, arguments=response_tool_call.function.arguments
                )

                tool_call = AssistantPromptMessage.ToolCall(
                    id=response_tool_call.id, type=response_tool_call.type, function=function
                )
                tool_calls.append(tool_call)

        return tool_calls

    def _extract_response_function_call(
        self, response_function_call: FunctionCall | ChoiceDeltaFunctionCall
    ) -> AssistantPromptMessage.ToolCall:
        """
        Extract function call from response

        :param response_function_call: response function call
        :return: tool call
        """
        tool_call = None
        if response_function_call:
            function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                name=response_function_call.name, arguments=response_function_call.arguments
            )

            tool_call = AssistantPromptMessage.ToolCall(
                id=response_function_call.name, type="function", function=function
            )

        return tool_call

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for Fireworks API
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                sub_messages = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
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
                # message_dict["tool_calls"] = [tool_call.dict() for tool_call in
                #                               message.tool_calls]
                function_call = message.tool_calls[0]
                message_dict["function_call"] = {
                    "name": function_call.function.name,
                    "arguments": function_call.function.arguments,
                }
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            # message_dict = {
            #     "role": "tool",
            #     "content": message.content,
            #     "tool_call_id": message.tool_call_id
            # }
            message_dict = {"role": "function", "content": message.content, "name": message.tool_call_id}
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name:
            message_dict["name"] = message.name

        return message_dict

    def _num_tokens_from_messages(
        self,
        model: str,
        messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
        credentials: Optional[dict] = None,
    ) -> int:
        """
        Approximate num tokens with GPT2 tokenizer.
        """

        tokens_per_message = 3
        tokens_per_name = 1

        num_tokens = 0
        messages_dict = [self._convert_prompt_message_to_dict(m) for m in messages]
        for message in messages_dict:
            num_tokens += tokens_per_message
            for key, value in message.items():
                # Cast str(value) in case the message value is not a string
                # This occurs with function messages
                # TODO: The current token calculation method for the image type is not implemented,
                #  which need to download the image and then get the resolution for calculation,
                #  and will increase the request delay
                if isinstance(value, list):
                    text = ""
                    for item in value:
                        if isinstance(item, dict) and item["type"] == "text":
                            text += item["text"]

                    value = text

                if key == "tool_calls":
                    for tool_call in value:
                        for t_key, t_value in tool_call.items():
                            num_tokens += self._get_num_tokens_by_gpt2(t_key)
                            if t_key == "function":
                                for f_key, f_value in t_value.items():
                                    num_tokens += self._get_num_tokens_by_gpt2(f_key)
                                    num_tokens += self._get_num_tokens_by_gpt2(f_value)
                            else:
                                num_tokens += self._get_num_tokens_by_gpt2(t_key)
                                num_tokens += self._get_num_tokens_by_gpt2(t_value)
                else:
                    num_tokens += self._get_num_tokens_by_gpt2(str(value))

                if key == "name":
                    num_tokens += tokens_per_name

        # every reply is primed with <im_start>assistant
        num_tokens += 3

        if tools:
            num_tokens += self._num_tokens_for_tools(tools)

        return num_tokens

    def _num_tokens_for_tools(self, tools: list[PromptMessageTool]) -> int:
        """
        Calculate num tokens for tool calling with tiktoken package.

        :param tools: tools for tool calling
        :return: number of tokens
        """
        num_tokens = 0
        for tool in tools:
            num_tokens += self._get_num_tokens_by_gpt2("type")
            num_tokens += self._get_num_tokens_by_gpt2("function")
            num_tokens += self._get_num_tokens_by_gpt2("function")

            # calculate num tokens for function object
            num_tokens += self._get_num_tokens_by_gpt2("name")
            num_tokens += self._get_num_tokens_by_gpt2(tool.name)
            num_tokens += self._get_num_tokens_by_gpt2("description")
            num_tokens += self._get_num_tokens_by_gpt2(tool.description)
            parameters = tool.parameters
            num_tokens += self._get_num_tokens_by_gpt2("parameters")
            if "title" in parameters:
                num_tokens += self._get_num_tokens_by_gpt2("title")
                num_tokens += self._get_num_tokens_by_gpt2(parameters.get("title"))
            num_tokens += self._get_num_tokens_by_gpt2("type")
            num_tokens += self._get_num_tokens_by_gpt2(parameters.get("type"))
            if "properties" in parameters:
                num_tokens += self._get_num_tokens_by_gpt2("properties")
                for key, value in parameters.get("properties").items():
                    num_tokens += self._get_num_tokens_by_gpt2(key)
                    for field_key, field_value in value.items():
                        num_tokens += self._get_num_tokens_by_gpt2(field_key)
                        if field_key == "enum":
                            for enum_field in field_value:
                                num_tokens += 3
                                num_tokens += self._get_num_tokens_by_gpt2(enum_field)
                        else:
                            num_tokens += self._get_num_tokens_by_gpt2(field_key)
                            num_tokens += self._get_num_tokens_by_gpt2(str(field_value))
            if "required" in parameters:
                num_tokens += self._get_num_tokens_by_gpt2("required")
                for required_field in parameters["required"]:
                    num_tokens += 3
                    num_tokens += self._get_num_tokens_by_gpt2(required_field)

        return num_tokens
