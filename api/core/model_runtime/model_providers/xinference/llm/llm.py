from collections.abc import Generator, Iterator
from typing import cast

from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    ConflictError,
    InternalServerError,
    NotFoundError,
    OpenAI,
    PermissionDeniedError,
    RateLimitError,
    UnprocessableEntityError,
)
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_chunk import ChoiceDeltaFunctionCall, ChoiceDeltaToolCall
from openai.types.chat.chat_completion_message import FunctionCall
from openai.types.completion import Completion
from xinference_client.client.restful.restful_client import (
    Client,
    RESTfulChatglmCppChatModelHandle,
    RESTfulChatModelHandle,
    RESTfulGenerateModelHandle,
)

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
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
from core.model_runtime.model_providers.xinference.xinference_helper import (
    XinferenceHelper,
    XinferenceModelExtraParameter,
)
from core.model_runtime.utils import helper


class XinferenceAILargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], 
                model_parameters: dict, tools: list[PromptMessageTool] | None = None, 
                stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
        -> LLMResult | Generator:
        """
            invoke LLM

            see `core.model_runtime.model_providers.__base.large_language_model.LargeLanguageModel._invoke`
        """
        if 'temperature' in model_parameters:
            if model_parameters['temperature'] < 0.01:
                model_parameters['temperature'] = 0.01
            elif model_parameters['temperature'] > 1.0:
                model_parameters['temperature'] = 0.99

        return self._generate(
            model=model, credentials=credentials, prompt_messages=prompt_messages, model_parameters=model_parameters,
            tools=tools, stop=stop, stream=stream, user=user,
            extra_model_kwargs=XinferenceHelper.get_xinference_extra_parameter(
                server_url=credentials['server_url'],
                model_uid=credentials['model_uid']
            )
        )

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
            validate credentials

            credentials should be like:
            {
                'model_type': 'text-generation',
                'server_url': 'server url',
                'model_uid': 'model uid',
            }
        """
        try:
            if "/" in credentials['model_uid'] or "?" in credentials['model_uid'] or "#" in credentials['model_uid']:
                raise CredentialsValidateFailedError("model_uid should not contain /, ?, or #")
            
            extra_param = XinferenceHelper.get_xinference_extra_parameter(
                server_url=credentials['server_url'],
                model_uid=credentials['model_uid']
            )
            if 'completion_type' not in credentials:
                if 'chat' in extra_param.model_ability:
                    credentials['completion_type'] = 'chat'
                elif 'generate' in extra_param.model_ability:
                    credentials['completion_type'] = 'completion'
                else:
                    raise ValueError(f'xinference model ability {extra_param.model_ability} is not supported, check if you have the right model type')
                
            if extra_param.support_function_call:
                credentials['support_function_call'] = True

            if extra_param.context_length:
                credentials['context_length'] = extra_param.context_length

        except RuntimeError as e:
            raise CredentialsValidateFailedError(f'Xinference credentials validate failed: {e}')
        except KeyError as e:
            raise CredentialsValidateFailedError(f'Xinference credentials validate failed: {e}')
        except Exception as e:
            raise e

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: list[PromptMessageTool] | None = None) -> int:
        """
            get number of tokens

            cause XinferenceAI LLM is a customized model, we could net detect which tokenizer to use
            so we just take the GPT2 tokenizer as default
        """
        return self._num_tokens_from_messages(prompt_messages, tools)

    def _num_tokens_from_messages(self, messages: list[PromptMessage], tools: list[PromptMessageTool], 
                                  is_completion_model: bool = False) -> int:
        def tokens(text: str):
            return self._get_num_tokens_by_gpt2(text)

        if is_completion_model:
            return sum([tokens(str(message.content)) for message in messages])

        tokens_per_message = 3
        tokens_per_name = 1

        num_tokens = 0
        messages_dict = [self._convert_prompt_message_to_dict(m) for m in messages]
        for message in messages_dict:
            num_tokens += tokens_per_message
            for key, value in message.items():
                if isinstance(value, list):
                    text = ''
                    for item in value:
                        if isinstance(item, dict) and item['type'] == 'text':
                            text += item.text

                    value = text

                if key == "tool_calls":
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
                if key == "function_call":
                    for t_key, t_value in value.items():
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
            # calculate num tokens for function object
            num_tokens += tokens('name')
            num_tokens += tokens(tool.name)
            num_tokens += tokens('description')
            num_tokens += tokens(tool.description)
            parameters = tool.parameters
            num_tokens += tokens('parameters')
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
    
    def _convert_prompt_message_to_text(self, message: list[PromptMessage]) -> str:
        """
            convert prompt message to text
        """
        text = ''
        for item in message:
            if isinstance(item, UserPromptMessage):
                text += item.content
            elif isinstance(item, SystemPromptMessage):
                text += item.content
            elif isinstance(item, AssistantPromptMessage):
                text += item.content
            else:
                raise NotImplementedError(f'PromptMessage type {type(item)} is not supported')
        return text

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
            if message.tool_calls and len(message.tool_calls) > 0:
                message_dict["function_call"] = {
                    "name": message.tool_calls[0].function.name,
                    "arguments": message.tool_calls[0].function.arguments
                }
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = {"tool_call_id": message.tool_call_id, "role": "tool", "content": message.content}
        else:
            raise ValueError(f"Unknown message type {type(message)}")
        
        return message_dict

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        rules = [
            ParameterRule(
                name='temperature',
                type=ParameterType.FLOAT,
                use_template='temperature',
                label=I18nObject(
                    zh_Hans='温度',
                    en_US='Temperature'
                ),
            ),
            ParameterRule(
                name='top_p',
                type=ParameterType.FLOAT,
                use_template='top_p',
                label=I18nObject(
                    zh_Hans='Top P',
                    en_US='Top P'
                )
            ),
            ParameterRule(
                name='max_tokens',
                type=ParameterType.INT,
                use_template='max_tokens',
                min=1,
                max=credentials.get('context_length', 2048),
                default=512,
                label=I18nObject(
                    zh_Hans='最大生成长度',
                    en_US='Max Tokens'
                )
            )
        ]

        completion_type = None

        if 'completion_type' in credentials:
            if credentials['completion_type'] == 'chat':
                completion_type = LLMMode.CHAT.value
            elif credentials['completion_type'] == 'completion':
                completion_type = LLMMode.COMPLETION.value
            else:
                raise ValueError(f'completion_type {credentials["completion_type"]} is not supported')
        else:
            extra_args = XinferenceHelper.get_xinference_extra_parameter(
                server_url=credentials['server_url'],
                model_uid=credentials['model_uid']
            )

            if 'chat' in extra_args.model_ability:
                completion_type = LLMMode.CHAT.value
            elif 'generate' in extra_args.model_ability:
                completion_type = LLMMode.COMPLETION.value
            else:
                raise ValueError(f'xinference model ability {extra_args.model_ability} is not supported')
            
        support_function_call = credentials.get('support_function_call', False)
        context_length = credentials.get('context_length', 2048)

        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            features=[
                ModelFeature.TOOL_CALL
            ] if support_function_call else [],
            model_properties={ 
                ModelPropertyKey.MODE: completion_type,
                ModelPropertyKey.CONTEXT_SIZE: context_length
            },
            parameter_rules=rules
        )

        return entity
    
    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], 
                 model_parameters: dict, extra_model_kwargs: XinferenceModelExtraParameter,
                 tools: list[PromptMessageTool] | None = None, 
                 stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
        """
            generate text from LLM

            see `core.model_runtime.model_providers.__base.large_language_model.LargeLanguageModel._generate`
            
            extra_model_kwargs can be got by `XinferenceHelper.get_xinference_extra_parameter`
        """
        if 'server_url' not in credentials:
            raise CredentialsValidateFailedError('server_url is required in credentials')
        
        if credentials['server_url'].endswith('/'):
            credentials['server_url'] = credentials['server_url'][:-1]

        client = OpenAI(
            base_url=f'{credentials["server_url"]}/v1',
            api_key='abc',
            max_retries=3,
            timeout=60,
        )

        xinference_client = Client(
            base_url=credentials['server_url'],
        )

        xinference_model = xinference_client.get_model(credentials['model_uid'])

        generate_config = {
            'temperature': model_parameters.get('temperature', 1.0),
            'top_p': model_parameters.get('top_p', 0.7),
            'max_tokens': model_parameters.get('max_tokens', 512),
        }

        if stop:
            generate_config['stop'] = stop

        if tools and len(tools) > 0:
            generate_config['tools'] = [
                {
                    'type': 'function',
                    'function': helper.dump_model(tool)
                } for tool in tools
            ]

        if isinstance(xinference_model, RESTfulChatModelHandle | RESTfulChatglmCppChatModelHandle):
            resp = client.chat.completions.create(
                model=credentials['model_uid'],
                messages=[self._convert_prompt_message_to_dict(message) for message in prompt_messages], 
                stream=stream,
                user=user,
                **generate_config,
            )
            if stream:
                if tools and len(tools) > 0:
                    raise InvokeBadRequestError('xinference tool calls does not support stream mode')
                return self._handle_chat_stream_response(model=model, credentials=credentials, prompt_messages=prompt_messages,
                                                        tools=tools, resp=resp)
            return self._handle_chat_generate_response(model=model, credentials=credentials, prompt_messages=prompt_messages,
                                                        tools=tools, resp=resp)
        elif isinstance(xinference_model, RESTfulGenerateModelHandle):
            resp = client.completions.create(
                model=credentials['model_uid'],
                prompt=self._convert_prompt_message_to_text(prompt_messages),
                stream=stream,
                user=user,
                **generate_config,
            )
            if stream:
                return self._handle_completion_stream_response(model=model, credentials=credentials, prompt_messages=prompt_messages,
                                                        tools=tools, resp=resp)
            return self._handle_completion_generate_response(model=model, credentials=credentials, prompt_messages=prompt_messages,
                                                        tools=tools, resp=resp)
        else:
            raise NotImplementedError(f'xinference model handle type {type(xinference_model)} is not supported')

    def _extract_response_tool_calls(self,
                                     response_tool_calls: list[ChatCompletionMessageToolCall | ChoiceDeltaToolCall]) \
            -> list[AssistantPromptMessage.ToolCall]:
        """
        Extract tool calls from response

        :param response_tool_calls: response tool calls
        :return: list of tool calls
        """
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

    def _extract_response_function_call(self, response_function_call: FunctionCall | ChoiceDeltaFunctionCall) \
            -> AssistantPromptMessage.ToolCall:
        """
        Extract function call from response

        :param response_function_call: response function call
        :return: tool call
        """
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

    def _handle_chat_generate_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                        tools: list[PromptMessageTool],
                                        resp: ChatCompletion) -> LLMResult:
        """
            handle normal chat generate response
        """
        if len(resp.choices) == 0:
            raise InvokeServerUnavailableError("Empty response")
        
        assistant_message = resp.choices[0].message

        # convert tool call to assistant message tool call
        tool_calls = assistant_message.tool_calls
        assistant_prompt_message_tool_calls = self._extract_response_tool_calls(tool_calls if tool_calls else [])
        function_call = assistant_message.function_call
        if function_call:
            assistant_prompt_message_tool_calls += [self._extract_response_function_call(function_call)]

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_message.content,
            tool_calls=assistant_prompt_message_tool_calls
        )

        prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
        completion_tokens = self._num_tokens_from_messages(messages=[assistant_prompt_message], tools=tools)

        usage = self._calc_response_usage(model=model, credentials=credentials, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            system_fingerprint=resp.system_fingerprint,
            usage=usage,
            message=assistant_prompt_message,
        )

        return response

    def _handle_chat_stream_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                        tools: list[PromptMessageTool],
                                        resp: Iterator[ChatCompletionChunk]) -> Generator:
        """
            handle stream chat generate response
        """
        full_response = ''

        for chunk in resp:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.delta.content is None or delta.delta.content == ''):
                continue
            
            # check if there is a tool call in the response
            function_call = None
            tool_calls = []
            if delta.delta.tool_calls:
                tool_calls += delta.delta.tool_calls
            if delta.delta.function_call:
                function_call = delta.delta.function_call

            assistant_message_tool_calls = self._extract_response_tool_calls(tool_calls)
            if function_call:
                assistant_message_tool_calls += [self._extract_response_function_call(function_call)]

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content=delta.delta.content if delta.delta.content else '',
                tool_calls=assistant_message_tool_calls
            )

            if delta.finish_reason is not None:
                # temp_assistant_prompt_message is used to calculate usage
                temp_assistant_prompt_message = AssistantPromptMessage(
                    content=full_response,
                    tool_calls=assistant_message_tool_calls
                )

                prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
                completion_tokens = self._num_tokens_from_messages(messages=[temp_assistant_prompt_message], tools=[])

                usage = self._calc_response_usage(model=model, credentials=credentials, 
                                                  prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
                
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
                        usage=usage
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=assistant_prompt_message,
                    ),
                )

                full_response += delta.delta.content

    def _handle_completion_generate_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                        tools: list[PromptMessageTool],
                                        resp: Completion) -> LLMResult:
        """
            handle normal completion generate response
        """
        if len(resp.choices) == 0:
            raise InvokeServerUnavailableError("Empty response")
        
        assistant_message = resp.choices[0].text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_message,
            tool_calls=[]
        )

        prompt_tokens = self._get_num_tokens_by_gpt2(
            self._convert_prompt_message_to_text(prompt_messages)
        )
        completion_tokens = self._num_tokens_from_messages(
            messages=[assistant_prompt_message], tools=[], is_completion_model=True
        )
        usage = self._calc_response_usage(
            model=model, credentials=credentials, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            system_fingerprint=resp.system_fingerprint,
            usage=usage,
            message=assistant_prompt_message,
        )

        return response

    def _handle_completion_stream_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                        tools: list[PromptMessageTool],
                                        resp: Iterator[Completion]) -> Generator:
        """
            handle stream completion generate response
        """
        full_response = ''

        for chunk in resp:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content=delta.text if delta.text else '',
                tool_calls=[]
            )

            if delta.finish_reason is not None:
                # temp_assistant_prompt_message is used to calculate usage
                temp_assistant_prompt_message = AssistantPromptMessage(
                    content=full_response,
                    tool_calls=[]
                )

                prompt_tokens = self._get_num_tokens_by_gpt2(
                    self._convert_prompt_message_to_text(prompt_messages)
                )
                completion_tokens = self._num_tokens_from_messages(
                    messages=[temp_assistant_prompt_message], tools=[], is_completion_model=True
                )
                usage = self._calc_response_usage(model=model, credentials=credentials, 
                                                  prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
                
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
                        usage=usage
                    ),
                )
            else:
                if delta.text is None or delta.text == '':
                    continue

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=assistant_prompt_message,
                    ),
                )

                full_response += delta.text

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