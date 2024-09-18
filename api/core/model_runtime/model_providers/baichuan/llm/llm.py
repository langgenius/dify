import json
from collections.abc import Generator, Iterator
from typing import cast

from core.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
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
from core.model_runtime.model_providers.baichuan.llm.baichuan_tokenizer import BaichuanTokenizer
from core.model_runtime.model_providers.baichuan.llm.baichuan_turbo import BaichuanModel
from core.model_runtime.model_providers.baichuan.llm.baichuan_turbo_errors import (
    BadRequestError,
    InsufficientAccountBalanceError,
    InternalServerError,
    InvalidAPIKeyError,
    InvalidAuthenticationError,
    RateLimitReachedError,
)


class BaichuanLanguageModel(LargeLanguageModel):
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
            stream=stream,
        )

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        return self._num_tokens_from_messages(prompt_messages)

    def _num_tokens_from_messages(
        self,
        messages: list[PromptMessage],
    ) -> int:
        """Calculate num tokens for baichuan model"""

        def tokens(text: str):
            return BaichuanTokenizer._get_num_tokens(text)

        tokens_per_message = 3

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

                num_tokens += tokens(str(value))
        num_tokens += 3

        return num_tokens

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for Baichuan
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
                message_dict["tool_calls"] = [tool_call.dict() for tool_call in message.tool_calls]
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = {"role": "tool", "content": message.content, "tool_call_id": message.tool_call_id}
        else:
            raise ValueError(f"Unknown message type {type(message)}")

        return message_dict

    def validate_credentials(self, model: str, credentials: dict) -> None:
        # ping
        instance = BaichuanModel(api_key=credentials["api_key"])

        try:
            instance.generate(
                model=model,
                stream=False,
                messages=[{"content": "ping", "role": "user"}],
                parameters={
                    "max_tokens": 1,
                },
                timeout=60,
            )
        except Exception as e:
            raise CredentialsValidateFailedError(f"Invalid API key: {e}")

    def _generate(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stream: bool = True,
    ) -> LLMResult | Generator:
        instance = BaichuanModel(api_key=credentials["api_key"])
        messages = [self._convert_prompt_message_to_dict(m) for m in prompt_messages]

        # invoke model
        response = instance.generate(
            model=model,
            stream=stream,
            messages=messages,
            parameters=model_parameters,
            timeout=60,
            tools=tools,
        )

        if stream:
            return self._handle_chat_generate_stream_response(model, prompt_messages, credentials, response)

        return self._handle_chat_generate_response(model, prompt_messages, credentials, response)

    def _handle_chat_generate_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: dict,
    ) -> LLMResult:
        choices = response.get("choices", [])
        assistant_message = AssistantPromptMessage(content="", tool_calls=[])
        if choices and choices[0]["finish_reason"] == "tool_calls":
            for choice in choices:
                for tool_call in choice["message"]["tool_calls"]:
                    tool = AssistantPromptMessage.ToolCall(
                        id=tool_call.get("id", ""),
                        type=tool_call.get("type", ""),
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=tool_call.get("function", {}).get("name", ""),
                            arguments=tool_call.get("function", {}).get("arguments", ""),
                        ),
                    )
                    assistant_message.tool_calls.append(tool)
        else:
            for choice in choices:
                assistant_message.content += choice["message"]["content"]
                assistant_message.role = choice["message"]["role"]

        usage = response.get("usage")
        if usage:
            # transform usage
            prompt_tokens = usage["prompt_tokens"]
            completion_tokens = usage["completion_tokens"]
        else:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_messages(prompt_messages)
            completion_tokens = self._num_tokens_from_messages([assistant_message])

        usage = self._calc_response_usage(
            model=model,
            credentials=credentials,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

        return LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_message,
            usage=usage,
        )

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: Iterator,
    ) -> Generator:
        for line in response:
            if not line:
                continue
            line = line.decode("utf-8")
            # remove the first `data: ` prefix
            if line.startswith("data:"):
                line = line[5:].strip()
            try:
                data = json.loads(line)
            except Exception as e:
                if line.strip() == "[DONE]":
                    return
            choices = data.get("choices", [])

            stop_reason = ""
            for choice in choices:
                if choice.get("finish_reason"):
                    stop_reason = choice["finish_reason"]

                if len(choice["delta"]["content"]) == 0:
                    continue
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=choice["delta"]["content"], tool_calls=[]),
                        finish_reason=stop_reason,
                    ),
                )

            # if there is usage, the response is the last one, yield it and return
            if "usage" in data:
                usage = self._calc_response_usage(
                    model=model,
                    credentials=credentials,
                    prompt_tokens=data["usage"]["prompt_tokens"],
                    completion_tokens=data["usage"]["completion_tokens"],
                )
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="", tool_calls=[]),
                        usage=usage,
                        finish_reason=stop_reason,
                    ),
                )

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
            InvokeConnectionError: [],
            InvokeServerUnavailableError: [InternalServerError],
            InvokeRateLimitError: [RateLimitReachedError],
            InvokeAuthorizationError: [
                InvalidAuthenticationError,
                InsufficientAccountBalanceError,
                InvalidAPIKeyError,
            ],
            InvokeBadRequestError: [BadRequestError, KeyError],
        }
