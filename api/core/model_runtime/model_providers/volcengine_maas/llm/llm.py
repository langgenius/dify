import logging
from collections.abc import Generator

from volcenginesdkarkruntime.types.chat import ChatCompletion, ChatCompletionChunk

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
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
from core.model_runtime.model_providers.volcengine_maas.client import ArkClientV3
from core.model_runtime.model_providers.volcengine_maas.legacy.client import MaaSClient
from core.model_runtime.model_providers.volcengine_maas.legacy.errors import (
    AuthErrors,
    BadRequestErrors,
    ConnectionErrors,
    MaasException,
    RateLimitErrors,
    ServerUnavailableErrors,
)
from core.model_runtime.model_providers.volcengine_maas.llm.models import (
    get_model_config,
    get_v2_req_params,
    get_v3_req_params,
)

logger = logging.getLogger(__name__)


class VolcengineMaaSLargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                model_parameters: dict, tools: list[PromptMessageTool] | None = None,
                stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
        if ArkClientV3.is_legacy(credentials):
            return self._generate_v2(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)
        return self._generate_v3(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials
        """
        if ArkClientV3.is_legacy(credentials):
            return self._validate_credentials_v2(credentials)
        return self._validate_credentials_v3(credentials)

    @staticmethod
    def _validate_credentials_v2(credentials: dict) -> None:
        client = MaaSClient.from_credential(credentials)
        try:
            client.chat(
                {
                    'max_new_tokens': 16,
                    'temperature': 0.7,
                    'top_p': 0.9,
                    'top_k': 15,
                },
                [UserPromptMessage(content='ping\nAnswer: ')],
            )
        except MaasException as e:
            raise CredentialsValidateFailedError(e.message)

    @staticmethod
    def _validate_credentials_v3(credentials: dict) -> None:
        client = ArkClientV3.from_credentials(credentials)
        try:
            client.chat(max_tokens=16, temperature=0.7, top_p=0.9,
                        messages=[UserPromptMessage(content='ping\nAnswer: ')], )
        except Exception as e:
            raise CredentialsValidateFailedError(e)

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: list[PromptMessageTool] | None = None) -> int:
        if ArkClientV3.is_legacy(credentials):
            return self._get_num_tokens_v2(prompt_messages)
        return self._get_num_tokens_v3(prompt_messages)

    def _get_num_tokens_v2(self, messages: list[PromptMessage]) -> int:
        if len(messages) == 0:
            return 0
        num_tokens = 0
        messages_dict = [
            MaaSClient.convert_prompt_message_to_maas_message(m) for m in messages]
        for message in messages_dict:
            for key, value in message.items():
                num_tokens += self._get_num_tokens_by_gpt2(str(key))
                num_tokens += self._get_num_tokens_by_gpt2(str(value))

        return num_tokens

    def _get_num_tokens_v3(self, messages: list[PromptMessage]) -> int:
        if len(messages) == 0:
            return 0
        num_tokens = 0
        messages_dict = [
            ArkClientV3.convert_prompt_message(m) for m in messages]
        for message in messages_dict:
            for key, value in message.items():
                num_tokens += self._get_num_tokens_by_gpt2(str(key))
                num_tokens += self._get_num_tokens_by_gpt2(str(value))

        return num_tokens

    def _generate_v2(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                     model_parameters: dict, tools: list[PromptMessageTool] | None = None,
                     stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:

        client = MaaSClient.from_credential(credentials)
        req_params = get_v2_req_params(credentials, model_parameters, stop)
        extra_model_kwargs = {}
        if tools:
            extra_model_kwargs['tools'] = [
                MaaSClient.transform_tool_prompt_to_maas_config(tool) for tool in tools
            ]
        resp = MaaSClient.wrap_exception(
            lambda: client.chat(req_params, prompt_messages, stream, **extra_model_kwargs))

        def _handle_stream_chat_response() -> Generator:
            for index, r in enumerate(resp):
                choices = r['choices']
                if not choices:
                    continue
                choice = choices[0]
                message = choice['message']
                usage = None
                if r.get('usage'):
                    usage = self._calc_response_usage(model=model, credentials=credentials,
                                                      prompt_tokens=r['usage']['prompt_tokens'],
                                                      completion_tokens=r['usage']['completion_tokens']
                                                      )
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=AssistantPromptMessage(
                            content=message['content'] if message['content'] else '',
                            tool_calls=[]
                        ),
                        usage=usage,
                        finish_reason=choice.get('finish_reason'),
                    ),
                )

        def _handle_chat_response() -> LLMResult:
            choices = resp['choices']
            if not choices:
                raise ValueError("No choices found")

            choice = choices[0]
            message = choice['message']

            # parse tool calls
            tool_calls = []
            if message['tool_calls']:
                for call in message['tool_calls']:
                    tool_call = AssistantPromptMessage.ToolCall(
                        id=call['function']['name'],
                        type=call['type'],
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=call['function']['name'],
                            arguments=call['function']['arguments']
                        )
                    )
                    tool_calls.append(tool_call)

            usage = resp['usage']
            return LLMResult(
                model=model,
                prompt_messages=prompt_messages,
                message=AssistantPromptMessage(
                    content=message['content'] if message['content'] else '',
                    tool_calls=tool_calls,
                ),
                usage=self._calc_response_usage(model=model, credentials=credentials,
                                                prompt_tokens=usage['prompt_tokens'],
                                                completion_tokens=usage['completion_tokens']
                                                ),
            )

        if not stream:
            return _handle_chat_response()
        return _handle_stream_chat_response()

    def _generate_v3(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                     model_parameters: dict, tools: list[PromptMessageTool] | None = None,
                     stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:

        client = ArkClientV3.from_credentials(credentials)
        req_params = get_v3_req_params(credentials, model_parameters, stop)
        if tools:
            req_params['tools'] = tools

        def _handle_stream_chat_response(chunks: Generator[ChatCompletionChunk]) -> Generator:
            for chunk in chunks:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=choice.index,
                        message=AssistantPromptMessage(
                            content=choice.delta.content,
                            tool_calls=[]
                        ),
                        usage=self._calc_response_usage(model=model, credentials=credentials,
                                                        prompt_tokens=chunk.usage.prompt_tokens,
                                                        completion_tokens=chunk.usage.completion_tokens
                                                        ) if chunk.usage else None,
                        finish_reason=choice.finish_reason,
                    ),
                )

        def _handle_chat_response(resp: ChatCompletion) -> LLMResult:
            choice = resp.choices[0]
            message = choice.message
            # parse tool calls
            tool_calls = []
            if message.tool_calls:
                for call in message.tool_calls:
                    tool_call = AssistantPromptMessage.ToolCall(
                        id=call.id,
                        type=call.type,
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=call.function.name,
                            arguments=call.function.arguments
                        )
                    )
                    tool_calls.append(tool_call)

            usage = resp.usage
            return LLMResult(
                model=model,
                prompt_messages=prompt_messages,
                message=AssistantPromptMessage(
                    content=message.content if message.content else "",
                    tool_calls=tool_calls,
                ),
                usage=self._calc_response_usage(model=model, credentials=credentials,
                                                prompt_tokens=usage.prompt_tokens,
                                                completion_tokens=usage.completion_tokens
                                                ),
            )

        if not stream:
            resp = client.chat(prompt_messages, **req_params)
            return _handle_chat_response(resp)

        chunks = client.stream_chat(prompt_messages, **req_params)
        return _handle_stream_chat_response(chunks)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        model_config = get_model_config(credentials)

        rules = [
            ParameterRule(
                name='temperature',
                type=ParameterType.FLOAT,
                use_template='temperature',
                label=I18nObject(
                    zh_Hans='温度',
                    en_US='Temperature'
                )
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
                name='top_k',
                type=ParameterType.INT,
                min=1,
                default=1,
                label=I18nObject(
                    zh_Hans='Top K',
                    en_US='Top K'
                )
            ),
            ParameterRule(
                name='presence_penalty',
                type=ParameterType.FLOAT,
                use_template='presence_penalty',
                label=I18nObject(
                    en_US='Presence Penalty',
                    zh_Hans='存在惩罚',
                ),
                min=-2.0,
                max=2.0,
            ),
            ParameterRule(
                name='frequency_penalty',
                type=ParameterType.FLOAT,
                use_template='frequency_penalty',
                label=I18nObject(
                    en_US='Frequency Penalty',
                    zh_Hans='频率惩罚',
                ),
                min=-2.0,
                max=2.0,
            ),
            ParameterRule(
                name='max_tokens',
                type=ParameterType.INT,
                use_template='max_tokens',
                min=1,
                max=model_config.properties.max_tokens,
                default=512,
                label=I18nObject(
                    zh_Hans='最大生成长度',
                    en_US='Max Tokens'
                )
            ),
        ]

        model_properties = {}
        model_properties[ModelPropertyKey.CONTEXT_SIZE] = model_config.properties.context_size
        model_properties[ModelPropertyKey.MODE] = model_config.properties.mode.value

        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties=model_properties,
            parameter_rules=rules,
            features=model_config.features,
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
            InvokeConnectionError: ConnectionErrors.values(),
            InvokeServerUnavailableError: ServerUnavailableErrors.values(),
            InvokeRateLimitError: RateLimitErrors.values(),
            InvokeAuthorizationError: AuthErrors.values(),
            InvokeBadRequestError: BadRequestErrors.values(),
        }
