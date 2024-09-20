import base64
import os
import tempfile
import uuid
from collections.abc import Generator
from http import HTTPStatus
from pathlib import Path
from typing import Optional, Union, cast

from dashscope import Generation, MultiModalConversation, get_tokenizer
from dashscope.api_entities.dashscope_response import GenerationResponse
from dashscope.common.error import (
    AuthenticationError,
    InvalidParameter,
    RequestFailure,
    ServiceUnavailableError,
    UnsupportedHTTPMethod,
    UnsupportedModel,
)

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
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
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    I18nObject,
    ModelFeature,
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


class TongyiLargeLanguageModel(LargeLanguageModel):
    tokenizers = {}

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
        # invoke model without code wrapper
        return self._generate(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

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
        if model in {"qwen-turbo-chat", "qwen-plus-chat"}:
            model = model.replace("-chat", "")
        if model == "farui-plus":
            model = "qwen-farui-plus"

        if model in self.tokenizers:
            tokenizer = self.tokenizers[model]
        else:
            tokenizer = get_tokenizer(model)
            self.tokenizers[model] = tokenizer

        # convert string to token ids
        tokens = tokenizer.encode(self._convert_messages_to_prompt(prompt_messages))

        return len(tokens)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._generate(
                model=model,
                credentials=credentials,
                prompt_messages=[
                    UserPromptMessage(content="ping"),
                ],
                model_parameters={
                    "temperature": 0.5,
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
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        mode = self.get_model_mode(model, credentials)

        if model in {"qwen-turbo-chat", "qwen-plus-chat"}:
            model = model.replace("-chat", "")

        extra_model_kwargs = {}
        if tools:
            extra_model_kwargs["tools"] = self._convert_tools(tools)

        if stop:
            extra_model_kwargs["stop"] = stop

        params = {
            "model": model,
            **model_parameters,
            **credentials_kwargs,
            **extra_model_kwargs,
        }

        model_schema = self.get_model_schema(model, credentials)
        if ModelFeature.VISION in (model_schema.features or []):
            params["messages"] = self._convert_prompt_messages_to_tongyi_messages(prompt_messages, rich_content=True)

            response = MultiModalConversation.call(**params, stream=stream)
        else:
            # nothing different between chat model and completion model in tongyi
            params["messages"] = self._convert_prompt_messages_to_tongyi_messages(prompt_messages)
            response = Generation.call(**params, result_format="message", stream=stream)

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(
        self, model: str, credentials: dict, response: GenerationResponse, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        if response.status_code not in {200, HTTPStatus.OK}:
            raise ServiceUnavailableError(response.message)
        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=response.output.choices[0].message.content,
        )

        # transform usage
        usage = self._calc_response_usage(model, credentials, response.usage.input_tokens, response.usage.output_tokens)

        # transform response
        result = LLMResult(
            model=model,
            message=assistant_prompt_message,
            prompt_messages=prompt_messages,
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        responses: Generator[GenerationResponse, None, None],
        prompt_messages: list[PromptMessage],
    ) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: credentials
        :param responses: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        full_text = ""
        tool_calls = []
        for index, response in enumerate(responses):
            if response.status_code not in {200, HTTPStatus.OK}:
                raise ServiceUnavailableError(
                    f"Failed to invoke model {model}, status code: {response.status_code}, "
                    f"message: {response.message}"
                )

            resp_finish_reason = response.output.choices[0].finish_reason

            if resp_finish_reason is not None and resp_finish_reason != "null":
                resp_content = response.output.choices[0].message.content

                assistant_prompt_message = AssistantPromptMessage(
                    content="",
                )

                if "tool_calls" in response.output.choices[0].message:
                    tool_calls = response.output.choices[0].message["tool_calls"]
                elif resp_content:
                    # special for qwen-vl
                    if isinstance(resp_content, list):
                        resp_content = resp_content[0]["text"]

                    # transform assistant message to prompt message
                    assistant_prompt_message.content = resp_content.replace(full_text, "", 1)

                    full_text = resp_content

                if tool_calls:
                    message_tool_calls = []
                    for tool_call_obj in tool_calls:
                        message_tool_call = AssistantPromptMessage.ToolCall(
                            id=tool_call_obj["function"]["name"],
                            type="function",
                            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                name=tool_call_obj["function"]["name"], arguments=tool_call_obj["function"]["arguments"]
                            ),
                        )
                        message_tool_calls.append(message_tool_call)

                    assistant_prompt_message.tool_calls = message_tool_calls

                # transform usage
                usage = response.usage
                usage = self._calc_response_usage(model, credentials, usage.input_tokens, usage.output_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index, message=assistant_prompt_message, finish_reason=resp_finish_reason, usage=usage
                    ),
                )
            else:
                resp_content = response.output.choices[0].message.content
                if not resp_content:
                    if "tool_calls" in response.output.choices[0].message:
                        tool_calls = response.output.choices[0].message["tool_calls"]
                    continue

                # special for qwen-vl
                if isinstance(resp_content, list):
                    resp_content = resp_content[0]["text"]

                # transform assistant message to prompt message
                assistant_prompt_message = AssistantPromptMessage(
                    content=resp_content.replace(full_text, "", 1),
                )

                full_text = resp_content

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(index=index, message=assistant_prompt_message),
                )

    def _to_credential_kwargs(self, credentials: dict) -> dict:
        """
        Transform credentials to kwargs for model instance

        :param credentials:
        :return:
        """
        credentials_kwargs = {
            "api_key": credentials["dashscope_api_key"],
        }

        return credentials_kwargs

    def _convert_one_message_to_text(self, message: PromptMessage) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
        human_prompt = "\n\nHuman:"
        ai_prompt = "\n\nAssistant:"
        content = message.content

        if isinstance(message, UserPromptMessage):
            if isinstance(content, str):
                message_text = f"{human_prompt} {content}"
            else:
                message_text = ""
                for sub_message in content:
                    if sub_message.type == PromptMessageContentType.TEXT:
                        message_text = f"{human_prompt} {sub_message.data}"
                        break
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage | ToolPromptMessage):
            message_text = content
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text

    def _convert_messages_to_prompt(self, messages: list[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Anthropic model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(self._convert_one_message_to_text(message) for message in messages)

        # trim off the trailing ' ' that might come from the "Assistant: "
        return text.rstrip()

    def _convert_prompt_messages_to_tongyi_messages(
        self, prompt_messages: list[PromptMessage], rich_content: bool = False
    ) -> list[dict]:
        """
        Convert prompt messages to tongyi messages

        :param prompt_messages: prompt messages
        :return: tongyi messages
        """
        tongyi_messages = []
        for prompt_message in prompt_messages:
            if isinstance(prompt_message, SystemPromptMessage):
                tongyi_messages.append(
                    {
                        "role": "system",
                        "content": prompt_message.content if not rich_content else [{"text": prompt_message.content}],
                    }
                )
            elif isinstance(prompt_message, UserPromptMessage):
                if isinstance(prompt_message.content, str):
                    tongyi_messages.append(
                        {
                            "role": "user",
                            "content": prompt_message.content
                            if not rich_content
                            else [{"text": prompt_message.content}],
                        }
                    )
                else:
                    sub_messages = []
                    for message_content in prompt_message.content:
                        if message_content.type == PromptMessageContentType.TEXT:
                            message_content = cast(TextPromptMessageContent, message_content)
                            sub_message_dict = {"text": message_content.data}
                            sub_messages.append(sub_message_dict)
                        elif message_content.type == PromptMessageContentType.IMAGE:
                            message_content = cast(ImagePromptMessageContent, message_content)

                            image_url = message_content.data
                            if message_content.data.startswith("data:"):
                                # convert image base64 data to file in /tmp
                                image_url = self._save_base64_image_to_file(message_content.data)

                            sub_message_dict = {"image": image_url}
                            sub_messages.append(sub_message_dict)

                    # resort sub_messages to ensure text is always at last
                    sub_messages = sorted(sub_messages, key=lambda x: "text" in x)

                    tongyi_messages.append({"role": "user", "content": sub_messages})
            elif isinstance(prompt_message, AssistantPromptMessage):
                content = prompt_message.content
                if not content:
                    content = " "
                message = {"role": "assistant", "content": content if not rich_content else [{"text": content}]}
                if prompt_message.tool_calls:
                    message["tool_calls"] = [tool_call.model_dump() for tool_call in prompt_message.tool_calls]
                tongyi_messages.append(message)
            elif isinstance(prompt_message, ToolPromptMessage):
                tongyi_messages.append(
                    {"role": "tool", "content": prompt_message.content, "name": prompt_message.tool_call_id}
                )
            else:
                raise ValueError(f"Got unknown type {prompt_message}")

        return tongyi_messages

    def _save_base64_image_to_file(self, base64_image: str) -> str:
        """
        Save base64 image to file
        'data:{upload_file.mime_type};base64,{encoded_string}'

        :param base64_image: base64 image data
        :return: image file path
        """
        # get mime type and encoded string
        mime_type, encoded_string = base64_image.split(",")[0].split(";")[0].split(":")[1], base64_image.split(",")[1]

        # save image to file
        temp_dir = tempfile.gettempdir()

        file_path = os.path.join(temp_dir, f"{uuid.uuid4()}.{mime_type.split('/')[1]}")

        Path(file_path).write_bytes(base64.b64decode(encoded_string))

        return f"file://{file_path}"

    def _convert_tools(self, tools: list[PromptMessageTool]) -> list[dict]:
        """
        Convert tools
        """
        tool_definitions = []
        for tool in tools:
            properties = tool.parameters["properties"]
            required_properties = tool.parameters["required"]

            properties_definitions = {}
            for p_key, p_val in properties.items():
                desc = p_val["description"]
                if "enum" in p_val:
                    desc += f"; Only accepts one of the following predefined options: [{', '.join(p_val['enum'])}]"

                properties_definitions[p_key] = {
                    "description": desc,
                    "type": p_val["type"],
                }

            tool_definition = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": properties_definitions,
                    "required": required_properties,
                },
            }

            tool_definitions.append(tool_definition)

        return tool_definitions

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
                RequestFailure,
            ],
            InvokeServerUnavailableError: [
                ServiceUnavailableError,
            ],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [
                AuthenticationError,
            ],
            InvokeBadRequestError: [
                InvalidParameter,
                UnsupportedModel,
                UnsupportedHTTPMethod,
            ],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
        Architecture for defining customizable models

        :param model: model name
        :param credentials: model credentials
        :return: AIModelEntity or None
        """
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
                name="top_k",
                type=ParameterType.INT,
                min=0,
                max=99,
                label=I18nObject(zh_Hans="top_k", en_US="top_k"),
            ),
            ParameterRule(
                name="max_tokens",
                type=ParameterType.INT,
                min=1,
                max=128000,
                default=1024,
                label=I18nObject(zh_Hans="最大生成长度", en_US="Max Tokens"),
            ),
            ParameterRule(
                name="seed",
                type=ParameterType.INT,
                default=1234,
                label=I18nObject(zh_Hans="随机种子", en_US="Random Seed"),
            ),
            ParameterRule(
                name="repetition_penalty",
                type=ParameterType.FLOAT,
                default=1.1,
                label=I18nObject(zh_Hans="重复惩罚", en_US="Repetition Penalty"),
            ),
        ]

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties={},
            parameter_rules=rules,
        )

        return entity
