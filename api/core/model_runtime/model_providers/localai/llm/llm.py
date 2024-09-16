from collections.abc import Generator
from typing import cast

from httpx import Timeout
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
    Stream,
    UnprocessableEntityError,
)
from openai.types.chat import ChatCompletion, ChatCompletionChunk
from openai.types.chat.chat_completion_message import FunctionCall
from openai.types.completion import Completion
from yarl import URL

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
from core.model_runtime.utils import helper


class LocalAILanguageModel(LargeLanguageModel):
    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ) -> LLMResult | Generator:
        return self._generate(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        # tools is not supported yet
        return self._num_tokens_from_messages(prompt_messages, tools=tools)

    def _num_tokens_from_messages(self, messages: list[PromptMessage], tools: list[PromptMessageTool]) -> int:
        """
        Calculate num tokens for baichuan model
        LocalAI does not supports
        """

        def tokens(text: str):
            """
            We could not determine which tokenizer to use, cause the model is customized.
            So we use gpt2 tokenizer to calculate the num tokens for convenience.
            """
            return self._get_num_tokens_by_gpt2(text)

        tokens_per_message = 3
        tokens_per_name = 1

        num_tokens = 0
        messages_dict = [self._convert_prompt_message_to_dict(m) for m in messages]
        for message in messages_dict:
            num_tokens += tokens_per_message
            for key, value in message.items():
                if isinstance(value, list):
                    text = ""
                    for item in value:
                        if isinstance(item, dict) and item["type"] == "text":
                            text += item["text"]

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
            num_tokens += tokens("name")
            num_tokens += tokens(tool.name)
            num_tokens += tokens("description")
            num_tokens += tokens(tool.description)
            parameters = tool.parameters
            num_tokens += tokens("parameters")
            num_tokens += tokens("type")
            num_tokens += tokens(parameters.get("type"))
            if "properties" in parameters:
                num_tokens += tokens("properties")
                for key, value in parameters.get("properties").items():
                    num_tokens += tokens(key)
                    for field_key, field_value in value.items():
                        num_tokens += tokens(field_key)
                        if field_key == "enum":
                            for enum_field in field_value:
                                num_tokens += 3
                                num_tokens += tokens(enum_field)
                        else:
                            num_tokens += tokens(field_key)
                            num_tokens += tokens(str(field_value))
            if "required" in parameters:
                num_tokens += tokens("required")
                for required_field in parameters["required"]:
                    num_tokens += 3
                    num_tokens += tokens(required_field)

        return num_tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._invoke(
                model=model,
                credentials=credentials,
                prompt_messages=[UserPromptMessage(content="ping")],
                model_parameters={
                    "max_tokens": 10,
                },
                stop=[],
                stream=False,
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(f"Invalid credentials {str(ex)}")

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        completion_model = None
        if credentials["completion_type"] == "chat_completion":
            completion_model = LLMMode.CHAT.value
        elif credentials["completion_type"] == "completion":
            completion_model = LLMMode.COMPLETION.value
        else:
            raise ValueError(f"Unknown completion type {credentials['completion_type']}")

        rules = [
            ParameterRule(
                name="temperature",
                type=ParameterType.FLOAT,
                use_template="temperature",
                label=I18nObject(zh_Hans="温度", en_US="Temperature"),
            ),
            ParameterRule(
                name="top_p",
                type=ParameterType.FLOAT,
                use_template="top_p",
                label=I18nObject(zh_Hans="Top P", en_US="Top P"),
            ),
            ParameterRule(
                name="max_tokens",
                type=ParameterType.INT,
                use_template="max_tokens",
                min=1,
                max=2048,
                default=512,
                label=I18nObject(zh_Hans="最大生成长度", en_US="Max Tokens"),
            ),
        ]

        model_properties = (
            {
                ModelPropertyKey.MODE: completion_model,
            }
            if completion_model
            else {}
        )

        model_properties[ModelPropertyKey.CONTEXT_SIZE] = int(credentials.get("context_size", "2048"))

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties=model_properties,
            parameter_rules=rules,
        )

        return entity

    def _generate(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ) -> LLMResult | Generator:
        kwargs = self._to_client_kwargs(credentials)
        # init model client
        client = OpenAI(**kwargs)

        model_name = model
        completion_type = credentials["completion_type"]

        extra_model_kwargs = {
            "timeout": 60,
        }
        if stop:
            extra_model_kwargs["stop"] = stop

        if user:
            extra_model_kwargs["user"] = user

        if tools and len(tools) > 0:
            extra_model_kwargs["functions"] = [helper.dump_model(tool) for tool in tools]

        if completion_type == "chat_completion":
            result = client.chat.completions.create(
                messages=[self._convert_prompt_message_to_dict(m) for m in prompt_messages],
                model=model_name,
                stream=stream,
                **model_parameters,
                **extra_model_kwargs,
            )
        elif completion_type == "completion":
            result = client.completions.create(
                prompt=self._convert_prompt_message_to_completion_prompts(prompt_messages),
                model=model,
                stream=stream,
                **model_parameters,
                **extra_model_kwargs,
            )
        else:
            raise ValueError(f"Unknown completion type {completion_type}")

        if stream:
            if completion_type == "completion":
                return self._handle_completion_generate_stream_response(
                    model=model, credentials=credentials, response=result, tools=tools, prompt_messages=prompt_messages
                )
            return self._handle_chat_generate_stream_response(
                model=model, credentials=credentials, response=result, tools=tools, prompt_messages=prompt_messages
            )

        if completion_type == "completion":
            return self._handle_completion_generate_response(
                model=model, credentials=credentials, response=result, prompt_messages=prompt_messages
            )
        return self._handle_chat_generate_response(
            model=model, credentials=credentials, response=result, tools=tools, prompt_messages=prompt_messages
        )

    def _to_client_kwargs(self, credentials: dict) -> dict:
        """
        Convert invoke kwargs to client kwargs

        :param credentials: credentials dict
        :return: client kwargs
        """
        if not credentials["server_url"].endswith("/"):
            credentials["server_url"] += "/"

        client_kwargs = {
            "timeout": Timeout(315.0, read=300.0, write=10.0, connect=5.0),
            "api_key": "1",
            "base_url": str(URL(credentials["server_url"]) / "v1"),
        }

        return client_kwargs

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
                    "arguments": message.tool_calls[0].function.arguments,
                }
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            # copy from core/model_runtime/model_providers/anthropic/llm/llm.py
            message = cast(ToolPromptMessage, message)
            message_dict = {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": message.tool_call_id, "content": message.content}],
            }
        else:
            raise ValueError(f"Unknown message type {type(message)}")

        return message_dict

    def _convert_prompt_message_to_completion_prompts(self, messages: list[PromptMessage]) -> str:
        """
        Convert PromptMessage to completion prompts
        """
        prompts = ""
        for message in messages:
            if isinstance(message, UserPromptMessage):
                message = cast(UserPromptMessage, message)
                prompts += f"{message.content}\n"
            elif isinstance(message, AssistantPromptMessage):
                message = cast(AssistantPromptMessage, message)
                prompts += f"{message.content}\n"
            elif isinstance(message, SystemPromptMessage):
                message = cast(SystemPromptMessage, message)
                prompts += f"{message.content}\n"
            else:
                raise ValueError(f"Unknown message type {type(message)}")

        return prompts

    def _handle_completion_generate_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: Completion,
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
        if len(response.choices) == 0:
            raise InvokeServerUnavailableError("Empty response")

        assistant_message = response.choices[0].text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_message, tool_calls=[])

        prompt_tokens = self._get_num_tokens_by_gpt2(
            self._convert_prompt_message_to_completion_prompts(prompt_messages)
        )
        completion_tokens = self._num_tokens_from_messages(messages=[assistant_prompt_message], tools=[])

        usage = self._calc_response_usage(
            model=model, credentials=credentials, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            system_fingerprint=response.system_fingerprint,
            usage=usage,
            message=assistant_prompt_message,
        )

        return response

    def _handle_chat_generate_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: ChatCompletion,
        tools: list[PromptMessageTool],
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
        if len(response.choices) == 0:
            raise InvokeServerUnavailableError("Empty response")

        assistant_message = response.choices[0].message

        # convert function call to tool call
        function_calls = assistant_message.function_call
        tool_calls = self._extract_response_tool_calls([function_calls] if function_calls else [])

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_message.content, tool_calls=tool_calls)

        prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
        completion_tokens = self._num_tokens_from_messages(messages=[assistant_prompt_message], tools=tools)

        usage = self._calc_response_usage(
            model=model, credentials=credentials, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            system_fingerprint=response.system_fingerprint,
            usage=usage,
            message=assistant_prompt_message,
        )

        return response

    def _handle_completion_generate_stream_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: Stream[Completion],
        tools: list[PromptMessageTool],
    ) -> Generator:
        full_response = ""

        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(content=delta.text or "", tool_calls=[])

            if delta.finish_reason is not None:
                # temp_assistant_prompt_message is used to calculate usage
                temp_assistant_prompt_message = AssistantPromptMessage(content=full_response, tool_calls=[])

                prompt_tokens = self._get_num_tokens_by_gpt2(
                    self._convert_prompt_message_to_completion_prompts(prompt_messages)
                )

                completion_tokens = self._num_tokens_from_messages(messages=[temp_assistant_prompt_message], tools=[])

                usage = self._calc_response_usage(
                    model=model,
                    credentials=credentials,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )

                yield LLMResultChunk(
                    model=model,
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
                    model=model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=assistant_prompt_message,
                    ),
                )

                full_response += delta.text

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: Stream[ChatCompletionChunk],
        tools: list[PromptMessageTool],
    ) -> Generator:
        full_response = ""

        for chunk in response:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.delta.content is None or delta.delta.content == ""):
                continue

            # check if there is a tool call in the response
            function_calls = None
            if delta.delta.function_call:
                function_calls = [delta.delta.function_call]

            assistant_message_tool_calls = self._extract_response_tool_calls(function_calls or [])

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content=delta.delta.content or "", tool_calls=assistant_message_tool_calls
            )

            if delta.finish_reason is not None:
                # temp_assistant_prompt_message is used to calculate usage
                temp_assistant_prompt_message = AssistantPromptMessage(
                    content=full_response, tool_calls=assistant_message_tool_calls
                )

                prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
                completion_tokens = self._num_tokens_from_messages(messages=[temp_assistant_prompt_message], tools=[])

                usage = self._calc_response_usage(
                    model=model,
                    credentials=credentials,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )

                yield LLMResultChunk(
                    model=model,
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
                    model=model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                    ),
                )

                full_response += delta.delta.content

    def _extract_response_tool_calls(
        self, response_function_calls: list[FunctionCall]
    ) -> list[AssistantPromptMessage.ToolCall]:
        """
        Extract tool calls from response

        :param response_tool_calls: response tool calls
        :return: list of tool calls
        """
        tool_calls = []
        if response_function_calls:
            for response_tool_call in response_function_calls:
                function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=response_tool_call.name, arguments=response_tool_call.arguments
                )

                tool_call = AssistantPromptMessage.ToolCall(id=0, type="function", function=function)
                tool_calls.append(tool_call)

        return tool_calls

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
                PermissionDeniedError,
            ],
            InvokeRateLimitError: [RateLimitError],
            InvokeAuthorizationError: [AuthenticationError],
            InvokeBadRequestError: [ValueError],
        }
