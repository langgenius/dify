from typing import Generator, List, Optional
from requests import post


from os.path import join
from typing import cast
from json import dumps

from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool, UserPromptMessage, AssistantPromptMessage, \
    SystemPromptMessage
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, \
    LLMResultChunkDelta
from core.model_runtime.errors.invoke import InvokeConnectionError, InvokeServerUnavailableError, InvokeRateLimitError, \
    InvokeAuthorizationError, InvokeBadRequestError, InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.entities.message_entities import PromptMessageTool, PromptMessage, AssistantPromptMessage, \
    PromptMessageFunction, UserPromptMessage, SystemPromptMessage
from core.model_runtime.utils import helper
from openai import OpenAI, Stream, \
    APIConnectionError, APITimeoutError, AuthenticationError, InternalServerError, \
    RateLimitError, ConflictError, NotFoundError, UnprocessableEntityError, PermissionDeniedError
from openai.types.chat import ChatCompletionChunk, ChatCompletion
from openai.types.chat.chat_completion_message import FunctionCall
from httpx import Timeout

import logging

logger = logging.getLogger(__name__)

class ChatGLMLargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, 
                prompt_messages: list[PromptMessage], model_parameters: dict, 
                tools: list[PromptMessageTool] | None = None, stop: List[str] | None = None, 
                stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
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
        return self._generate(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user
        )

    def get_num_tokens(self, model: str, prompt_messages: list[PromptMessage], tools: list[PromptMessageTool] | None = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model:
        :param prompt_messages:
        :param tools: tools for tool calling
        :return:
        """
        return self._num_tokens_from_messages(messages=prompt_messages, tools=tools)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            response = post(join(credentials['api_base'], "v1/chat/completions"), data=dumps({
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": "ping"
                    }
                ],
            }),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
            })
            if response.status_code != 200:
                raise CredentialsValidateFailedError("Invalid credentials")
        except Exception as e:
            raise CredentialsValidateFailedError(str(e))

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
                APIConnectionError,
                APITimeoutError,
            ],
            InvokeServerUnavailableError: [
                InternalServerError,
                ConflictError,
                NotFoundError,
                UnprocessableEntityError,
                PermissionDeniedError
            ],
            InvokeRateLimitError: [
                RateLimitError
            ],
            InvokeAuthorizationError: [
                AuthenticationError
            ],
            InvokeBadRequestError: [
                ValueError
            ]
        }

    def _generate(self, model: str, credentials: dict, 
                prompt_messages: list[PromptMessage], model_parameters: dict, 
                tools: list[PromptMessageTool] | None = None, stop: List[str] | None = None, 
                stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
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

        self._check_chatglm_parameters(model=model, model_parameters=model_parameters, tools=tools)

        kwargs = self._to_client_kwargs(credentials)
        # init model client
        client = OpenAI(**kwargs)

        extra_model_kwargs = {}
        if stop:
            extra_model_kwargs['stop'] = stop

        if user:
            extra_model_kwargs['user'] = user

        if tools and len(tools) > 0:
            extra_model_kwargs['functions'] = [
                helper.dump_model(tool) for tool in tools
            ]

        result = client.chat.completions.create(
            messages=[self._convert_prompt_message_to_dict(m) for m in prompt_messages],
            model=model,
            stream=stream,
            **model_parameters,
            **extra_model_kwargs
        )

        if stream:
            return self._handle_chat_generate_stream_response(
                model=model, credentials=credentials, response=result, tools=tools, 
                prompt_messages=prompt_messages
            )
        
        return self._handle_chat_generate_response(
            model=model, credentials=credentials, response=result, tools=tools, 
            prompt_messages=prompt_messages
        )
        
    def _check_chatglm_parameters(self, model: str, model_parameters: dict, tools: list[PromptMessageTool]) -> None:
        if model.find("chatglm2") != -1 and tools is not None and len(tools) > 0:
            raise InvokeBadRequestError("ChatGLM2 does not support function calling")

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for OpenAI Compatibility API
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                raise ValueError("User message content must be str")
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
            if message.tool_calls:
                message_dict["tool_calls"] = [
                    PromptMessageFunction(
                        PromptMessageFunction(function=tool_call).model_dump() for tool_call in
                                              message.tool_calls)
                ]
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        else:
            raise ValueError(f"Unknown message type {type(message)}")
        
        return message_dict
    
    def _extract_response_tool_calls(self,
                                     response_function_calls: list[FunctionCall]) \
            -> list[AssistantPromptMessage.ToolCall]:
        """
        Extract tool calls from response

        :param response_tool_calls: response tool calls
        :return: list of tool calls
        """
        tool_calls = []
        if response_function_calls:
            for response_tool_call in response_function_calls:
                function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=response_tool_call.name,
                    arguments=response_tool_call.arguments
                )

                tool_call = AssistantPromptMessage.ToolCall(
                    id=0,
                    type='function',
                    function=function
                )
                tool_calls.append(tool_call)

        return tool_calls
        
    def _to_client_kwargs(self, credentials: dict) -> dict:
        """
        Convert invoke kwargs to client kwargs

        :param stream: is stream response
        :param model_name: model name
        :param credentials: credentials dict
        :param model_parameters: model parameters
        :return: client kwargs
        """
        client_kwargs = {
            "timeout": Timeout(315.0, read=300.0, write=10.0, connect=5.0),
            "api_key": "1",
            "base_url": join(credentials['api_base'], 'v1')
        }

        return client_kwargs
    
    def _handle_chat_generate_stream_response(self, model: str, credentials: dict, response: Stream[ChatCompletionChunk],
                                              prompt_messages: list[PromptMessage],
                                              tools: Optional[list[PromptMessageTool]] = None) \
            -> Generator:
        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.delta.content is None or delta.delta.content == ''):
                continue
            
            # check if there is a tool call in the response
            function_calls = delta.delta.tool_calls
            assistant_message_tool_calls = self._extract_response_tool_calls(function_calls if function_calls else [])

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content=delta.delta.content if delta.delta.content else '',
                tool_calls=assistant_message_tool_calls
            )

            if delta.finish_reason is not None:
                usage = self._calc_response_usage(model=model, credentials=credentials, prompt_tokens=0, completion_tokens=0)
                
                yield LLMResultChunk(
                    model=model,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
                        usage=usage
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=model,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                    )
                )
        
    def _handle_chat_generate_response(self, model: str, credentials: dict, response: ChatCompletion,
                                       prompt_messages: list[PromptMessage],
                                       tools: Optional[list[PromptMessageTool]] = None) \
            -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return: llm response
        """
        if len(response.choices) == 0:
            raise InvokeServerUnavailableError("Empty response")
        assistant_message = response.choices[0].message

        # convert function call to tool call
        function_calls = assistant_message.function_call
        tool_calls = self._extract_response_tool_calls([function_calls] if function_calls else [])

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_message.content,
            tool_calls=tool_calls
        )

        if response.usage:
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens
        else:
            prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
            completion_tokens = self._num_tokens_from_messages(messages=[assistant_prompt_message], tools=tools)

        usage = self._calc_response_usage(model=model, credentials=credentials, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

        response = LLMResult(
            model=model,
            system_fingerprint=response.system_fingerprint,
            usage=usage,
            message=assistant_prompt_message,
        )

        return response
    
    def _num_tokens_from_string(self, text: str, tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Calculate num tokens for text completion model with tiktoken package.

        :param model: model name
        :param text: prompt text
        :param tools: tools for tool calling
        :return: number of tokens
        """
        num_tokens = self._get_num_tokens_by_gpt2(text)

        if tools:
            num_tokens += self._num_tokens_for_tools(tools)

        return num_tokens

    def _num_tokens_from_messages(self, messages: List[PromptMessage],
                                  tools: Optional[list[PromptMessageTool]] = None) -> int:
        """Calculate num tokens for chatglm2 and chatglm3 with GPT2 tokenizer.

        it's too complex to calculate num tokens for chatglm2 and chatglm3 with ChatGLM tokenizer,
        As a temporary solution we use GPT2 tokenizer instead.

        """
        def tokens(text: str):
            return self._get_num_tokens_by_gpt2(text)
        
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
                    text = ''
                    for item in value:
                        if isinstance(item, dict) and item['type'] == 'text':
                            text += item['text']

                    value = text

                if key == "functions":
                    for tool_call in value:
                        for t_key, t_value in tool_call.items():
                            num_tokens += tokens(t_key)
                            if t_key == "function":
                                for f_key, f_value in t_value.items():
                                    num_tokens += tokens(f_key)
                                    num_tokens += tokens(f_value)
                            else:
                                num_tokens += tokens(t_key)
                                num_tokens += tokens(t_value)
                else:
                    num_tokens += tokens(str(value))

                if key == "name":
                    num_tokens += tokens_per_name

        # every reply is primed with <im_start>assistant
        num_tokens += 3

        if tools:
            num_tokens += self._num_tokens_for_tools(tools)

        return num_tokens

    def _num_tokens_for_tools(self, tools: list[PromptMessageTool]) -> int:
        """
        Calculate num tokens for tool calling

        :param encoding: encoding
        :param tools: tools for tool calling
        :return: number of tokens
        """
        def tokens(text: str):
            return self._get_num_tokens_by_gpt2(text)

        num_tokens = 0
        for tool in tools:
            num_tokens += tokens('function')

            # calculate num tokens for function object
            num_tokens += tokens('name')
            num_tokens += tokens(tool.name)
            num_tokens += tokens('description')
            num_tokens += tokens(tool.description)
            parameters = tool.parameters
            num_tokens += tokens('parameters')
            if 'title' in parameters:
                num_tokens += tokens('title')
                num_tokens += tokens(parameters.get("title"))
            num_tokens += tokens('type')
            num_tokens += tokens(parameters.get("type"))
            if 'properties' in parameters:
                num_tokens += tokens('properties')
                for key, value in parameters.get('properties').items():
                    num_tokens += tokens(key)
                    for field_key, field_value in value.items():
                        num_tokens += tokens(field_key)
                        if field_key == 'enum':
                            for enum_field in field_value:
                                num_tokens += 3
                                num_tokens += tokens(enum_field)
                        else:
                            num_tokens += tokens(field_key)
                            num_tokens += tokens(str(field_value))
            if 'required' in parameters:
                num_tokens += tokens('required')
                for required_field in parameters['required']:
                    num_tokens += 3
                    num_tokens += tokens(required_field)

        return num_tokens
