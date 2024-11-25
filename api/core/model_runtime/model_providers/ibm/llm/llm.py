from collections.abc import Generator
from typing import Any, Optional, Union, cast

import requests
from ibm_watsonx_ai import APIClient, Credentials
from ibm_watsonx_ai.foundation_models import ModelInference
from ibm_watsonx_ai.foundation_models.schema import TextChatParameters, TextGenParameters

from core.model_runtime.entities.llm_entities import (
    LLMMode,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContent,
    PromptMessageContentType,
    PromptMessageFunction,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    I18nObject,
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
from core.model_runtime.utils import helper


class IbmLargeLanguageModel(LargeLanguageModel):
    """
    Model class for IBM large language model.
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

        model_mode = self.get_model_mode(model, credentials)

        if model_mode == LLMMode.CHAT:
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
        """
        Get number of tokens for given prompt messages

        :param model:
        :param credentials:
        :param prompt_messages:
        :param tools: tools for tool calling
        :return:
        """
        return self._num_tokens_from_messages(model, prompt_messages, tools, credentials)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """

        try:
            model_mode = self.get_model_mode(model)

            if model_mode == LLMMode.CHAT:
                self._chat_generate(
                    model=model,
                    credentials=credentials,
                    prompt_messages=[UserPromptMessage(content="ping")],
                    model_parameters={
                        "max_tokens": 20,
                        "temperature": 0,
                    },
                    stream=False,
                )
            else:
                self._generate(
                    model=model,
                    credentials=credentials,
                    prompt_messages=[UserPromptMessage(content="ping")],
                    model_parameters={
                        "max_new_tokens": 20,
                        "temperature": 0,
                    },
                    stream=False,
                )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
        generate custom model entities from credentials

        :param model: model name
        :param credentials: credentials

        :return: AIModelEntity
        """

        features = []

        # tool_call support
        function_calling_type = credentials.get("function_calling_type", "no_call")
        if function_calling_type == "tool_call":
            features.append(ModelFeature.MULTI_TOOL_CALL)

        # vision_support
        vision_support = credentials.get("vision_support", "not_support")
        if vision_support == "support":
            features.append(ModelFeature.VISION)

        completion_model = None
        if credentials.get("mode") == "chat":
            completion_model = LLMMode.CHAT.value
        elif credentials.get("mode") == "completion":
            completion_model = LLMMode.COMPLETION.value

        model_properties = (
            {
                ModelPropertyKey.MODE: completion_model,
            }
            if completion_model
            else {}
        )

        model_parameters_rules = [
            ParameterRule(
                name=DefaultParameterName.TEMPERATURE.value,
                label=I18nObject(en_US="Temperature", zh_Hans="温度"),
                type=ParameterType.FLOAT,
                default=0.7,
                min=0,
                max=2,
                precision=2,
            ),
            ParameterRule(
                name=DefaultParameterName.TOP_P.value,
                label=I18nObject(en_US="Top P", zh_Hans="Top P"),
                type=ParameterType.FLOAT,
                default=float(1),
                min=0,
                max=1,
                precision=2,
            ),
        ]

        if completion_model == LLMMode.CHAT.value:
            model_parameters_rules.append(
                ParameterRule(
                    name=DefaultParameterName.FREQUENCY_PENALTY.value,
                    label=I18nObject(en_US="Frequency Penalty", zh_Hans="频率惩罚"),
                    type=ParameterType.FLOAT,
                    default=0.5,
                    min=-2,
                    max=2,
                )
            )
            model_parameters_rules.append(
                ParameterRule(
                    name=DefaultParameterName.PRESENCE_PENALTY.value,
                    label=I18nObject(en_US="Presence Penalty", zh_Hans="存在惩罚"),
                    type=ParameterType.FLOAT,
                    default=0.3,
                    min=-2,
                    max=2,
                )
            )
            model_parameters_rules.append(
                ParameterRule(
                    name=DefaultParameterName.MAX_TOKENS.value,
                    label=I18nObject(en_US="Max Tokens", zh_Hans="最大标记"),
                    type=ParameterType.INT,
                    default=4096,
                    min=1,
                    max=128000,
                )
            )
        else:
            model_parameters_rules.append(
                ParameterRule(
                    name="max_new_tokens",
                    label=I18nObject(en_US="Max New Tokens", zh_Hans="最大新令牌数"),
                    type=ParameterType.INT,
                    default=4096,
                    min=1,
                    max=128000,
                )
            )
            model_parameters_rules.append(
                ParameterRule(
                    name="min_new_tokens",
                    label=I18nObject(en_US="Min New Tokens", zh_Hans="最小新标记数量"),
                    type=ParameterType.INT,
                    default=0,
                    min=0,
                )
            )
            model_parameters_rules.append(
                ParameterRule(
                    name="repetition_penalty",
                    label=I18nObject(en_US="Repetition Penalty", zh_Hans="重复惩罚"),
                    type=ParameterType.FLOAT,
                    default=float(1),
                    min=1,
                    max=2,
                    precision=2,
                )
            )
            model_parameters_rules.append(
                ParameterRule(
                    name=DefaultParameterName.TOP_K.value,
                    label=I18nObject(en_US="Top K", zh_Hans="顶部 K"),
                    type=ParameterType.INT,
                    default=50,
                    min=1,
                    max=100,
                )
            )

        entity = AIModelEntity(
            model=model,
            label=I18nObject(zh_Hans=model, en_US=model),
            model_type=ModelType.LLM,
            features=list(features),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties=dict(model_properties),
            parameter_rules=list(model_parameters_rules),
        )

        return entity

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
        """
        Generate llm model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """

        # initialize credentials, client and model_inference
        ibmCredentials = Credentials(
            url=credentials.get("base_url"),
            api_key=credentials.get("api_key"),
        )
        client = APIClient(ibmCredentials, project_id=credentials.get("project_id"))
        model_inference = ModelInference(model_id=model, api_client=client)

        params = TextGenParameters(**model_parameters)
        if stop:
            params.stop_sequences = stop

        if stream:
            response = model_inference.generate_text_stream(
                prompt=prompt_messages[0].content, params=params, raw_response=True
            )

            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)
        else:
            response = model_inference.generate_text(
                prompt=prompt_messages[0].content, params=params, raw_response=True
            )

            return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(
        self, model: str, credentials: dict, response: Any, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm generate response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        resultsList = response.get("results")
        if not resultsList:
            raise InvokeBadRequestError(f"Invalid response structure: missing or empty 'results': {response}")
        results = resultsList[0]

        # get assistant_text and transform it to prompt message
        assistant_text = results.get("generated_text")
        assistant_prompt_message = AssistantPromptMessage(content=assistant_text)

        # calculate tokens and usage
        prompt_tokens = results.get("input_token_count")
        if prompt_tokens is None:
            prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)
        completion_tokens = results.get("generated_token_count")
        if completion_tokens is None:
            completion_tokens = self._num_tokens_from_messages(model, credentials, [assistant_prompt_message])
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        return LLMResult(model=model, prompt_messages=prompt_messages, message=assistant_prompt_message, usage=usage)

    def _handle_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        response: Generator[Any],
        prompt_messages: list[PromptMessage],
    ) -> Generator:
        """
        Handle llm generate stream response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """
        chunk_index = 0
        full_assistant_content = ""

        for chunk in response:
            resultsList = chunk.get("results")
            if not resultsList:
                raise InvokeBadRequestError(f"Invalid chunk structure: missing or empty 'results': {chunk}")
            results = resultsList[0]

            finish_reason = results.get("stop_reason")

            if finish_reason == "not_finished":
                # Process chunk's generated_text
                generated_text = results.get("generated_text")

                if not generated_text:  # Skip chunks with empty or None generated_text
                    continue

                # Create assistant message and append content
                assistant_prompt_message = AssistantPromptMessage(content=generated_text)
                full_assistant_content += generated_text

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=assistant_prompt_message,
                    ),
                )

                chunk_index += 1
                continue  # Skip further processing for already handled chunk

            else:
                # calculate tokens and usage
                prompt_tokens = results.get("input_token_count")
                if prompt_tokens is None:
                    prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)
                completion_tokens = results.get("generated_token_count")
                if completion_tokens is None:
                    completion_tokens = self._num_tokens_from_messages(
                        model, credentials, [AssistantPromptMessage(content=full_assistant_content)]
                    )
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=AssistantPromptMessage(content=""),
                        finish_reason=finish_reason,
                        usage=usage,
                    ),
                )
                break

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
        """
        Invoke llm chat model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """

        # initialize credentials, client and model_inference
        ibmCredentials = Credentials(
            url=credentials.get("base_url"),
            api_key=credentials.get("api_key"),
        )
        client = APIClient(ibmCredentials, project_id=credentials.get("project_id"))
        model_inference = ModelInference(model_id=model, api_client=client)

        params = TextChatParameters(**model_parameters)

        messages = [self._convert_prompt_message_to_dict(m, credentials) for m in prompt_messages]
        # Filter messages: IBM LLM invocation allow at most one image per request
        messages = self.filter_prompt_image_messages(messages)

        function_calling_type = credentials.get("function_calling_type", "no_call")
        formatted_tools = None
        if tools and function_calling_type == "tool_call":
            formatted_tools = []
            for tool in tools:
                formatted_tools.append(helper.dump_model(PromptMessageFunction(function=tool)))

        if stream:
            response = model_inference.chat_stream(
                messages=messages,
                params=model_parameters,
                tools=formatted_tools,
            )

            return self._handle_chat_generate_stream_response(model, credentials, response, prompt_messages)
        else:
            response = model_inference.chat(
                messages=messages,
                params=model_parameters,
                tools=formatted_tools,
            )

            return self._handle_chat_generate_response(model, credentials, response, prompt_messages)

    def _handle_chat_generate_response(
        self, model: str, credentials: dict, response: dict, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: LLMResult - llm response
        """

        function_calling_type = credentials.get("function_calling_type", "no_call")

        output = response["choices"][0]
        message_id = response.get("id")

        response_content = output.get("message", {}).get("content", None)

        tool_calls = None
        if function_calling_type == "tool_call":
            tool_calls = output.get("message", {}).get("tool_calls")

        assistant_message = AssistantPromptMessage(content=response_content, tool_calls=[])

        if tool_calls and function_calling_type == "tool_call":
            assistant_message.tool_calls = self._extract_response_tool_calls(tool_calls)

        # calculate tokens and usage
        if response.get("usage"):
            prompt_tokens = response["usage"]["prompt_tokens"]
            completion_tokens = response["usage"]["completion_tokens"]
        else:
            prompt_tokens = self._num_tokens_from_string(model, prompt_messages[0].content)
            completion_tokens = self._num_tokens_from_string(model, assistant_message.content)
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        return LLMResult(
            id=message_id, model=model, prompt_messages=prompt_messages, message=assistant_message, usage=usage
        )

    def _handle_chat_generate_stream_response(
        self, model: str, credentials: dict, response: Generator, prompt_messages: list[PromptMessage]
    ) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: model credentials
        :param response: streamed response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """
        chunk_index = 0
        full_assistant_content = ""

        def create_final_llm_result_chunk(
            id: Optional[str], index: int, message: AssistantPromptMessage, finish_reason: str, usage: dict
        ) -> LLMResultChunk:
            # calculate tokens and usage
            prompt_tokens = usage and usage.get("prompt_tokens")
            if prompt_tokens is None:
                prompt_tokens = self._num_tokens_from_string(model, prompt_messages[0].content)
            completion_tokens = usage and usage.get("completion_tokens")
            if completion_tokens is None:
                completion_tokens = self._num_tokens_from_string(model, full_assistant_content)
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                id=id,
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(index=index, message=message, finish_reason=finish_reason, usage=usage),
            )

        tools_calls: list[AssistantPromptMessage.ToolCall] = []

        def increase_tool_call(new_tool_calls: list[AssistantPromptMessage.ToolCall]):
            def get_tool_call(tool_call_id: str):
                if not tool_call_id:
                    return tools_calls[-1]

                tool_call = next((tool_call for tool_call in tools_calls if tool_call.id == tool_call_id), None)
                if tool_call is None:
                    tool_call = AssistantPromptMessage.ToolCall(
                        id=tool_call_id,
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments=""),
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

        finish_reason = None  # The default value of finish_reason is None
        message_id, usage = None, None

        for chunk in response:
            if chunk:
                if chunk:
                    if u := chunk.get("usage"):
                        usage = u
                if not chunk or len(chunk["choices"]) == 0:
                    continue

                choice = chunk["choices"][0]
                finish_reason = chunk["choices"][0].get("finish_reason")
                message_id = chunk.get("id")
                chunk_index += 1

                if "delta" in choice:
                    delta = choice["delta"]
                    delta_content = delta.get("content")

                    assistant_message_tool_calls = None

                    if "tool_calls" in delta and credentials.get("function_calling_type", "no_call") == "tool_call":
                        assistant_message_tool_calls = delta.get("tool_calls", None)

                    # extract tool calls from response
                    if assistant_message_tool_calls:
                        tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
                        increase_tool_call(tool_calls)

                    if delta_content is None or delta_content == "":
                        continue

                    # transform assistant message to prompt message
                    assistant_prompt_message = AssistantPromptMessage(
                        content=delta_content,
                    )

                    # reset tool calls
                    tool_calls = []
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

                yield LLMResultChunk(
                    id=message_id,
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
                id=message_id,
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=chunk_index,
                    message=AssistantPromptMessage(tool_calls=tools_calls, content=""),
                ),
            )

        yield create_final_llm_result_chunk(
            id=message_id,
            index=chunk_index,
            message=AssistantPromptMessage(content=""),
            finish_reason=finish_reason,
            usage=usage,
        )

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
                function_calling_type = credentials.get("function_calling_type", "no_call")
                if function_calling_type == "tool_call":
                    message_dict["tool_calls"] = [tool_call.dict() for tool_call in message.tool_calls]
                elif function_calling_type == "function_call":
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
            function_calling_type = credentials.get("function_calling_type", "no_call")
            if function_calling_type == "tool_call":
                message_dict = {"role": "tool", "content": message.content, "tool_call_id": message.tool_call_id}
            elif function_calling_type == "function_call":
                message_dict = {"role": "function", "content": message.content, "name": message.tool_call_id}
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name and message_dict.get("role", "") != "tool":
            message_dict["name"] = message.name

        return message_dict

    def _num_tokens_from_string(
        self, model: str, text: Union[str, list[PromptMessageContent]], tools: Optional[list[PromptMessageTool]] = None
    ) -> int:
        """
        Approximate num tokens for model with gpt2 tokenizer.

        :param model: model name
        :param text: prompt text
        :param tools: tools for tool calling
        :return: number of tokens
        """
        if isinstance(text, str):
            full_text = text
        else:
            full_text = ""
            for message_content in text:
                if message_content.type == PromptMessageContentType.TEXT:
                    message_content = cast(PromptMessageContent, message_content)
                    full_text += message_content.data

        num_tokens = self._get_num_tokens_by_gpt2(full_text)

        if tools:
            num_tokens += self._num_tokens_for_tools(tools)

        return num_tokens

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
        messages_dict = [self._convert_prompt_message_to_dict(m, credentials) for m in messages]
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
                    name=response_tool_call.get("function", {}).get("name", ""),
                    arguments=response_tool_call.get("function", {}).get("arguments", ""),
                )

                tool_call = AssistantPromptMessage.ToolCall(
                    id=response_tool_call.get("id", ""), type=response_tool_call.get("type", ""), function=function
                )
                tool_calls.append(tool_call)

        return tool_calls

    def filter_prompt_image_messages(self, messages: list[dict]) -> list[dict]:
        prompt_user_messages_with_images = [
            message
            for message in messages
            if message["role"] == "user"
            and not isinstance(message["content"], str)
            and any(content.get("type") == "image_url" for content in message.get("content", []))
        ]

        if prompt_user_messages_with_images:
            last_prompt_user_message_with_image = prompt_user_messages_with_images[-1]
            messages = [
                message
                for message in messages
                if not (
                    message["role"] == "user"
                    and not isinstance(message["content"], str)
                    and any(content.get("type") == "image_url" for content in message.get("content", []))
                )
            ]
            messages.append(last_prompt_user_message_with_image)

        return messages

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
            Exception: [],
            InvokeAuthorizationError: [
                requests.exceptions.InvalidHeader,  # Missing or Invalid API Key
            ],
            InvokeBadRequestError: [
                requests.exceptions.HTTPError,  # Invalid Endpoint URL or model name
                requests.exceptions.InvalidURL,  # Misconfigured request or other API error
            ],
            InvokeRateLimitError: [
                requests.exceptions.RetryError  # Too many requests sent in a short period of time
            ],
            InvokeServerUnavailableError: [
                requests.exceptions.ConnectionError,  # Engine Overloaded
                requests.exceptions.HTTPError,  # Server Error
            ],
            InvokeConnectionError: [
                requests.exceptions.ConnectTimeout,  # Timeout
                requests.exceptions.ReadTimeout,  # Timeout
            ],
        }
