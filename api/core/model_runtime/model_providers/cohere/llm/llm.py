import json
import logging
from collections.abc import Generator, Iterator
from typing import Optional, Union, cast

import cohere
from cohere import (
    ChatMessage,
    ChatStreamRequestToolResultsItem,
    GenerateStreamedResponse,
    GenerateStreamedResponse_StreamEnd,
    GenerateStreamedResponse_StreamError,
    GenerateStreamedResponse_TextGeneration,
    Generation,
    NonStreamedChatResponse,
    StreamedChatResponse,
    StreamedChatResponse_StreamEnd,
    StreamedChatResponse_TextGeneration,
    StreamedChatResponse_ToolCallsGeneration,
    Tool,
    ToolCall,
    ToolParameterDefinitionsValue,
)
from cohere.core import RequestOptions

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageRole,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, I18nObject, ModelType
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


class CohereLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Cohere large language model.
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
        # get model mode
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

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        # get model mode
        model_mode = self.get_model_mode(model)

        try:
            if model_mode == LLMMode.CHAT:
                return self._num_tokens_from_messages(model, credentials, prompt_messages)
            else:
                return self._num_tokens_from_string(model, credentials, prompt_messages[0].content)
        except Exception as e:
            raise self._transform_invoke_error(e)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # get model mode
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
                        "max_tokens": 20,
                        "temperature": 0,
                    },
                    stream=False,
                )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

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
        Invoke llm model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # initialize client
        client = cohere.Client(credentials.get("api_key"), base_url=credentials.get("base_url"))

        if stop:
            model_parameters["end_sequences"] = stop

        if stream:
            response = client.generate_stream(
                prompt=prompt_messages[0].content,
                model=model,
                **model_parameters,
                request_options=RequestOptions(max_retries=0),
            )

            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)
        else:
            response = client.generate(
                prompt=prompt_messages[0].content,
                model=model,
                **model_parameters,
                request_options=RequestOptions(max_retries=0),
            )

            return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(
        self, model: str, credentials: dict, response: Generation, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        assistant_text = response.generations[0].text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_text)

        # calculate num tokens
        prompt_tokens = int(response.meta.billed_units.input_tokens)
        completion_tokens = int(response.meta.billed_units.output_tokens)

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        response = LLMResult(
            model=model, prompt_messages=prompt_messages, message=assistant_prompt_message, usage=usage
        )

        return response

    def _handle_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        response: Iterator[GenerateStreamedResponse],
        prompt_messages: list[PromptMessage],
    ) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """
        index = 1
        full_assistant_content = ""
        for chunk in response:
            if isinstance(chunk, GenerateStreamedResponse_TextGeneration):
                chunk = cast(GenerateStreamedResponse_TextGeneration, chunk)
                text = chunk.text

                if text is None:
                    continue

                # transform assistant message to prompt message
                assistant_prompt_message = AssistantPromptMessage(content=text)

                full_assistant_content += text

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                    ),
                )

                index += 1
            elif isinstance(chunk, GenerateStreamedResponse_StreamEnd):
                chunk = cast(GenerateStreamedResponse_StreamEnd, chunk)

                # calculate num tokens
                prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)
                completion_tokens = self._num_tokens_from_messages(
                    model, credentials, [AssistantPromptMessage(content=full_assistant_content)]
                )

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=AssistantPromptMessage(content=""),
                        finish_reason=chunk.finish_reason,
                        usage=usage,
                    ),
                )
                break
            elif isinstance(chunk, GenerateStreamedResponse_StreamError):
                chunk = cast(GenerateStreamedResponse_StreamError, chunk)
                raise InvokeBadRequestError(chunk.err)

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
        # initialize client
        client = cohere.Client(credentials.get("api_key"), base_url=credentials.get("base_url"))

        if stop:
            model_parameters["stop_sequences"] = stop

        if tools:
            if len(tools) == 1:
                raise ValueError("Cohere tool call requires at least two tools to be specified.")

            model_parameters["tools"] = self._convert_tools(tools)

        message, chat_histories, tool_results = self._convert_prompt_messages_to_message_and_chat_histories(
            prompt_messages
        )

        if tool_results:
            model_parameters["tool_results"] = tool_results

        # chat model
        real_model = model
        if self.get_model_schema(model, credentials).fetch_from == FetchFrom.PREDEFINED_MODEL:
            real_model = model.removesuffix("-chat")

        if stream:
            response = client.chat_stream(
                message=message,
                chat_history=chat_histories,
                model=real_model,
                **model_parameters,
                request_options=RequestOptions(max_retries=0),
            )

            return self._handle_chat_generate_stream_response(model, credentials, response, prompt_messages)
        else:
            response = client.chat(
                message=message,
                chat_history=chat_histories,
                model=real_model,
                **model_parameters,
                request_options=RequestOptions(max_retries=0),
            )

            return self._handle_chat_generate_response(model, credentials, response, prompt_messages)

    def _handle_chat_generate_response(
        self, model: str, credentials: dict, response: NonStreamedChatResponse, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        assistant_text = response.text

        tool_calls = []
        if response.tool_calls:
            for cohere_tool_call in response.tool_calls:
                tool_call = AssistantPromptMessage.ToolCall(
                    id=cohere_tool_call.name,
                    type="function",
                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                        name=cohere_tool_call.name, arguments=json.dumps(cohere_tool_call.parameters)
                    ),
                )
                tool_calls.append(tool_call)

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_text, tool_calls=tool_calls)

        # calculate num tokens
        prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)
        completion_tokens = self._num_tokens_from_messages(model, credentials, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        response = LLMResult(
            model=model, prompt_messages=prompt_messages, message=assistant_prompt_message, usage=usage
        )

        return response

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        response: Iterator[StreamedChatResponse],
        prompt_messages: list[PromptMessage],
    ) -> Generator:
        """
        Handle llm chat stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """

        def final_response(
            full_text: str,
            tool_calls: list[AssistantPromptMessage.ToolCall],
            index: int,
            finish_reason: Optional[str] = None,
        ) -> LLMResultChunk:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)

            full_assistant_prompt_message = AssistantPromptMessage(content=full_text, tool_calls=tool_calls)
            completion_tokens = self._num_tokens_from_messages(model, credentials, [full_assistant_prompt_message])

            # transform usage
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=AssistantPromptMessage(content="", tool_calls=tool_calls),
                    finish_reason=finish_reason,
                    usage=usage,
                ),
            )

        index = 1
        full_assistant_content = ""
        tool_calls = []
        for chunk in response:
            if isinstance(chunk, StreamedChatResponse_TextGeneration):
                chunk = cast(StreamedChatResponse_TextGeneration, chunk)
                text = chunk.text

                if text is None:
                    continue

                # transform assistant message to prompt message
                assistant_prompt_message = AssistantPromptMessage(content=text)

                full_assistant_content += text

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                    ),
                )

                index += 1
            elif isinstance(chunk, StreamedChatResponse_ToolCallsGeneration):
                chunk = cast(StreamedChatResponse_ToolCallsGeneration, chunk)
                if chunk.tool_calls:
                    for cohere_tool_call in chunk.tool_calls:
                        tool_call = AssistantPromptMessage.ToolCall(
                            id=cohere_tool_call.name,
                            type="function",
                            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                name=cohere_tool_call.name, arguments=json.dumps(cohere_tool_call.parameters)
                            ),
                        )
                        tool_calls.append(tool_call)
            elif isinstance(chunk, StreamedChatResponse_StreamEnd):
                chunk = cast(StreamedChatResponse_StreamEnd, chunk)
                yield final_response(full_assistant_content, tool_calls, index, chunk.finish_reason)
                index += 1

    def _convert_prompt_messages_to_message_and_chat_histories(
        self, prompt_messages: list[PromptMessage]
    ) -> tuple[str, list[ChatMessage], list[ChatStreamRequestToolResultsItem]]:
        """
        Convert prompt messages to message and chat histories
        :param prompt_messages: prompt messages
        :return:
        """
        chat_histories = []
        latest_tool_call_n_outputs = []
        for prompt_message in prompt_messages:
            if prompt_message.role == PromptMessageRole.ASSISTANT:
                prompt_message = cast(AssistantPromptMessage, prompt_message)
                if prompt_message.tool_calls:
                    for tool_call in prompt_message.tool_calls:
                        latest_tool_call_n_outputs.append(
                            ChatStreamRequestToolResultsItem(
                                call=ToolCall(
                                    name=tool_call.function.name, parameters=json.loads(tool_call.function.arguments)
                                ),
                                outputs=[],
                            )
                        )
                else:
                    cohere_prompt_message = self._convert_prompt_message_to_dict(prompt_message)
                    if cohere_prompt_message:
                        chat_histories.append(cohere_prompt_message)
            elif prompt_message.role == PromptMessageRole.TOOL:
                prompt_message = cast(ToolPromptMessage, prompt_message)
                if latest_tool_call_n_outputs:
                    i = 0
                    for tool_call_n_outputs in latest_tool_call_n_outputs:
                        if tool_call_n_outputs.call.name == prompt_message.tool_call_id:
                            latest_tool_call_n_outputs[i] = ChatStreamRequestToolResultsItem(
                                call=ToolCall(
                                    name=tool_call_n_outputs.call.name, parameters=tool_call_n_outputs.call.parameters
                                ),
                                outputs=[{"result": prompt_message.content}],
                            )
                            break
                        i += 1
            else:
                cohere_prompt_message = self._convert_prompt_message_to_dict(prompt_message)
                if cohere_prompt_message:
                    chat_histories.append(cohere_prompt_message)

        if latest_tool_call_n_outputs:
            new_latest_tool_call_n_outputs = []
            for tool_call_n_outputs in latest_tool_call_n_outputs:
                if tool_call_n_outputs.outputs:
                    new_latest_tool_call_n_outputs.append(tool_call_n_outputs)

            latest_tool_call_n_outputs = new_latest_tool_call_n_outputs

        # get latest message from chat histories and pop it
        if len(chat_histories) > 0:
            latest_message = chat_histories.pop()
            message = latest_message.message
        else:
            raise ValueError("Prompt messages is empty")

        return message, chat_histories, latest_tool_call_n_outputs

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> Optional[ChatMessage]:
        """
        Convert PromptMessage to dict for Cohere model
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                chat_message = ChatMessage(role="USER", message=message.content)
            else:
                sub_message_text = ""
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        sub_message_text += message_content.data

                chat_message = ChatMessage(role="USER", message=sub_message_text)
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            if not message.content:
                return None
            chat_message = ChatMessage(role="CHATBOT", message=message.content)
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            chat_message = ChatMessage(role="USER", message=message.content)
        elif isinstance(message, ToolPromptMessage):
            return None
        else:
            raise ValueError(f"Got unknown type {message}")

        return chat_message

    def _convert_tools(self, tools: list[PromptMessageTool]) -> list[Tool]:
        """
        Convert tools to Cohere model
        """
        cohere_tools = []
        for tool in tools:
            properties = tool.parameters["properties"]
            required_properties = tool.parameters["required"]

            parameter_definitions = {}
            for p_key, p_val in properties.items():
                required = False
                if p_key in required_properties:
                    required = True

                desc = p_val["description"]
                if "enum" in p_val:
                    desc += f"; Only accepts one of the following predefined options: [{', '.join(p_val['enum'])}]"

                parameter_definitions[p_key] = ToolParameterDefinitionsValue(
                    description=desc, type=p_val["type"], required=required
                )

            cohere_tool = Tool(
                name=tool.name, description=tool.description, parameter_definitions=parameter_definitions
            )

            cohere_tools.append(cohere_tool)

        return cohere_tools

    def _num_tokens_from_string(self, model: str, credentials: dict, text: str) -> int:
        """
        Calculate num tokens for text completion model.

        :param model: model name
        :param credentials: credentials
        :param text: prompt text
        :return: number of tokens
        """
        # initialize client
        client = cohere.Client(credentials.get("api_key"), base_url=credentials.get("base_url"))

        response = client.tokenize(text=text, model=model)

        return len(response.tokens)

    def _num_tokens_from_messages(self, model: str, credentials: dict, messages: list[PromptMessage]) -> int:
        """Calculate num tokens Cohere model."""
        calc_messages = []
        for message in messages:
            cohere_message = self._convert_prompt_message_to_dict(message)
            if cohere_message:
                calc_messages.append(cohere_message)
        message_strs = [f"{message.role}: {message.message}" for message in calc_messages]
        message_str = "\n".join(message_strs)

        real_model = model
        if self.get_model_schema(model, credentials).fetch_from == FetchFrom.PREDEFINED_MODEL:
            real_model = model.removesuffix("-chat")

        return self._num_tokens_from_string(real_model, credentials, message_str)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
        Cohere supports fine-tuning of their models. This method returns the schema of the base model
        but renamed to the fine-tuned model name.

        :param model: model name
        :param credentials: credentials

        :return: model schema
        """
        # get model schema
        models = self.predefined_models()
        model_map = {model.model: model for model in models}

        mode = credentials.get("mode")

        if mode == "chat":
            base_model_schema = model_map["command-light-chat"]
        else:
            base_model_schema = model_map["command-light"]

        base_model_schema = cast(AIModelEntity, base_model_schema)

        base_model_schema_features = base_model_schema.features or []
        base_model_schema_model_properties = base_model_schema.model_properties or {}
        base_model_schema_parameters_rules = base_model_schema.parameter_rules or []

        entity = AIModelEntity(
            model=model,
            label=I18nObject(zh_Hans=model, en_US=model),
            model_type=ModelType.LLM,
            features=list(base_model_schema_features),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties=dict(base_model_schema_model_properties.items()),
            parameter_rules=list(base_model_schema_parameters_rules),
            pricing=base_model_schema.pricing,
        )

        return entity

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
            InvokeConnectionError: [cohere.errors.service_unavailable_error.ServiceUnavailableError],
            InvokeServerUnavailableError: [cohere.errors.internal_server_error.InternalServerError],
            InvokeRateLimitError: [cohere.errors.too_many_requests_error.TooManyRequestsError],
            InvokeAuthorizationError: [
                cohere.errors.unauthorized_error.UnauthorizedError,
                cohere.errors.forbidden_error.ForbiddenError,
            ],
            InvokeBadRequestError: [
                cohere.core.api_error.ApiError,
                cohere.errors.bad_request_error.BadRequestError,
                cohere.errors.not_found_error.NotFoundError,
            ],
        }
