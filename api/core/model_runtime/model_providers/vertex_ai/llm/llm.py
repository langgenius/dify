import base64
import io
import json
import logging
from collections.abc import Generator
from typing import Optional, Union, cast

import google.api_core.exceptions as exceptions
import google.auth.transport.requests
import vertexai.generative_models as glm
from anthropic import AnthropicVertex, Stream
from anthropic.types import (
    ContentBlockDeltaEvent,
    Message,
    MessageDeltaEvent,
    MessageStartEvent,
    MessageStopEvent,
    MessageStreamEvent,
)
from google.cloud import aiplatform
from google.oauth2 import service_account
from PIL import Image
from vertexai.generative_models import HarmBlockThreshold, HarmCategory

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
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

logger = logging.getLogger(__name__)


class VertexAiLargeLanguageModel(LargeLanguageModel):

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
        # invoke anthropic models via anthropic official SDK
        if "claude" in model:
            return self._generate_anthropic(model, credentials, prompt_messages, model_parameters, stop, stream, user)
        # invoke Gemini model
        return self._generate(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def _generate_anthropic(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                stop: Optional[list[str]] = None, stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke Anthropic large language model

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :return: full response or stream response chunk generator result
        """
        # use Anthropic official SDK references
        # - https://github.com/anthropics/anthropic-sdk-python
        service_account_info = json.loads(base64.b64decode(credentials["vertex_service_account_key"]))
        project_id = credentials["vertex_project_id"]
        SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
        token = ''

        # get access token from service account credential
        if service_account_info:
            credentials = service_account.Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
            request = google.auth.transport.requests.Request()
            credentials.refresh(request)
            token = credentials.token

        # Vertex AI Anthropic Claude3 Opus model available in us-east5 region, Sonnet and Haiku available in us-central1 region
        if 'opus' or 'claude-3-5-sonnet' in model:
            location = 'us-east5'
        else:
            location = 'us-central1'
        
        # use access token to authenticate
        if token:
            client = AnthropicVertex(
                region=location, 
                project_id=project_id,
                access_token=token
            )
        # When access token is empty, try to use the Google Cloud VM's built-in service account or the GOOGLE_APPLICATION_CREDENTIALS environment variable
        else:
            client = AnthropicVertex(
                region=location, 
                project_id=project_id,
            )

        extra_model_kwargs = {}
        if stop:
            extra_model_kwargs['stop_sequences'] = stop

        system, prompt_message_dicts = self._convert_claude_prompt_messages(prompt_messages)

        if system:
            extra_model_kwargs['system'] = system

        response = client.messages.create(
            model=model,
            messages=prompt_message_dicts,
            stream=stream,
            **model_parameters,
            **extra_model_kwargs
        )

        if stream:
            return self._handle_claude_stream_response(model, credentials, response, prompt_messages)

        return self._handle_claude_response(model, credentials, response, prompt_messages)

    def _handle_claude_response(self, model: str, credentials: dict, response: Message,
                                prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: full response chunk generator result
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

    def _handle_claude_stream_response(self, model: str, credentials: dict, response: Stream[MessageStreamEvent],
                                        prompt_messages: list[PromptMessage], ) -> Generator:
        """
        Handle llm chat stream response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: full response or stream response chunk generator result
        """

        try:
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
                    assistant_prompt_message = AssistantPromptMessage(
                        content=chunk_text if chunk_text else '',
                    )
                    index = chunk.index
                    yield LLMResultChunk(
                        model=model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=index,
                            message=assistant_prompt_message,
                        )
                    )
        except Exception as ex:
            raise InvokeError(str(ex))

    def _calc_claude_response_usage(self, model: str, credentials: dict, prompt_tokens: int, completion_tokens: int) -> LLMUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param prompt_tokens: prompt tokens
        :param completion_tokens: completion tokens
        :return: usage
        """
        # get prompt price info
        prompt_price_info = self.get_price(
            model=model,
            credentials=credentials,
            price_type=PriceType.INPUT,
            tokens=prompt_tokens,
        )

        # get completion price info
        completion_price_info = self.get_price(
            model=model,
            credentials=credentials,
            price_type=PriceType.OUTPUT,
            tokens=completion_tokens
        )

        # transform usage
        usage = LLMUsage(
            prompt_tokens=prompt_tokens,
            prompt_unit_price=prompt_price_info.unit_price,
            prompt_price_unit=prompt_price_info.unit,
            prompt_price=prompt_price_info.total_amount,
            completion_tokens=completion_tokens,
            completion_unit_price=completion_price_info.unit_price,
            completion_price_unit=completion_price_info.unit,
            completion_price=completion_price_info.total_amount,
            total_tokens=prompt_tokens + completion_tokens,
            total_price=prompt_price_info.total_amount + completion_price_info.total_amount,
            currency=prompt_price_info.currency,
            latency=time.perf_counter() - self.started_at
        )

        return usage

    def _convert_claude_prompt_messages(self, prompt_messages: list[PromptMessage]) -> tuple[str, list[dict]]:
        """
        Convert prompt messages to dict list and system
        """

        system = ""
        first_loop = True
        for message in prompt_messages:
            if isinstance(message, SystemPromptMessage):
                message.content=message.content.strip()
                if first_loop:
                    system=message.content
                    first_loop=False
                else:
                    system+="\n"
                    system+=message.content

        prompt_message_dicts = []
        for message in prompt_messages:
            if not isinstance(message, SystemPromptMessage):
                prompt_message_dicts.append(self._convert_claude_prompt_message_to_dict(message))

        return system, prompt_message_dicts

    def _convert_claude_prompt_message_to_dict(self, message: PromptMessage) -> dict:
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
                                with Image.open(io.BytesIO(image_content)) as img:
                                    mime_type = f"image/{img.format.lower()}"
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

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:md = gml.GenerativeModel(model)
        """
        prompt = self._convert_messages_to_prompt(prompt_messages)

        return self._get_num_tokens_by_gpt2(prompt)
    
    def _convert_messages_to_prompt(self, messages: list[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Google model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(
            self._convert_one_message_to_text(message)
            for message in messages
        )

        return text.rstrip()
    
    def _convert_tools_to_glm_tool(self, tools: list[PromptMessageTool]) -> glm.Tool:
        """
        Convert tool messages to glm tools

        :param tools: tool messages
        :return: glm tools
        """
        return glm.Tool(
            function_declarations=[
                glm.FunctionDeclaration(
                    name=tool.name,
                    parameters=glm.Schema(
                        type=glm.Type.OBJECT,
                        properties={
                            key: {
                                'type_': value.get('type', 'string').upper(),
                                'description': value.get('description', ''),
                                'enum': value.get('enum', [])
                            } for key, value in tool.parameters.get('properties', {}).items()
                        },
                        required=tool.parameters.get('required', [])
                    ),
                ) for tool in tools
            ]
        )

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        
        try:
            ping_message = SystemPromptMessage(content="ping")
            self._generate(model, credentials, [ping_message], {"max_tokens_to_sample": 5})
            
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))
            

    def _generate(self, model: str, credentials: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict,
                  tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None, 
                  stream: bool = True, user: Optional[str] = None
        ) -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param model: model name
        :param credentials: credentials kwargs
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        config_kwargs = model_parameters.copy()
        config_kwargs['max_output_tokens'] = config_kwargs.pop('max_tokens_to_sample', None)

        if stop:
            config_kwargs["stop_sequences"] = stop

        service_account_info = json.loads(base64.b64decode(credentials["vertex_service_account_key"]))
        project_id = credentials["vertex_project_id"]
        location = credentials["vertex_location"]
        if service_account_info:
            service_accountSA = service_account.Credentials.from_service_account_info(service_account_info)
            aiplatform.init(credentials=service_accountSA, project=project_id, location=location)
        else:
            aiplatform.init(project=project_id, location=location)

        history = []
        system_instruction = ""
        # hack for gemini-pro-vision, which currently does not support multi-turn chat
        if model == "gemini-1.0-pro-vision-001":
            last_msg = prompt_messages[-1]
            content = self._format_message_to_glm_content(last_msg)
            history.append(content)
        else:
            for msg in prompt_messages:
                if isinstance(msg, SystemPromptMessage):
                    system_instruction = msg.content
                else:
                    content = self._format_message_to_glm_content(msg)
                    if history and history[-1].role == content.role:
                        history[-1].parts.extend(content.parts)
                    else:
                        history.append(content)

        safety_settings={
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        google_model = glm.GenerativeModel(
            model_name=model,
            system_instruction=system_instruction
        )

        response = google_model.generate_content(
            contents=history,
            generation_config=glm.GenerationConfig(
                **config_kwargs
            ),
            stream=stream,
            safety_settings=safety_settings,
            tools=self._convert_tools_to_glm_tool(tools) if tools else None
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, response: glm.GenerationResponse,
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=response.candidates[0].content.parts[0].text
        )

        # calculate num tokens
        prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
        completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(self, model: str, credentials: dict, response: glm.GenerationResponse,
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        index = -1
        for chunk in response:
            for part in chunk.candidates[0].content.parts:
                assistant_prompt_message = AssistantPromptMessage(
                    content=''
                )

                if part.text:
                    assistant_prompt_message.content += part.text

                if part.function_call:
                    assistant_prompt_message.tool_calls = [
                        AssistantPromptMessage.ToolCall(
                            id=part.function_call.name,
                            type='function',
                            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                name=part.function_call.name,
                                arguments=json.dumps(dict(part.function_call.args.items()))
                            )
                        )
                    ]

                index += 1
    
                if not hasattr(chunk, 'finish_reason') or not chunk.finish_reason:                    
                    # transform assistant message to prompt message
                    yield LLMResultChunk(
                        model=model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=index,
                            message=assistant_prompt_message
                        )
                    )
                else:
                    
                    # calculate num tokens
                    prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
                    completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

                    # transform usage
                    usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)
                    
                    yield LLMResultChunk(
                        model=model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=index,
                            message=assistant_prompt_message,
                            finish_reason=chunk.candidates[0].finish_reason,
                            usage=usage
                        )
                    )

    def _convert_one_message_to_text(self, message: PromptMessage) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
        human_prompt = "\n\nuser:"
        ai_prompt = "\n\nmodel:"

        content = message.content
        if isinstance(content, list):
            content = "".join(
                c.data for c in content if c.type != PromptMessageContentType.IMAGE
            )

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, ToolPromptMessage):
            message_text = f"{human_prompt} {content}"
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text

    def _format_message_to_glm_content(self, message: PromptMessage) -> glm.Content:
        """
        Format a single message into glm.Content for Google API

        :param message: one PromptMessage
        :return: glm Content representation of message
        """
        if isinstance(message, UserPromptMessage):
            glm_content = glm.Content(role="user", parts=[])

            if (isinstance(message.content, str)):
                glm_content = glm.Content(role="user", parts=[glm.Part.from_text(message.content)])
            else:
                parts = []
                for c in message.content:
                    if c.type == PromptMessageContentType.TEXT:
                        parts.append(glm.Part.from_text(c.data))
                    else:
                        metadata, data = c.data.split(',', 1)
                        mime_type = metadata.split(';', 1)[0].split(':')[1]
                        parts.append(glm.Part.from_data(mime_type=mime_type, data=data))
                glm_content = glm.Content(role="user", parts=parts)
            return glm_content
        elif isinstance(message, AssistantPromptMessage):
            if message.content:
                glm_content = glm.Content(role="model", parts=[glm.Part.from_text(message.content)])
            if message.tool_calls:
                glm_content = glm.Content(role="model", parts=[glm.Part.from_function_response(glm.FunctionCall(
                    name=message.tool_calls[0].function.name,
                    args=json.loads(message.tool_calls[0].function.arguments),
                ))])
            return glm_content
        elif isinstance(message, ToolPromptMessage):
            glm_content = glm.Content(role="function", parts=[glm.Part(function_response=glm.FunctionResponse(
                    name=message.name,
                    response={
                        "response": message.content
                    }
                ))])
            return glm_content
        else:
            raise ValueError(f"Got unknown type {message}")
    
    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the ermd = gml.GenerativeModel(model)ror type thrown to the caller
        The value is the md = gml.GenerativeModel(model)error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke emd = gml.GenerativeModel(model)rror mapping
        """
        return {
            InvokeConnectionError: [
                exceptions.RetryError
            ],
            InvokeServerUnavailableError: [
                exceptions.ServiceUnavailable,
                exceptions.InternalServerError,
                exceptions.BadGateway,
                exceptions.GatewayTimeout,
                exceptions.DeadlineExceeded
            ],
            InvokeRateLimitError: [
                exceptions.ResourceExhausted,
                exceptions.TooManyRequests
            ],
            InvokeAuthorizationError: [
                exceptions.Unauthenticated,
                exceptions.PermissionDenied,
                exceptions.Unauthenticated,
                exceptions.Forbidden
            ],
            InvokeBadRequestError: [
                exceptions.BadRequest,
                exceptions.InvalidArgument,
                exceptions.FailedPrecondition,
                exceptions.OutOfRange,
                exceptions.NotFound,
                exceptions.MethodNotAllowed,
                exceptions.Conflict,
                exceptions.AlreadyExists,
                exceptions.Aborted,
                exceptions.LengthRequired,
                exceptions.PreconditionFailed,
                exceptions.RequestRangeNotSatisfiable,
                exceptions.Cancelled,
            ]
        }
