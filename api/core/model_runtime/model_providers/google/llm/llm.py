import json
import logging
from collections.abc import Generator
from typing import Optional, Union

import google.ai.generativelanguage as glm
import google.api_core.exceptions as exceptions
import google.generativeai as genai
import google.generativeai.client as client
from google.generativeai.types import ContentType, GenerateContentResponse, HarmBlockThreshold, HarmCategory
from google.generativeai.types.content_types import to_part

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
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

GEMINI_BLOCK_MODE_PROMPT = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>
"""


class GoogleLargeLanguageModel(LargeLanguageModel):

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
        return self._generate(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)
    
    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:md = genai.GenerativeModel(model)
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

        google_model = genai.GenerativeModel(
            model_name=model
        )

        history = []

        # hack for gemini-pro-vision, which currently does not support multi-turn chat
        if model == "gemini-pro-vision":
            last_msg = prompt_messages[-1]
            content = self._format_message_to_glm_content(last_msg)
            history.append(content)
        else:
            for msg in prompt_messages:     # makes message roles strictly alternating
                content = self._format_message_to_glm_content(msg)
                if history and history[-1]["role"] == content["role"]:
                    history[-1]["parts"].extend(content["parts"])
                else:
                    history.append(content)

        # Create a new ClientManager with tenant's API key
        new_client_manager = client._ClientManager()
        new_client_manager.configure(api_key=credentials["google_api_key"])
        new_custom_client = new_client_manager.make_client("generative")

        google_model._client = new_custom_client

        safety_settings={
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        response = google_model.generate_content(
            contents=history,
            generation_config=genai.types.GenerationConfig(
                **config_kwargs
            ),
            stream=stream,
            safety_settings=safety_settings,
            tools=self._convert_tools_to_glm_tool(tools) if tools else None,
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, response: GenerateContentResponse,
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
            content=response.text
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

    def _handle_generate_stream_response(self, model: str, credentials: dict, response: GenerateContentResponse,
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
            for part in chunk.parts:
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
                                arguments=json.dumps({
                                    key: value 
                                    for key, value in part.function_call.args.items()
                                })
                            )
                        )
                    ]

                index += 1
    
                if not response._done:
                    
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

    def _format_message_to_glm_content(self, message: PromptMessage) -> ContentType:
        """
        Format a single message into glm.Content for Google API

        :param message: one PromptMessage
        :return: glm Content representation of message
        """
        if isinstance(message, UserPromptMessage):
            glm_content = {
                "role": "user",
                "parts": []
            }
            if (isinstance(message.content, str)):
                glm_content['parts'].append(to_part(message.content))
            else:
                for c in message.content:
                    if c.type == PromptMessageContentType.TEXT:
                        glm_content['parts'].append(to_part(c.data))
                    else:
                        metadata, data = c.data.split(',', 1)
                        mime_type = metadata.split(';', 1)[0].split(':')[1]
                        blob = {"inline_data":{"mime_type":mime_type,"data":data}}
                        glm_content['parts'].append(blob)
            return glm_content
        elif isinstance(message, AssistantPromptMessage):
            glm_content = {
                "role": "model",
                "parts": []
            }
            if message.content:
                glm_content['parts'].append(to_part(message.content))
            if message.tool_calls:
                glm_content["parts"].append(to_part(glm.FunctionCall(
                    name=message.tool_calls[0].function.name,
                    args=json.loads(message.tool_calls[0].function.arguments),
                )))
            return glm_content
        elif isinstance(message, SystemPromptMessage):
            return {
                "role": "user",
                "parts": [to_part(message.content)]
            }
        elif isinstance(message, ToolPromptMessage):
            return {
                "role": "function",
                "parts": [glm.Part(function_response=glm.FunctionResponse(
                    name=message.name,
                    response={
                        "response": message.content
                    }
                ))]
            }
        else:
            raise ValueError(f"Got unknown type {message}")
    
    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the ermd = genai.GenerativeModel(model)ror type thrown to the caller
        The value is the md = genai.GenerativeModel(model)error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke emd = genai.GenerativeModel(model)rror mapping
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