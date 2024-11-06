import json
import logging
import re
from collections.abc import Generator, Iterator
from typing import Any, Optional, Union, cast

import boto3

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContent,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
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

logger = logging.getLogger(__name__)


def inference(predictor, messages: list[dict[str, Any]], params: dict[str, Any], stop: list, stream=False):
    """
    params:
    predictor : Sagemaker Predictor
    messages (List[Dict[str,Any]]): message list。
                messages = [
                {"role": "system", "content":"please answer in Chinese"},
                {"role": "user", "content": "who are you? what are you doing?"},
            ]
    params (Dict[str,Any]): model parameters for LLM。
    stream (bool): False by default。

    response:
    result of inference if stream is False
    Iterator of Chunks if stream is True
    """
    payload = {
        "model": params.get("model_name"),
        "stop": stop,
        "messages": messages,
        "stream": stream,
        "max_tokens": params.get("max_new_tokens", params.get("max_tokens", 2048)),
        "temperature": params.get("temperature", 0.1),
        "top_p": params.get("top_p", 0.9),
    }

    if not stream:
        response = predictor.predict(payload)
        return response
    else:
        response_stream = predictor.predict_stream(payload)
        return response_stream


class SageMakerLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Cohere large language model.
    """

    sagemaker_session: Any = None
    predictor: Any = None
    sagemaker_endpoint: str = None

    def _handle_chat_generate_response(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool],
        resp: bytes,
    ) -> LLMResult:
        """
        handle normal chat generate response
        """
        resp_obj = json.loads(resp.decode("utf-8"))
        resp_str = resp_obj.get("choices")[0].get("message").get("content")

        if len(resp_str) == 0:
            raise InvokeServerUnavailableError("Empty response")

        assistant_prompt_message = AssistantPromptMessage(content=resp_str, tool_calls=[])

        prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
        completion_tokens = self._num_tokens_from_messages(messages=[assistant_prompt_message], tools=tools)

        usage = self._calc_response_usage(
            model=model, credentials=credentials, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            system_fingerprint=None,
            usage=usage,
            message=assistant_prompt_message,
        )

        return response

    def _handle_chat_stream_response(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool],
        resp: Iterator[bytes],
    ) -> Generator:
        """
        handle stream chat generate response
        """
        full_response = ""
        buffer = ""
        for chunk_bytes in resp:
            buffer += chunk_bytes.decode("utf-8")
            last_idx = 0
            for match in re.finditer(r"^data:\s*(.+?)(\n\n)", buffer):
                try:
                    data = json.loads(match.group(1).strip())
                    last_idx = match.span()[1]

                    if "content" in data["choices"][0]["delta"]:
                        chunk_content = data["choices"][0]["delta"]["content"]
                        assistant_prompt_message = AssistantPromptMessage(content=chunk_content, tool_calls=[])

                        if data["choices"][0]["finish_reason"] is not None:
                            temp_assistant_prompt_message = AssistantPromptMessage(content=full_response, tool_calls=[])
                            prompt_tokens = self._num_tokens_from_messages(messages=prompt_messages, tools=tools)
                            completion_tokens = self._num_tokens_from_messages(
                                messages=[temp_assistant_prompt_message], tools=[]
                            )
                            usage = self._calc_response_usage(
                                model=model,
                                credentials=credentials,
                                prompt_tokens=prompt_tokens,
                                completion_tokens=completion_tokens,
                            )

                            yield LLMResultChunk(
                                model=model,
                                prompt_messages=prompt_messages,
                                system_fingerprint=None,
                                delta=LLMResultChunkDelta(
                                    index=0,
                                    message=assistant_prompt_message,
                                    finish_reason=data["choices"][0]["finish_reason"],
                                    usage=usage,
                                ),
                            )
                        else:
                            yield LLMResultChunk(
                                model=model,
                                prompt_messages=prompt_messages,
                                system_fingerprint=None,
                                delta=LLMResultChunkDelta(index=0, message=assistant_prompt_message),
                            )

                            full_response += chunk_content
                except (json.JSONDecodeError, KeyError, IndexError) as e:
                    logger.info("json parse exception, content: {}".format(match.group(1).strip()))
                    pass

            buffer = buffer[last_idx:]

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
        from sagemaker import Predictor, serializers
        from sagemaker.session import Session

        if not self.sagemaker_session:
            access_key = credentials.get("aws_access_key_id")
            secret_key = credentials.get("aws_secret_access_key")
            aws_region = credentials.get("aws_region")
            boto_session = None
            if aws_region:
                if access_key and secret_key:
                    boto_session = boto3.Session(
                        aws_access_key_id=access_key, aws_secret_access_key=secret_key, region_name=aws_region
                    )
                else:
                    boto_session = boto3.Session(region_name=aws_region)
            else:
                boto_session = boto3.Session()

            sagemaker_client = boto_session.client("sagemaker")
            self.sagemaker_session = Session(boto_session=boto_session, sagemaker_client=sagemaker_client)

        if self.sagemaker_endpoint != credentials.get("sagemaker_endpoint"):
            self.sagemaker_endpoint = credentials.get("sagemaker_endpoint")
            self.predictor = Predictor(
                endpoint_name=self.sagemaker_endpoint,
                sagemaker_session=self.sagemaker_session,
                serializer=serializers.JSONSerializer(),
            )

        messages: list[dict[str, Any]] = [{"role": p.role.value, "content": p.content} for p in prompt_messages]
        response = inference(
            predictor=self.predictor, messages=messages, params=model_parameters, stop=stop, stream=stream
        )

        if stream:
            if tools and len(tools) > 0:
                raise InvokeBadRequestError(f"{model}'s tool calls does not support stream mode")

            return self._handle_chat_stream_response(
                model=model, credentials=credentials, prompt_messages=prompt_messages, tools=tools, resp=response
            )
        return self._handle_chat_generate_response(
            model=model, credentials=credentials, prompt_messages=prompt_messages, tools=tools, resp=response
        )

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for OpenAI Compatibility API
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
            if message.tool_calls and len(message.tool_calls) > 0:
                message_dict["function_call"] = {
                    "name": message.tool_calls[0].function.name,
                    "arguments": message.tool_calls[0].function.arguments,
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

    def _num_tokens_from_messages(
        self, messages: list[PromptMessage], tools: list[PromptMessageTool], is_completion_model: bool = False
    ) -> int:
        def tokens(text: str):
            return self._get_num_tokens_by_gpt2(text)

        if is_completion_model:
            return sum(tokens(str(message.content)) for message in messages)

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
        try:
            return self._num_tokens_from_messages(prompt_messages, tools)
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
            pass
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

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
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError, KeyError, ValueError],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        used to define customizable model schema
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
                name="max_tokens",
                type=ParameterType.INT,
                use_template="max_tokens",
                min=1,
                max=credentials.get("context_length", 2048),
                default=512,
                label=I18nObject(zh_Hans="最大生成长度", en_US="Max Tokens"),
            ),
        ]

        completion_type = LLMMode.value_of(credentials["mode"]).value

        features = []

        support_function_call = credentials.get("support_function_call", False)
        if support_function_call:
            features.append(ModelFeature.TOOL_CALL)

        support_vision = credentials.get("support_vision", False)
        if support_vision:
            features.append(ModelFeature.VISION)

        context_length = credentials.get("context_length", 2048)

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            features=features,
            model_properties={ModelPropertyKey.MODE: completion_type, ModelPropertyKey.CONTEXT_SIZE: context_length},
            parameter_rules=rules,
        )

        return entity
