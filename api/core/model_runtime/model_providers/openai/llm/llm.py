import json
import logging
from collections.abc import Generator
from typing import Optional, Union, cast

import tiktoken
from openai import OpenAI, Stream
from openai.types import Completion
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_chunk import ChoiceDeltaFunctionCall, ChoiceDeltaToolCall
from openai.types.chat.chat_completion_message import FunctionCall

from core.model_runtime.callbacks.base_callback import Callback
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
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, I18nObject, ModelType, PriceConfig
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.openai._common import _CommonOpenAI

logger = logging.getLogger(__name__)

OPENAI_BLOCK_MODE_PROMPT = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>
"""  # noqa: E501


class OpenAILargeLanguageModel(_CommonOpenAI, LargeLanguageModel):
    """
    Model class for OpenAI large language model.
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
        # handle fine tune remote models
        base_model = model
        if model.startswith("ft:"):
            base_model = model.split(":")[1]

        # get model mode
        model_mode = self.get_model_mode(base_model, credentials)

        if model_mode == LLMMode.CHAT:
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

    def _code_block_mode_wrapper(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: list[Callback] = None,
    ) -> Union[LLMResult, Generator]:
        """
        Code block mode wrapper for invoking large language model
        """
        # handle fine tune remote models
        base_model = model
        if model.startswith("ft:"):
            base_model = model.split(":")[1]

        # get model mode
        model_mode = self.get_model_mode(base_model, credentials)

        # transform response format
        if "response_format" in model_parameters and model_parameters["response_format"] in ["JSON", "XML"]:
            stop = stop or []
            if model_mode == LLMMode.CHAT:
                # chat model
                self._transform_chat_json_prompts(
                    model=base_model,
                    credentials=credentials,
                    prompt_messages=prompt_messages,
                    model_parameters=model_parameters,
                    tools=tools,
                    stop=stop,
                    stream=stream,
                    user=user,
                    response_format=model_parameters["response_format"],
                )
            else:
                self._transform_completion_json_prompts(
                    model=base_model,
                    credentials=credentials,
                    prompt_messages=prompt_messages,
                    model_parameters=model_parameters,
                    tools=tools,
                    stop=stop,
                    stream=stream,
                    user=user,
                    response_format=model_parameters["response_format"],
                )
            model_parameters.pop("response_format")

        return self._invoke(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

    def _transform_chat_json_prompts(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        response_format: str = "JSON",
    ) -> None:
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
                content=OPENAI_BLOCK_MODE_PROMPT.replace("{{instructions}}", prompt_messages[0].content).replace(
                    "{{block}}", response_format
                )
            )
            prompt_messages.append(AssistantPromptMessage(content=f"\n```{response_format}\n"))
        else:
            # insert the system message
            prompt_messages.insert(
                0,
                SystemPromptMessage(
                    content=OPENAI_BLOCK_MODE_PROMPT.replace(
                        "{{instructions}}", f"Please output a valid {response_format} object."
                    ).replace("{{block}}", response_format)
                ),
            )
            prompt_messages.append(AssistantPromptMessage(content=f"\n```{response_format}"))

    def _transform_completion_json_prompts(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        response_format: str = "JSON",
    ) -> None:
        """
        Transform json prompts
        """
        if "```\n" not in stop:
            stop.append("```\n")
        if "\n```" not in stop:
            stop.append("\n```")

        # override the last user message
        user_message = None
        for i in range(len(prompt_messages) - 1, -1, -1):
            if isinstance(prompt_messages[i], UserPromptMessage):
                user_message = prompt_messages[i]
                break

        if user_message:
            if prompt_messages[i].content[-11:] == "Assistant: ":
                # now we are in the chat app, remove the last assistant message
                prompt_messages[i].content = prompt_messages[i].content[:-11]
                prompt_messages[i] = UserPromptMessage(
                    content=OPENAI_BLOCK_MODE_PROMPT.replace("{{instructions}}", user_message.content).replace(
                        "{{block}}", response_format
                    )
                )
                prompt_messages[i].content += f"Assistant:\n```{response_format}\n"
            else:
                prompt_messages[i] = UserPromptMessage(
                    content=OPENAI_BLOCK_MODE_PROMPT.replace("{{instructions}}", user_message.content).replace(
                        "{{block}}", response_format
                    )
                )
                prompt_messages[i].content += f"\n```{response_format}\n"

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
        # handle fine tune remote models
        if model.startswith("ft:"):
            base_model = model.split(":")[1]
        else:
            base_model = model

        # get model mode
        model_mode = self.get_model_mode(model)

        if model_mode == LLMMode.CHAT:
            # chat model
            return self._num_tokens_from_messages(base_model, prompt_messages, tools)
        else:
            # text completion model, do not support tool calling
            return self._num_tokens_from_string(base_model, prompt_messages[0].content)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # transform credentials to kwargs for model instance
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)

            # handle fine tune remote models
            base_model = model
            # fine-tuned model name likes ft:gpt-3.5-turbo-0613:personal::xxxxx
            if model.startswith("ft:"):
                base_model = model.split(":")[1]

                # check if model exists
                remote_models = self.remote_models(credentials)
                remote_model_map = {model.model: model for model in remote_models}
                if model not in remote_model_map:
                    raise CredentialsValidateFailedError(f"Fine-tuned model {model} not found")

            # get model mode
            model_mode = self.get_model_mode(base_model, credentials)

            if model_mode == LLMMode.CHAT:
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

    def remote_models(self, credentials: dict) -> list[AIModelEntity]:
        """
        Return remote models if credentials are provided.

        :param credentials: provider credentials
        :return:
        """
        # get predefined models
        predefined_models = self.predefined_models()
        predefined_models_map = {model.model: model for model in predefined_models}

        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)
        client = OpenAI(**credentials_kwargs)

        # get all remote models
        remote_models = client.models.list()

        fine_tune_models = [model for model in remote_models if model.id.startswith("ft:")]

        ai_model_entities = []
        for model in fine_tune_models:
            base_model = model.id.split(":")[1]

            base_model_schema = None
            for predefined_model_name, predefined_model in predefined_models_map.items():
                if predefined_model_name in base_model:
                    base_model_schema = predefined_model

            if not base_model_schema:
                continue

            ai_model_entity = AIModelEntity(
                model=model.id,
                label=I18nObject(zh_Hans=model.id, en_US=model.id),
                model_type=ModelType.LLM,
                features=base_model_schema.features,
                fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
                model_properties=base_model_schema.model_properties,
                parameter_rules=base_model_schema.parameter_rules,
                pricing=PriceConfig(input=0.003, output=0.006, unit=0.001, currency="USD"),
            )

            ai_model_entities.append(ai_model_entity)

        return ai_model_entities

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
        Invoke llm completion model

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

        # init model client
        client = OpenAI(**credentials_kwargs)

        extra_model_kwargs = {}

        if stop:
            extra_model_kwargs["stop"] = stop

        if user:
            extra_model_kwargs["user"] = user

        if stream:
            extra_model_kwargs["stream_options"] = {"include_usage": True}

        # text completion model
        response = client.completions.create(
            prompt=prompt_messages[0].content, model=model, stream=stream, **model_parameters, **extra_model_kwargs
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(
        self, model: str, credentials: dict, response: Completion, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm completion response

        :param model: model name
        :param credentials: model credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm result
        """
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
            prompt_tokens = self._num_tokens_from_string(model, prompt_messages[0].content)
            completion_tokens = self._num_tokens_from_string(model, assistant_text)

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
        """
        Handle llm completion stream response

        :param model: model name
        :param credentials: model credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        full_text = ""
        prompt_tokens = 0
        completion_tokens = 0

        final_chunk = LLMResultChunk(
            model=model,
            prompt_messages=prompt_messages,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=""),
            ),
        )

        for chunk in response:
            if len(chunk.choices) == 0:
                if chunk.usage:
                    # calculate num tokens
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.text is None or delta.text == ""):
                continue

            # transform assistant message to prompt message
            text = delta.text or ""
            assistant_prompt_message = AssistantPromptMessage(content=text)

            full_text += text

            if delta.finish_reason is not None:
                final_chunk = LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
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

        if not prompt_tokens:
            prompt_tokens = self._num_tokens_from_string(model, prompt_messages[0].content)

        if not completion_tokens:
            completion_tokens = self._num_tokens_from_string(model, full_text)

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        final_chunk.delta.usage = usage

        yield final_chunk

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
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # init model client
        client = OpenAI(**credentials_kwargs)

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
            # extra_model_kwargs['tools'] = [helper.dump_model(PromptMessageFunction(function=tool)) for tool in tools]
            extra_model_kwargs["functions"] = [
                {"name": tool.name, "description": tool.description, "parameters": tool.parameters} for tool in tools
            ]

        if stop:
            extra_model_kwargs["stop"] = stop

        if user:
            extra_model_kwargs["user"] = user

        if stream:
            extra_model_kwargs["stream_options"] = {"include_usage": True}

        # clear illegal prompt messages
        prompt_messages = self._clear_illegal_prompt_messages(model, prompt_messages)

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

    def _handle_chat_generate_response(
        self,
        model: str,
        credentials: dict,
        response: ChatCompletion,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
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
        assistant_message = response.choices[0].message
        # assistant_message_tool_calls = assistant_message.tool_calls
        assistant_message_function_call = assistant_message.function_call

        # extract tool calls from response
        # tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
        function_call = self._extract_response_function_call(assistant_message_function_call)
        tool_calls = [function_call] if function_call else []

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=assistant_message.content, tool_calls=tool_calls)

        # calculate num tokens
        if response.usage:
            # transform usage
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens
        else:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_messages(model, prompt_messages, tools)
            completion_tokens = self._num_tokens_from_messages(model, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        response = LLMResult(
            model=response.model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
            system_fingerprint=response.system_fingerprint,
        )

        return response

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        response: Stream[ChatCompletionChunk],
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> Generator:
        """
        Handle llm chat stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return: llm response chunk generator
        """
        full_assistant_content = ""
        delta_assistant_message_function_call_storage: ChoiceDeltaFunctionCall = None
        prompt_tokens = 0
        completion_tokens = 0
        final_tool_calls = []
        final_chunk = LLMResultChunk(
            model=model,
            prompt_messages=prompt_messages,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=""),
            ),
        )

        for chunk in response:
            if len(chunk.choices) == 0:
                if chunk.usage:
                    # calculate num tokens
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens
                continue

            delta = chunk.choices[0]
            has_finish_reason = delta.finish_reason is not None

            if (
                not has_finish_reason
                and (delta.delta.content is None or delta.delta.content == "")
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
                        delta_assistant_message_function_call_storage.arguments = ""
                    if not has_finish_reason:
                        continue

            # tool_calls = self._extract_response_tool_calls(assistant_message_tool_calls)
            function_call = self._extract_response_function_call(assistant_message_function_call)
            tool_calls = [function_call] if function_call else []
            if tool_calls:
                final_tool_calls.extend(tool_calls)

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(content=delta.delta.content or "", tool_calls=tool_calls)

            full_assistant_content += delta.delta.content or ""

            if has_finish_reason:
                final_chunk = LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=chunk.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
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

        if not prompt_tokens:
            prompt_tokens = self._num_tokens_from_messages(model, prompt_messages, tools)

        if not completion_tokens:
            full_assistant_prompt_message = AssistantPromptMessage(
                content=full_assistant_content, tool_calls=final_tool_calls
            )
            completion_tokens = self._num_tokens_from_messages(model, [full_assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)
        final_chunk.delta.usage = usage

        yield final_chunk

    def _extract_response_tool_calls(
        self, response_tool_calls: list[ChatCompletionMessageToolCall | ChoiceDeltaToolCall]
    ) -> list[AssistantPromptMessage.ToolCall]:
        """
        Extract tool calls from response

        :param response_tool_calls: response tool calls
        :return: list of tool calls
        """
        tool_calls = []
        if response_tool_calls:
            for response_tool_call in response_tool_calls:
                function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name=response_tool_call.function.name, arguments=response_tool_call.function.arguments
                )

                tool_call = AssistantPromptMessage.ToolCall(
                    id=response_tool_call.id, type=response_tool_call.type, function=function
                )
                tool_calls.append(tool_call)

        return tool_calls

    def _extract_response_function_call(
        self, response_function_call: FunctionCall | ChoiceDeltaFunctionCall
    ) -> AssistantPromptMessage.ToolCall:
        """
        Extract function call from response

        :param response_function_call: response function call
        :return: tool call
        """
        tool_call = None
        if response_function_call:
            function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                name=response_function_call.name, arguments=response_function_call.arguments
            )

            tool_call = AssistantPromptMessage.ToolCall(
                id=response_function_call.name, type="function", function=function
            )

        return tool_call

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

        return prompt_messages

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for OpenAI API
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
                # message_dict["tool_calls"] = [tool_call.dict() for tool_call in
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
            message_dict = {"role": "function", "content": message.content, "name": message.tool_call_id}
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name:
            message_dict["name"] = message.name

        return message_dict

    def _num_tokens_from_string(self, model: str, text: str, tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Calculate num tokens for text completion model with tiktoken package.

        :param model: model name
        :param text: prompt text
        :param tools: tools for tool calling
        :return: number of tokens
        """
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")

        num_tokens = len(encoding.encode(text))

        if tools:
            num_tokens += self._num_tokens_for_tools(encoding, tools)

        return num_tokens

    def _num_tokens_from_messages(
        self, model: str, messages: list[PromptMessage], tools: Optional[list[PromptMessageTool]] = None
    ) -> int:
        """Calculate num tokens for gpt-3.5-turbo and gpt-4 with tiktoken package.

        Official documentation: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb"""
        if model.startswith("ft:"):
            model = model.split(":")[1]

        # Currently, we can use gpt4o to calculate chatgpt-4o-latest's token.
        if model == "chatgpt-4o-latest":
            model = "gpt-4o"

        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            logger.warning("Warning: model not found. Using cl100k_base encoding.")
            model = "cl100k_base"
            encoding = tiktoken.get_encoding(model)

        if model.startswith("gpt-3.5-turbo-0301"):
            # every message follows <im_start>{role/name}\n{content}<im_end>\n
            tokens_per_message = 4
            # if there's a name, the role is omitted
            tokens_per_name = -1
        elif model.startswith("gpt-3.5-turbo") or model.startswith("gpt-4"):
            tokens_per_message = 3
            tokens_per_name = 1
        else:
            raise NotImplementedError(
                f"get_num_tokens_from_messages() is not presently implemented "
                f"for model {model}."
                "See https://platform.openai.com/docs/advanced-usage/managing-tokens for "
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

    def _num_tokens_for_tools(self, encoding: tiktoken.Encoding, tools: list[PromptMessageTool]) -> int:
        """
        Calculate num tokens for tool calling with tiktoken package.

        :param encoding: encoding
        :param tools: tools for tool calling
        :return: number of tokens
        """
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
                num_tokens += len(encoding.encode(parameters.get("title")))
            num_tokens += len(encoding.encode("type"))
            num_tokens += len(encoding.encode(parameters.get("type")))
            if "properties" in parameters:
                num_tokens += len(encoding.encode("properties"))
                for key, value in parameters.get("properties").items():
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

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
        OpenAI supports fine-tuning of their models. This method returns the schema of the base model
        but renamed to the fine-tuned model name.

        :param model: model name
        :param credentials: credentials

        :return: model schema
        """
        if not model.startswith("ft:"):
            base_model = model
        else:
            # get base_model
            base_model = model.split(":")[1]

        # get model schema
        models = self.predefined_models()
        model_map = {model.model: model for model in models}
        if base_model not in model_map:
            raise ValueError(f"Base model {base_model} not found")

        base_model_schema = model_map[base_model]

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
