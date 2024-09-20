from collections.abc import Generator
from typing import Optional, Union, cast

from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.errors.invoke import (
    InvokeError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.wenxin._common import BaiduAccessToken
from core.model_runtime.model_providers.wenxin.llm.ernie_bot import ErnieBotModel, ErnieMessage
from core.model_runtime.model_providers.wenxin.wenxin_errors import invoke_error_mapping

ERNIE_BOT_BLOCK_MODE_PROMPT = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>

You should also complete the text started with ``` but not tell ``` directly.
"""  # noqa: E501


class ErnieBotLargeLanguageModel(LargeLanguageModel):
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
        if "response_format" in model_parameters and model_parameters["response_format"] in {"JSON", "XML"}:
            response_format = model_parameters["response_format"]
            stop = stop or []
            self._transform_json_prompts(
                model, credentials, prompt_messages, model_parameters, tools, stop, stream, user, response_format
            )
            model_parameters.pop("response_format")
            if stream:
                return self._code_block_mode_stream_processor(
                    model=model,
                    prompt_messages=prompt_messages,
                    input_generator=self._invoke(
                        model=model,
                        credentials=credentials,
                        prompt_messages=prompt_messages,
                        model_parameters=model_parameters,
                        tools=tools,
                        stop=stop,
                        stream=stream,
                        user=user,
                    ),
                )

        return self._invoke(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def _transform_json_prompts(
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
        Transform json prompts to model prompts
        """

        # check if there is a system message
        if len(prompt_messages) > 0 and isinstance(prompt_messages[0], SystemPromptMessage):
            # override the system message
            prompt_messages[0] = SystemPromptMessage(
                content=ERNIE_BOT_BLOCK_MODE_PROMPT.replace("{{instructions}}", prompt_messages[0].content).replace(
                    "{{block}}", response_format
                )
            )
        else:
            # insert the system message
            prompt_messages.insert(
                0,
                SystemPromptMessage(
                    content=ERNIE_BOT_BLOCK_MODE_PROMPT.replace(
                        "{{instructions}}", f"Please output a valid {response_format} object."
                    ).replace("{{block}}", response_format)
                ),
            )

        if len(prompt_messages) > 0 and isinstance(prompt_messages[-1], UserPromptMessage):
            # add ```JSON\n to the last message
            prompt_messages[-1].content += "\n```JSON\n{\n"
        else:
            # append a user message
            prompt_messages.append(UserPromptMessage(content="```JSON\n{\n"))

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        # tools is not supported yet
        return self._num_tokens_from_messages(prompt_messages)

    def _num_tokens_from_messages(
        self,
        messages: list[PromptMessage],
    ) -> int:
        """Calculate num tokens for baichuan model"""

        def tokens(text: str):
            return self._get_num_tokens_by_gpt2(text)

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

    def validate_credentials(self, model: str, credentials: dict) -> None:
        api_key = credentials["api_key"]
        secret_key = credentials["secret_key"]
        try:
            BaiduAccessToken.get_access_token(api_key, secret_key)
        except Exception as e:
            raise CredentialsValidateFailedError(f"Credentials validation failed: {e}")

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
        instance = ErnieBotModel(
            api_key=credentials["api_key"],
            secret_key=credentials["secret_key"],
        )

        user = user or "ErnieBotDefault"

        # convert prompt messages to baichuan messages
        messages = [
            ErnieMessage(
                content=message.content
                if isinstance(message.content, str)
                else "".join([content.data for content in message.content]),
                role=message.role.value,
            )
            for message in prompt_messages
        ]

        # invoke model
        response = instance.generate(
            model=model,
            stream=stream,
            messages=messages,
            parameters=model_parameters,
            timeout=60,
            tools=tools,
            stop=stop,
            user=user,
        )

        if stream:
            return self._handle_chat_generate_stream_response(model, prompt_messages, credentials, response)
        else:
            return self._handle_chat_generate_response(model, prompt_messages, credentials, response)

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
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        else:
            raise ValueError(f"Unknown message type {type(message)}")

        return message_dict

    def _handle_chat_generate_response(
        self, model: str, prompt_messages: list[PromptMessage], credentials: dict, response: ErnieMessage
    ) -> LLMResult:
        # convert baichuan message to llm result
        usage = self._calc_response_usage(
            model=model,
            credentials=credentials,
            prompt_tokens=response.usage["prompt_tokens"],
            completion_tokens=response.usage["completion_tokens"],
        )
        return LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content=response.content, tool_calls=[]),
            usage=usage,
        )

    def _handle_chat_generate_stream_response(
        self,
        model: str,
        prompt_messages: list[PromptMessage],
        credentials: dict,
        response: Generator[ErnieMessage, None, None],
    ) -> Generator:
        for message in response:
            if message.usage:
                usage = self._calc_response_usage(
                    model=model,
                    credentials=credentials,
                    prompt_tokens=message.usage["prompt_tokens"],
                    completion_tokens=message.usage["completion_tokens"],
                )
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=message.content, tool_calls=[]),
                        usage=usage,
                        finish_reason=message.stop_reason or None,
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=message.content, tool_calls=[]),
                        finish_reason=message.stop_reason or None,
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
        return invoke_error_mapping()
