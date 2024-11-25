import copy
import json
import logging
from collections.abc import Generator, Sequence
from typing import Optional, Union, cast

import tiktoken
from openai import AzureOpenAI, Stream
from openai.types import Completion
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageFunction,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.azure_openai._common import _CommonAzureOpenAI
from core.model_runtime.model_providers.azure_openai._constant import LLM_BASE_MODELS
from core.model_runtime.utils import helper

logger = logging.getLogger(__name__)


class AzureOpenAILargeLanguageModel(_CommonAzureOpenAI, LargeLanguageModel):
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
        base_model_name = self._get_base_model_name(credentials)
        ai_model_entity = self._get_ai_model_entity(base_model_name=base_model_name, model=model)

        if ai_model_entity and ai_model_entity.entity.model_properties.get(ModelPropertyKey.MODE) == LLMMode.CHAT.value:
            # chat model
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
        else:
            # text completion model
            return self._generate(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                stop=stop,
                stream=stream,
                user=user,
            )

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> int:
        base_model_name = self._get_base_model_name(credentials)
        model_entity = self._get_ai_model_entity(base_model_name=base_model_name, model=model)
        if not model_entity:
            raise ValueError(f"Base Model Name {base_model_name} is invalid")
        model_mode = model_entity.entity.model_properties.get(ModelPropertyKey.MODE)

        if model_mode == LLMMode.CHAT.value:
            # chat model
            return self._num_tokens_from_messages(credentials, prompt_messages, tools)
        else:
            # text completion model, do not support tool calling
            content = prompt_messages[0].content
            assert isinstance(content, str)
            return self._num_tokens_from_string(credentials, content)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        if "openai_api_base" not in credentials:
            raise CredentialsValidateFailedError("Azure OpenAI API Base Endpoint is required")

        if "openai_api_key" not in credentials:
            raise CredentialsValidateFailedError("Azure OpenAI API key is required")

        if "base_model_name" not in credentials:
            raise CredentialsValidateFailedError("Base Model Name is required")

        base_model_name = self._get_base_model_name(credentials)
        ai_model_entity = self._get_ai_model_entity(base_model_name=base_model_name, model=model)

        if not ai_model_entity:
            raise CredentialsValidateFailedError(f'Base Model Name {credentials["base_model_name"]} is invalid')

        try:
            client = AzureOpenAI(**self._to_credential_kwargs(credentials))

            if "o1" in model:
                client.chat.completions.create(
                    messages=[{"role": "user", "content": "ping"}],
                    model=model,
                    temperature=1,
                    max_completion_tokens=20,
                    stream=False,
                )
            elif ai_model_entity.entity.model_properties.get(ModelPropertyKey.MODE) == LLMMode.CHAT.value:
                # chat model
                client.chat.completions.create(
                    messages=[{"role": "user", "content": "ping"}],
                    model=model,
                    temperature=0,
                    max_tokens=20,
                    stream=False,
                )
            else:
                # text completion model
                client.completions.create(
                    prompt="ping",
                    model=model,
                    temperature=0,
                    max_tokens=20,
                    stream=False,
                )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        base_model_name = self._get_base_model_name(credentials)
        ai_model_entity = self._get_ai_model_entity(base_model_name=base_model_name, model=model)
        return ai_model_entity.entity if ai_model_entity else None

    def _generate(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        client = AzureOpenAI(**self._to_credential_kwargs(credentials))

        extra_model_kwargs = {}

        if stop:
            extra_model_kwargs["stop"] = stop

        if user:
            extra_model_kwargs["user"] = user

        # text completion model
        response = client.completions.create(
            prompt=prompt_messages[0].content, model=model, stream=stream, **model_parameters, **extra_model_kwargs
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(
        self, model: str, credentials: dict, response: Completion, prompt_messages: list[PromptMessage]
    ):
        assistant_text = response.choices[0].text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_text)

        # calculate num tokens
        if response.usage:
            # transform usage
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens
        else:
            # calculate num tokens
            content = prompt_messages[0].content
            assert isinstance(content, str)
            prompt_tokens = self._num_tokens_from_string(credentials, content)
            completion_tokens = self._num_tokens_from_string(credentials, assistant_text)

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=response.model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
            system_fingerprint=response.system_fingerprint,
        )

        return result

    def _handle_generate_stream_response(
        self, model: str, credentials: dict, response: Stream[Completion], prompt_messages: list[PromptMessage]
    ) -> Generator:
        full_text = ""
        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.text is None or delta.text == ""):
                continue

            # transform assistant message to prompt message
            text = delta.text or ""
            assistant_prompt_message = AssistantPromptMessage(content=text)

            full_text += text

            if delta.finish_reason is not None:
                # calculate num tokens
                if chunk.usage:
                    # transform usage
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens
                else:
                    # calculate num tokens
                    content = prompt_messages[0].content
                    assert isinstance(content, str)
                    prompt_tokens = self._num_tokens_from_string(credentials, content)
                    completion_tokens = self._num_tokens_from_string(credentials, full_text)

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
                        usage=usage,
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
        client = AzureOpenAI(**self._to_credential_kwargs(credentials))

        response_format = model_parameters.get("response_format")
        if response_format:
            if response_format == "json_schema":
                json_schema = model_parameters.get("json_schema")
                if not json_schema:
                    raise ValueError("Must define JSON Schema when the response format is json_schema")
                try:
                    schema = json.loads(json_schema)
                except:
                    raise ValueError(f"not correct json_schema format: {json_schema}")
                model_parameters.pop("json_schema")
                model_parameters["response_format"] = {"type": "json_schema", "json_schema": schema}
            else:
                model_parameters["response_format"] = {"type": response_format}

        extra_model_kwargs = {}

        if tools:
            extra_model_kwargs["tools"] = [helper.dump_model(PromptMessageFunction(function=tool)) for tool in tools]

        if stop:
            extra_model_kwargs["stop"] = stop

        if user:
            extra_model_kwargs["user"] = user

        # clear illegal prompt messages
        prompt_messages = self._clear_illegal_prompt_messages(model, prompt_messages)

        block_as_stream = False
        if "o1" in model:
            if stream:
                block_as_stream = True
                stream = False

                if "stream_options" in extra_model_kwargs:
                    del extra_model_kwargs["stream_options"]

            if "stop" in extra_model_kwargs:
                del extra_model_kwargs["stop"]

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

        block_result = self._handle_chat_generate_response(model, credentials, response, prompt_messages, tools)

        if block_as_stream:
            return self._handle_chat_block_as_stream_response(block_result, prompt_messages, stop)

        return block_result

    def _handle_chat_block_as_stream_response(
        self,
        block_result: LLMResult,
        prompt_messages: list[PromptMessage],
        stop: Optional[list[str]] = None,
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :param stop: stop words
        :return: llm response chunk generator
        """
        text = block_result.message.content
        text = cast(str, text)

        if stop:
            text = self.enforce_stop_tokens(text, stop)

        yield LLMResultChunk(
            model=block_result.model,
            prompt_messages=prompt_messages,
            system_fingerprint=block_result.system_fingerprint,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=text),
                finish_reason="stop",
                usage=block_result.usage,
            ),
        )

    def _clear_illegal_prompt_messages(self, model: str, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Clear illegal prompt messages for OpenAI API

        :param model: model name
        :param prompt_messages: prompt messages
        :return: cleaned prompt messages
        """
        checklist = ["gpt-4-turbo", "gpt-4-turbo-2024-04-09"]

        if model in checklist:
            # count how many user messages are there
            user_message_count = len([m for m in prompt_messages if isinstance(m, UserPromptMessage)])
            if user_message_count > 1:
                for prompt_message in prompt_messages:
                    if isinstance(prompt_message, UserPromptMessage):
                        if isinstance(prompt_message.content, list):
                            prompt_message.content = "\n".join(
                                [
                                    item.data
                                    if item.type == PromptMessageContentType.TEXT
                                    else "[IMAGE]"
                                    if item.type == PromptMessageContentType.IMAGE
                                    else ""
                                    for item in prompt_message.content
                                ]
                            )

        if "o1" in model:
            system_message_count = len([m for m in prompt_messages if isinstance(m, SystemPromptMessage)])
            if system_message_count > 0:
                new_prompt_messages = []
                for prompt_message in prompt_messages:
                    if isinstance(prompt_message, SystemPromptMessage):
                        prompt_message = UserPromptMessage(
                            content=prompt_message.content,
                            name=prompt_message.name,
                        )

                    new_prompt_messages.append(prompt_message)
                prompt_messages = new_prompt_messages

        return prompt_messages

    def _handle_chat_generate_response(
        self,
        model: str,
        credentials: dict,
        response: ChatCompletion,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ):
        assistant_message = response.choices[0].message
        assistant_message_tool_calls = assistant_message.tool_calls

        # extract tool calls from response
        tool_calls = []
        self._update_tool_calls(tool_calls=tool_calls, tool_calls_response=assistant_message_tool_calls)

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_message.content, tool_calls=tool_calls)

        # calculate num tokens
        if response.usage:
            # transform usage
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens
        else:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_messages(credentials, prompt_messages, tools)
            completion_tokens = self._num_tokens_from_messages(credentials, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=response.model or model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
            system_fingerprint=response.system_fingerprint,
        )

        return result

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        response: Stream[ChatCompletionChunk],
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ):
        index = 0
        full_assistant_content = ""
        real_model = model
        system_fingerprint = None
        completion = ""
        tool_calls = []
        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]
            # NOTE: For fix https://github.com/langgenius/dify/issues/5790
            if delta.delta is None:
                continue

            # extract tool calls from response
            self._update_tool_calls(tool_calls=tool_calls, tool_calls_response=delta.delta.tool_calls)

            # Handling exceptions when content filters' streaming mode is set to asynchronous modified filter
            if delta.finish_reason is None and not delta.delta.content:
                continue

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(content=delta.delta.content or "", tool_calls=tool_calls)

            full_assistant_content += delta.delta.content or ""

            real_model = chunk.model
            system_fingerprint = chunk.system_fingerprint
            completion += delta.delta.content or ""

            yield LLMResultChunk(
                model=real_model,
                prompt_messages=prompt_messages,
                system_fingerprint=system_fingerprint,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=assistant_prompt_message,
                ),
            )

            index += 1

        # calculate num tokens
        prompt_tokens = self._num_tokens_from_messages(credentials, prompt_messages, tools)

        full_assistant_prompt_message = AssistantPromptMessage(content=completion)
        completion_tokens = self._num_tokens_from_messages(credentials, [full_assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        yield LLMResultChunk(
            model=real_model,
            prompt_messages=prompt_messages,
            system_fingerprint=system_fingerprint,
            delta=LLMResultChunkDelta(
                index=index, message=AssistantPromptMessage(content=""), finish_reason="stop", usage=usage
            ),
        )

    @staticmethod
    def _update_tool_calls(
        tool_calls: list[AssistantPromptMessage.ToolCall],
        tool_calls_response: Optional[Sequence[ChatCompletionMessageToolCall | ChoiceDeltaToolCall]],
    ) -> None:
        if tool_calls_response:
            for response_tool_call in tool_calls_response:
                if isinstance(response_tool_call, ChatCompletionMessageToolCall):
                    function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                        name=response_tool_call.function.name, arguments=response_tool_call.function.arguments
                    )

                    tool_call = AssistantPromptMessage.ToolCall(
                        id=response_tool_call.id, type=response_tool_call.type, function=function
                    )
                    tool_calls.append(tool_call)
                elif isinstance(response_tool_call, ChoiceDeltaToolCall):
                    index = response_tool_call.index
                    if index < len(tool_calls):
                        tool_calls[index].id = response_tool_call.id or tool_calls[index].id
                        tool_calls[index].type = response_tool_call.type or tool_calls[index].type
                        if response_tool_call.function:
                            tool_calls[index].function.name = (
                                response_tool_call.function.name or tool_calls[index].function.name
                            )
                            tool_calls[index].function.arguments += response_tool_call.function.arguments or ""
                    else:
                        assert response_tool_call.id is not None
                        assert response_tool_call.type is not None
                        assert response_tool_call.function is not None
                        assert response_tool_call.function.name is not None
                        assert response_tool_call.function.arguments is not None

                        function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=response_tool_call.function.name, arguments=response_tool_call.function.arguments
                        )
                        tool_call = AssistantPromptMessage.ToolCall(
                            id=response_tool_call.id, type=response_tool_call.type, function=function
                        )
                        tool_calls.append(tool_call)

    @staticmethod
    def _convert_prompt_message_to_dict(message: PromptMessage):
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                sub_messages = []
                assert message.content is not None
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
            # message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
            if message.tool_calls:
                message_dict["tool_calls"] = [helper.dump_model(tool_call) for tool_call in message.tool_calls]
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = {
                "role": "tool",
                "name": message.name,
                "content": message.content,
                "tool_call_id": message.tool_call_id,
            }
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name:
            message_dict["name"] = message.name

        return message_dict

    def _num_tokens_from_string(
        self, credentials: dict, text: str, tools: Optional[list[PromptMessageTool]] = None
    ) -> int:
        try:
            encoding = tiktoken.encoding_for_model(credentials["base_model_name"])
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")

        num_tokens = len(encoding.encode(text))

        if tools:
            num_tokens += self._num_tokens_for_tools(encoding, tools)

        return num_tokens

    def _num_tokens_from_messages(
        self, credentials: dict, messages: list[PromptMessage], tools: Optional[list[PromptMessageTool]] = None
    ) -> int:
        """Calculate num tokens for gpt-3.5-turbo and gpt-4 with tiktoken package.

        Official documentation: https://github.com/openai/openai-cookbook/blob/
        main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb"""
        model = credentials["base_model_name"]
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            logger.warning("Warning: model not found. Using cl100k_base encoding.")
            model = "cl100k_base"
            encoding = tiktoken.get_encoding(model)

        if model.startswith("gpt-35-turbo-0301"):
            # every message follows <im_start>{role/name}\n{content}<im_end>\n
            tokens_per_message = 4
            # if there's a name, the role is omitted
            tokens_per_name = -1
        elif model.startswith("gpt-35-turbo") or model.startswith("gpt-4") or "o1" in model:
            tokens_per_message = 3
            tokens_per_name = 1
        else:
            raise NotImplementedError(
                f"get_num_tokens_from_messages() is not presently implemented "
                f"for model {model}."
                "See https://github.com/openai/openai-python/blob/main/chatml.md for "
                "information on how messages are converted to tokens."
            )
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
                        assert isinstance(tool_call, dict)
                        for t_key, t_value in tool_call.items():
                            num_tokens += len(encoding.encode(t_key))
                            if t_key == "function":
                                for f_key, f_value in t_value.items():
                                    num_tokens += len(encoding.encode(f_key))
                                    num_tokens += len(encoding.encode(f_value))
                            else:
                                num_tokens += len(encoding.encode(t_key))
                                num_tokens += len(encoding.encode(t_value))
                else:
                    num_tokens += len(encoding.encode(str(value)))

                if key == "name":
                    num_tokens += tokens_per_name

        # every reply is primed with <im_start>assistant
        num_tokens += 3

        if tools:
            num_tokens += self._num_tokens_for_tools(encoding, tools)

        return num_tokens

    @staticmethod
    def _num_tokens_for_tools(encoding: tiktoken.Encoding, tools: list[PromptMessageTool]) -> int:
        num_tokens = 0
        for tool in tools:
            num_tokens += len(encoding.encode("type"))
            num_tokens += len(encoding.encode("function"))

            # calculate num tokens for function object
            num_tokens += len(encoding.encode("name"))
            num_tokens += len(encoding.encode(tool.name))
            num_tokens += len(encoding.encode("description"))
            num_tokens += len(encoding.encode(tool.description))
            parameters = tool.parameters
            num_tokens += len(encoding.encode("parameters"))
            if "title" in parameters:
                num_tokens += len(encoding.encode("title"))
                num_tokens += len(encoding.encode(parameters["title"]))
            num_tokens += len(encoding.encode("type"))
            num_tokens += len(encoding.encode(parameters["type"]))
            if "properties" in parameters:
                num_tokens += len(encoding.encode("properties"))
                for key, value in parameters["properties"].items():
                    num_tokens += len(encoding.encode(key))
                    for field_key, field_value in value.items():
                        num_tokens += len(encoding.encode(field_key))
                        if field_key == "enum":
                            for enum_field in field_value:
                                num_tokens += 3
                                num_tokens += len(encoding.encode(enum_field))
                        else:
                            num_tokens += len(encoding.encode(field_key))
                            num_tokens += len(encoding.encode(str(field_value)))
            if "required" in parameters:
                num_tokens += len(encoding.encode("required"))
                for required_field in parameters["required"]:
                    num_tokens += 3
                    num_tokens += len(encoding.encode(required_field))

        return num_tokens

    @staticmethod
    def _get_ai_model_entity(base_model_name: str, model: str):
        for ai_model_entity in LLM_BASE_MODELS:
            if ai_model_entity.base_model_name == base_model_name:
                ai_model_entity_copy = copy.deepcopy(ai_model_entity)
                ai_model_entity_copy.entity.model = model
                ai_model_entity_copy.entity.label.en_US = model
                ai_model_entity_copy.entity.label.zh_Hans = model
                return ai_model_entity_copy

    def _get_base_model_name(self, credentials: dict) -> str:
        base_model_name = credentials.get("base_model_name")
        if not base_model_name:
            raise ValueError("Base Model Name is required")
        return base_model_name
