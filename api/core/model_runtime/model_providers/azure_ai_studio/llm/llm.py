import logging
from collections.abc import Generator
from typing import Any, Optional, Union

from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import StreamingChatCompletionsUpdate
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import (
    ClientAuthenticationError,
    DecodeError,
    DeserializationError,
    HttpResponseError,
    ResourceExistsError,
    ResourceModifiedError,
    ResourceNotFoundError,
    ResourceNotModifiedError,
    SerializationError,
    ServiceRequestError,
    ServiceResponseError,
)

from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    I18nObject,
    ModelType,
    ParameterRule,
    ParameterType,
)
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

logger = logging.getLogger(__name__)


class AzureAIStudioLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Azure AI Studio large language model.
    """

    client: Any = None

    from azure.ai.inference.models import StreamingChatCompletionsUpdate

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

        if not self.client:
            endpoint = credentials.get("endpoint")
            api_key = credentials.get("api_key")
            self.client = ChatCompletionsClient(endpoint=endpoint, credential=AzureKeyCredential(api_key))

        messages = [{"role": msg.role.value, "content": msg.content} for msg in prompt_messages]

        payload = {
            "messages": messages,
            "max_tokens": model_parameters.get("max_tokens", 4096),
            "temperature": model_parameters.get("temperature", 0),
            "top_p": model_parameters.get("top_p", 1),
            "stream": stream,
        }

        if stop:
            payload["stop"] = stop

        if tools:
            payload["tools"] = [tool.model_dump() for tool in tools]

        try:
            response = self.client.complete(**payload)

            if stream:
                return self._handle_stream_response(response, model, prompt_messages)
            else:
                return self._handle_non_stream_response(response, model, prompt_messages, credentials)
        except Exception as e:
            raise self._transform_invoke_error(e)

    def _handle_stream_response(self, response, model: str, prompt_messages: list[PromptMessage]) -> Generator:
        for chunk in response:
            if isinstance(chunk, StreamingChatCompletionsUpdate):
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        yield LLMResultChunk(
                            model=model,
                            prompt_messages=prompt_messages,
                            delta=LLMResultChunkDelta(
                                index=0,
                                message=AssistantPromptMessage(content=delta.content, tool_calls=[]),
                            ),
                        )

    def _handle_non_stream_response(
        self, response, model: str, prompt_messages: list[PromptMessage], credentials: dict
    ) -> LLMResult:
        assistant_text = response.choices[0].message.content
        assistant_prompt_message = AssistantPromptMessage(content=assistant_text)
        usage = self._calc_response_usage(
            model, credentials, response.usage.prompt_tokens, response.usage.completion_tokens
        )
        result = LLMResult(model=model, prompt_messages=prompt_messages, message=assistant_prompt_message, usage=usage)

        if hasattr(response, "system_fingerprint"):
            result.system_fingerprint = response.system_fingerprint

        return result

    def _invoke_result_generator(
        self,
        model: str,
        result: Generator,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> Generator:
        """
        Invoke result generator

        :param result: result generator
        :return: result generator
        """
        callbacks = callbacks or []
        prompt_message = AssistantPromptMessage(content="")
        usage = None
        system_fingerprint = None
        real_model = model

        try:
            for chunk in result:
                if isinstance(chunk, dict):
                    content = chunk["choices"][0]["message"]["content"]
                    usage = chunk["usage"]
                    chunk = LLMResultChunk(
                        model=model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=0,
                            message=AssistantPromptMessage(content=content, tool_calls=[]),
                        ),
                        system_fingerprint=chunk.get("system_fingerprint"),
                    )

                yield chunk

                self._trigger_new_chunk_callbacks(
                    chunk=chunk,
                    model=model,
                    credentials=credentials,
                    prompt_messages=prompt_messages,
                    model_parameters=model_parameters,
                    tools=tools,
                    stop=stop,
                    stream=stream,
                    user=user,
                    callbacks=callbacks,
                )

                prompt_message.content += chunk.delta.message.content
                real_model = chunk.model
                if hasattr(chunk.delta, "usage"):
                    usage = chunk.delta.usage

                if chunk.system_fingerprint:
                    system_fingerprint = chunk.system_fingerprint
        except Exception as e:
            raise self._transform_invoke_error(e)

        self._trigger_after_invoke_callbacks(
            model=model,
            result=LLMResult(
                model=real_model,
                prompt_messages=prompt_messages,
                message=prompt_message,
                usage=usage if usage else LLMUsage.empty_usage(),
                system_fingerprint=system_fingerprint,
            ),
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
            callbacks=callbacks,
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
        # Implement token counting logic here
        # Might need to use a tokenizer specific to the Azure AI Studio model
        return 0

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            endpoint = credentials.get("endpoint")
            api_key = credentials.get("api_key")
            client = ChatCompletionsClient(endpoint=endpoint, credential=AzureKeyCredential(api_key))
            client.get_model_info()
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
            InvokeConnectionError: [
                ServiceRequestError,
            ],
            InvokeServerUnavailableError: [
                ServiceResponseError,
            ],
            InvokeAuthorizationError: [
                ClientAuthenticationError,
            ],
            InvokeBadRequestError: [
                HttpResponseError,
                DecodeError,
                ResourceExistsError,
                ResourceNotFoundError,
                ResourceModifiedError,
                ResourceNotModifiedError,
                SerializationError,
                DeserializationError,
            ],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
        Used to define customizable model schema
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
                default=512,
                label=I18nObject(zh_Hans="最大生成长度", en_US="Max Tokens"),
            ),
        ]

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            features=[],
            model_properties={},
            parameter_rules=rules,
        )

        return entity
