import copy
import logging
from collections.abc import Generator
from typing import Optional, Union, cast

import tiktoken
from openai import AzureOpenAI, Stream
from openai.types import Completion
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_chunk import ChoiceDeltaFunctionCall, ChoiceDeltaToolCall
from openai.types.chat.chat_completion_message import FunctionCall

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
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
from core.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.azure_openai._common import _CommonAzureOpenAI
from core.model_runtime.model_providers.azure_openai._constant import LLM_BASE_MODELS, AzureBaseModel

logger = logging.getLogger(__name__)


class AzureOpenAILargeLanguageModel(_CommonAzureOpenAI, LargeLanguageModel):

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:

        ai_model_entity = self._get_ai_model_entity(credentials.get('base_model_name'), model)

        if ai_model_entity.entity.model_properties.get(ModelPropertyKey.MODE) == LLMMode.CHAT.value:
            # chat model
            return self._chat_generate(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user
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
                user=user
            )

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:

        model_mode = self._get_ai_model_entity(credentials.get('base_model_name'), model).entity.model_properties.get(
            ModelPropertyKey.MODE)

        if model_mode == LLMMode.CHAT.value:
            # chat model
            return self._num_tokens_from_messages(credentials, prompt_messages, tools)
        else:
            # text completion model, do not support tool calling
            return self._num_tokens_from_string(credentials, prompt_messages[0].content)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        if 'openai_api_base' not in credentials:
            raise CredentialsValidateFailedError('Azure OpenAI API Base Endpoint is required')

        if 'openai_api_key' not in credentials:
            raise CredentialsValidateFailedError('Azure OpenAI API key is required')

        if 'base_model_name' not in credentials:
            raise CredentialsValidateFailedError('Base Model Name is required')

        ai_model_entity = self._get_ai_model_entity(credentials.get('base_model_name'), model)

        if not ai_model_entity:
            raise CredentialsValidateFailedError(f'Base Model Name {credentials["base_model_name"]} is invalid')

        try:
            client = AzureOpenAI(**self._to_credential_kwargs(credentials))

            if ai_model_entity.entity.model_properties.get(ModelPropertyKey.MODE) == LLMMode.CHAT.value:
                # chat model
                client.chat.completions.create(
                    messages=[{"role": "user", "content": 'ping'}],
                    model=model,
                    temperature=0,
                    max_tokens=20,
                    stream=False,
                )
            else:
                # text completion model
                client.completions.create(
                    prompt='ping',
                    model=model,
                    temperature=0,
                    max_tokens=20,
                    stream=False,
                )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        ai_model_entity = self._get_ai_model_entity(credentials.get('base_model_name'), model)
        return ai_model_entity.entity if ai_model_entity else None

    def _generate(self, model: str, credentials: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict, stop: Optional[list[str]] = None,
                  stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:

        client = AzureOpenAI(**self._to_credential_kwargs(credentials))

        extra_model_kwargs = {}

        if stop:
            extra_model_kwargs['stop'] = stop

        if user:
            extra_model_kwargs['user'] = user

        # text completion model
        response = client.completions.create(
            prompt=prompt_messages[0].content,
            model=model,
            stream=stream,
            **model_parameters,
            **extra_model_kwargs
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, response: Completion,
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        assistant_text = response.choices[0].text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_text
        )

        # calculate num tokens
        if response.usage:
            # transform usage
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens
        else:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_string(credentials, prompt_messages[0].content)
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

    def _handle_generate_stream_response(self, model: str, credentials: dict, response: Stream[Completion],
                                         prompt_messages: list[PromptMessage]) -> Generator:
        full_text = ''
        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.text is None or delta.text == ''):
                continue

            # transform assistant message to prompt message
            text = delta.text if delta.text else ''
            assistant_prompt_message = AssistantPromptMessage(
                content=text
            )

            full_text += text

            if delta.finish_reason is not None:
                # calculate num tokens
                if chunk.usage:
                    # transform usage
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens
                else:
                    # calculate num tokens
                    prompt_tokens = self._num_tokens_from_string(credentials, prompt_messages[0].content)
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
                        usage=usage
                    )
                )
            else:
                yield LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                    )
                )

    def _chat_generate(self, model: str, credentials: dict,
                       prompt_messages: list[PromptMessage], model_parameters: dict,
                       tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                       stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:

        client = AzureOpenAI(**self._to_credential_kwargs(credentials))

        response_format = model_parameters.get("response_format")
        if response_format:
            if response_format == "json_object":
                response_format = {"type": "json_object"}
            else:
                response_format = {"type": "text"}

            model_parameters["response_format"] = response_format

        extra_model_kwargs = {}

        if tools:
            # extra_model_kwargs['tools'] = [helper.dump_model(PromptMessageFunction(function=tool)) for tool in tools]
            extra_model_kwargs['functions'] = [{
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters
            } for tool in tools]

        if stop:
            extra_model_kwargs['stop'] = stop

        if user:
            extra_model_kwargs['user'] = user

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

    def _handle_chat_generate_response(self, model: str, credentials: dict, response: ChatCompletion,
                                       prompt_messages: list[PromptMessage],
                                       tools: Optional[list[PromptMessageTool]] = None) -> LLMResult:

        assistant_message = response.choices[0].message
        # assistant_message_tool_calls = assistant_message.tool_calls
        assistant_message_function_call = assistant_message.function_call

        # extract tool calls from response
        # tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
        function_call = self._extract_response_function_call(assistant_message_function_call)
        tool_calls = [function_call] if function_call else []

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_message.content,
            tool_calls=tool_calls
        )

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
        response = LLMResult(
            model=response.model or model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
            system_fingerprint=response.system_fingerprint,
        )

        return response

    def _handle_chat_generate_stream_response(self, model: str, credentials: dict,
                                              response: Stream[ChatCompletionChunk],
                                              prompt_messages: list[PromptMessage],
                                              tools: Optional[list[PromptMessageTool]] = None) -> Generator:
        index = 0
        full_assistant_content = ''
        delta_assistant_message_function_call_storage: ChoiceDeltaFunctionCall = None
        real_model = model
        system_fingerprint = None
        completion = ''
        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            # Handling exceptions when content filters' streaming mode is set to asynchronous modified filter
            if delta.delta is None or (
                delta.finish_reason is None
                and (delta.delta.content is None or delta.delta.content == '')
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
                        delta_assistant_message_function_call_storage.arguments = ''
                    continue

            # extract tool calls from response
            # tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
            function_call = self._extract_response_function_call(assistant_message_function_call)
            tool_calls = [function_call] if function_call else []

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content=delta.delta.content if delta.delta.content else '',
                tool_calls=tool_calls
            )

            full_assistant_content += delta.delta.content if delta.delta.content else ''

            real_model = chunk.model
            system_fingerprint = chunk.system_fingerprint
            completion += delta.delta.content if delta.delta.content else ''

            yield LLMResultChunk(
                model=real_model,
                prompt_messages=prompt_messages,
                system_fingerprint=system_fingerprint,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=assistant_prompt_message,
                )
            )

            index += 0

        # calculate num tokens
        prompt_tokens = self._num_tokens_from_messages(credentials, prompt_messages, tools)

        full_assistant_prompt_message = AssistantPromptMessage(
            content=completion
        )
        completion_tokens = self._num_tokens_from_messages(credentials, [full_assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        yield LLMResultChunk(
            model=real_model,
            prompt_messages=prompt_messages,
            system_fingerprint=system_fingerprint,
            delta=LLMResultChunkDelta(
                index=index,
                message=AssistantPromptMessage(content=''),
                finish_reason='stop',
                usage=usage
            )
        )

    @staticmethod
    def _extract_response_tool_calls(response_tool_calls: list[ChatCompletionMessageToolCall | ChoiceDeltaToolCall]) \
            -> list[AssistantPromptMessage.ToolCall]:

        tool_calls = []
        if response_tool_calls:
            for response_tool_call in response_tool_calls:
                function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=response_tool_call.function.name,
                    arguments=response_tool_call.function.arguments
                )

                tool_call = AssistantPromptMessage.ToolCall(
                    id=response_tool_call.id,
                    type=response_tool_call.type,
                    function=function
                )
                tool_calls.append(tool_call)

        return tool_calls

    @staticmethod
    def _extract_response_function_call(response_function_call: FunctionCall | ChoiceDeltaFunctionCall) \
            -> AssistantPromptMessage.ToolCall:

        tool_call = None
        if response_function_call:
            function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                name=response_function_call.name,
                arguments=response_function_call.arguments
            )

            tool_call = AssistantPromptMessage.ToolCall(
                id=response_function_call.name,
                type="function",
                function=function
            )

        return tool_call

    @staticmethod
    def _convert_prompt_message_to_dict(message: PromptMessage) -> dict:

        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                sub_messages = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        sub_message_dict = {
                            "type": "text",
                            "text": message_content.data
                        }
                        sub_messages.append(sub_message_dict)
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(ImagePromptMessageContent, message_content)
                        sub_message_dict = {
                            "type": "image_url",
                            "image_url": {
                                "url": message_content.data,
                                "detail": message_content.detail.value
                            }
                        }
                        sub_messages.append(sub_message_dict)

                message_dict = {"role": "user", "content": sub_messages}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
            if message.tool_calls:
                # message_dict["tool_calls"] = [helper.dump_model(tool_call) for tool_call in
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
            message_dict = {
                "role": "function",
                "content": message.content,
                "name": message.tool_call_id
            }
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name:
            message_dict["name"] = message.name

        return message_dict

    def _num_tokens_from_string(self, credentials: dict, text: str,
                                tools: Optional[list[PromptMessageTool]] = None) -> int:
        try:
            encoding = tiktoken.encoding_for_model(credentials['base_model_name'])
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")

        num_tokens = len(encoding.encode(text))

        if tools:
            num_tokens += self._num_tokens_for_tools(encoding, tools)

        return num_tokens

    def _num_tokens_from_messages(self, credentials: dict, messages: list[PromptMessage],
                                  tools: Optional[list[PromptMessageTool]] = None) -> int:
        """Calculate num tokens for gpt-3.5-turbo and gpt-4 with tiktoken package.

        Official documentation: https://github.com/openai/openai-cookbook/blob/
        main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb"""
        model = credentials['base_model_name']
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
        elif model.startswith("gpt-35-turbo") or model.startswith("gpt-4"):
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
                    text = ''
                    for item in value:
                        if isinstance(item, dict) and item['type'] == 'text':
                            text += item['text']

                    value = text

                if key == "tool_calls":
                    for tool_call in value:
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
            num_tokens += len(encoding.encode('type'))
            num_tokens += len(encoding.encode('function'))

            # calculate num tokens for function object
            num_tokens += len(encoding.encode('name'))
            num_tokens += len(encoding.encode(tool.name))
            num_tokens += len(encoding.encode('description'))
            num_tokens += len(encoding.encode(tool.description))
            parameters = tool.parameters
            num_tokens += len(encoding.encode('parameters'))
            if 'title' in parameters:
                num_tokens += len(encoding.encode('title'))
                num_tokens += len(encoding.encode(parameters.get("title")))
            num_tokens += len(encoding.encode('type'))
            num_tokens += len(encoding.encode(parameters.get("type")))
            if 'properties' in parameters:
                num_tokens += len(encoding.encode('properties'))
                for key, value in parameters.get('properties').items():
                    num_tokens += len(encoding.encode(key))
                    for field_key, field_value in value.items():
                        num_tokens += len(encoding.encode(field_key))
                        if field_key == 'enum':
                            for enum_field in field_value:
                                num_tokens += 3
                                num_tokens += len(encoding.encode(enum_field))
                        else:
                            num_tokens += len(encoding.encode(field_key))
                            num_tokens += len(encoding.encode(str(field_value)))
            if 'required' in parameters:
                num_tokens += len(encoding.encode('required'))
                for required_field in parameters['required']:
                    num_tokens += 3
                    num_tokens += len(encoding.encode(required_field))

        return num_tokens

    @staticmethod
    def _get_ai_model_entity(base_model_name: str, model: str) -> AzureBaseModel:
        for ai_model_entity in LLM_BASE_MODELS:
            if ai_model_entity.base_model_name == base_model_name:
                ai_model_entity_copy = copy.deepcopy(ai_model_entity)
                ai_model_entity_copy.entity.model = model
                ai_model_entity_copy.entity.label.en_US = model
                ai_model_entity_copy.entity.label.zh_Hans = model
                return ai_model_entity_copy

        return None
