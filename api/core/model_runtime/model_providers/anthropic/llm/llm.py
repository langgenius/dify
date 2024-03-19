import base64
import mimetypes
from collections.abc import Generator
from typing import Optional, Union, cast

import anthropic
import requests
from anthropic import Anthropic, Stream
from anthropic.types import (
    ContentBlockDeltaEvent,
    Message,
    MessageDeltaEvent,
    MessageStartEvent,
    MessageStopEvent,
    MessageStreamEvent,
    completion_create_params,
)
from httpx import Timeout

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
    UserPromptMessage,
)
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

ANTHROPIC_BLOCK_MODE_PROMPT = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>
"""


class AnthropicLargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:
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
        # invoke model
        return self._chat_generate(model, credentials, prompt_messages, model_parameters, stop, stream, user)

    def _chat_generate(self, model: str, credentials: dict,
                       prompt_messages: list[PromptMessage], model_parameters: dict, stop: Optional[list[str]] = None,
                       stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke llm chat model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # transform model parameters from completion api of anthropic to chat api
        if 'max_tokens_to_sample' in model_parameters:
            model_parameters['max_tokens'] = model_parameters.pop('max_tokens_to_sample')

        # init model client
        client = Anthropic(**credentials_kwargs)

        extra_model_kwargs = {}
        if stop:
            extra_model_kwargs['stop_sequences'] = stop

        if user:
            extra_model_kwargs['metadata'] = completion_create_params.Metadata(user_id=user)

        system, prompt_message_dicts = self._convert_prompt_messages(prompt_messages)

        if system:
            extra_model_kwargs['system'] = system

        # chat model
        response = client.messages.create(
            model=model,
            messages=prompt_message_dicts,
            stream=stream,
            **model_parameters,
            **extra_model_kwargs
        )

        if stream:
            return self._handle_chat_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_chat_generate_response(model, credentials, response, prompt_messages)

    def _code_block_mode_wrapper(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                 model_parameters: dict, tools: Optional[list[PromptMessageTool]] = None,
                                 stop: Optional[list[str]] = None, stream: bool = True, user: Optional[str] = None,
                                 callbacks: list[Callback] = None) -> Union[LLMResult, Generator]:
        """
        Code block mode wrapper for invoking large language model
        """
        if 'response_format' in model_parameters and model_parameters['response_format']:
            stop = stop or []
            # chat model
            self._transform_chat_json_prompts(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
                response_format=model_parameters['response_format']
            )
            model_parameters.pop('response_format')

        return self._invoke(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def _transform_chat_json_prompts(self, model: str, credentials: dict,
                                     prompt_messages: list[PromptMessage], model_parameters: dict,
                                     tools: list[PromptMessageTool] | None = None, stop: list[str] | None = None,
                                     stream: bool = True, user: str | None = None, response_format: str = 'JSON') \
            -> None:
        """
        Transform json prompts
        """
        if "```\n" not in stop:
            stop.append("```\n")
        if "\n```" not in stop:
            stop.append("\n```")

        # check if there is a system message
        if len(prompt_messages) > 0 and isinstance(prompt_messages[0], SystemPromptMessage):
            # override the system message
            prompt_messages[0] = SystemPromptMessage(
                content=ANTHROPIC_BLOCK_MODE_PROMPT
                .replace("{{instructions}}", prompt_messages[0].content)
                .replace("{{block}}", response_format)
            )
            prompt_messages.append(AssistantPromptMessage(content=f"\n```{response_format}"))
        else:
            # insert the system message
            prompt_messages.insert(0, SystemPromptMessage(
                content=ANTHROPIC_BLOCK_MODE_PROMPT
                .replace("{{instructions}}", f"Please output a valid {response_format} object.")
                .replace("{{block}}", response_format)
            ))
            prompt_messages.append(AssistantPromptMessage(content=f"\n```{response_format}"))

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        prompt = self._convert_messages_to_prompt_anthropic(prompt_messages)

        client = Anthropic(api_key="")
        return client.count_tokens(prompt)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._chat_generate(
                model=model,
                credentials=credentials,
                prompt_messages=[
                    UserPromptMessage(content="ping"),
                ],
                model_parameters={
                    "temperature": 0,
                    "max_tokens": 20,
                },
                stream=False
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _handle_chat_generate_response(self, model: str, credentials: dict, response: Message,
                                       prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=response.content[0].text
        )

        # calculate num tokens
        if response.usage:
            # transform usage
            prompt_tokens = response.usage.input_tokens
            completion_tokens = response.usage.output_tokens
        else:
            # calculate num tokens
            prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
            completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        response = LLMResult(
            model=response.model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage
        )

        return response

    def _handle_chat_generate_stream_response(self, model: str, credentials: dict,
                                              response: Stream[MessageStreamEvent],
                                              prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm chat stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """
        full_assistant_content = ''
        return_model = None
        input_tokens = 0
        output_tokens = 0
        finish_reason = None
        index = 0
        for chunk in response:
            if isinstance(chunk, MessageStartEvent):
                return_model = chunk.message.model
                input_tokens = chunk.message.usage.input_tokens
            elif isinstance(chunk, MessageDeltaEvent):
                output_tokens = chunk.usage.output_tokens
                finish_reason = chunk.delta.stop_reason
            elif isinstance(chunk, MessageStopEvent):
                # transform usage
                usage = self._calc_response_usage(model, credentials, input_tokens, output_tokens)

                yield LLMResultChunk(
                    model=return_model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index + 1,
                        message=AssistantPromptMessage(
                            content=''
                        ),
                        finish_reason=finish_reason,
                        usage=usage
                    )
                )
            elif isinstance(chunk, ContentBlockDeltaEvent):
                chunk_text = chunk.delta.text if chunk.delta.text else ''
                full_assistant_content += chunk_text

                # transform assistant message to prompt message
                assistant_prompt_message = AssistantPromptMessage(
                    content=chunk_text
                )

                index = chunk.index

                yield LLMResultChunk(
                    model=return_model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk.index,
                        message=assistant_prompt_message,
                    )
                )

    def _to_credential_kwargs(self, credentials: dict) -> dict:
        """
        Transform credentials to kwargs for model instance

        :param credentials:
        :return:
        """
        credentials_kwargs = {
            "api_key": credentials['anthropic_api_key'],
            "timeout": Timeout(315.0, read=300.0, write=10.0, connect=5.0),
            "max_retries": 1,
        }

        if 'anthropic_api_url' in credentials and credentials['anthropic_api_url']:
            credentials['anthropic_api_url'] = credentials['anthropic_api_url'].rstrip('/')
            credentials_kwargs['base_url'] = credentials['anthropic_api_url']

        return credentials_kwargs

    def _convert_prompt_messages(self, prompt_messages: list[PromptMessage]) -> tuple[str, list[dict]]:
        """
        Convert prompt messages to dict list and system
        """
        system = ""
        prompt_message_dicts = []

        for message in prompt_messages:
            if isinstance(message, SystemPromptMessage):
                system += message.content + ("\n" if not system else "")
            else:
                prompt_message_dicts.append(self._convert_prompt_message_to_dict(message))

        return system, prompt_message_dicts

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict
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
                        sub_message_dict = {
                            "type": "text",
                            "text": message_content.data
                        }
                        sub_messages.append(sub_message_dict)
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(ImagePromptMessageContent, message_content)
                        if not message_content.data.startswith("data:"):
                            # fetch image data from url
                            try:
                                image_content = requests.get(message_content.data).content
                                mime_type, _ = mimetypes.guess_type(message_content.data)
                                base64_data = base64.b64encode(image_content).decode('utf-8')
                            except Exception as ex:
                                raise ValueError(f"Failed to fetch image data from url {message_content.data}, {ex}")
                        else:
                            data_split = message_content.data.split(";base64,")
                            mime_type = data_split[0].replace("data:", "")
                            base64_data = data_split[1]

                        if mime_type not in ["image/jpeg", "image/png", "image/gif", "image/webp"]:
                            raise ValueError(f"Unsupported image type {mime_type}, "
                                             f"only support image/jpeg, image/png, image/gif, and image/webp")

                        sub_message_dict = {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": base64_data
                            }
                        }
                        sub_messages.append(sub_message_dict)

                message_dict = {"role": "user", "content": sub_messages}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_dict

    def _convert_one_message_to_text(self, message: PromptMessage) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
        human_prompt = "\n\nHuman:"
        ai_prompt = "\n\nAssistant:"
        content = message.content

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt} {content}"
            if not isinstance(message.content, list):
                message_text = f"{ai_prompt} {content}"
            else:
                message_text = ""
                for sub_message in message.content:
                    if sub_message.type == PromptMessageContentType.TEXT:
                        message_text += f"{human_prompt} {sub_message.data}"
                    elif sub_message.type == PromptMessageContentType.IMAGE:
                        message_text += f"{human_prompt} [IMAGE]"
        elif isinstance(message, AssistantPromptMessage):
            if not isinstance(message.content, list):
                message_text = f"{ai_prompt} {content}"
            else:
                message_text = ""
                for sub_message in message.content:
                    if sub_message.type == PromptMessageContentType.TEXT:
                        message_text += f"{ai_prompt} {sub_message.data}"
                    elif sub_message.type == PromptMessageContentType.IMAGE:
                        message_text += f"{ai_prompt} [IMAGE]"
        elif isinstance(message, SystemPromptMessage):
            message_text = content
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text

    def _convert_messages_to_prompt_anthropic(self, messages: list[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Anthropic model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        if not messages:
            return ''

        messages = messages.copy()  # don't mutate the original list
        if not isinstance(messages[-1], AssistantPromptMessage):
            messages.append(AssistantPromptMessage(content=""))

        text = "".join(
            self._convert_one_message_to_text(message)
            for message in messages
        )

        # trim off the trailing ' ' that might come from the "Assistant: "
        return text.rstrip()

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [
                anthropic.APIConnectionError,
                anthropic.APITimeoutError
            ],
            InvokeServerUnavailableError: [
                anthropic.InternalServerError
            ],
            InvokeRateLimitError: [
                anthropic.RateLimitError
            ],
            InvokeAuthorizationError: [
                anthropic.AuthenticationError,
                anthropic.PermissionDeniedError
            ],
            InvokeBadRequestError: [
                anthropic.BadRequestError,
                anthropic.NotFoundError,
                anthropic.UnprocessableEntityError,
                anthropic.APIError
            ]
        }
