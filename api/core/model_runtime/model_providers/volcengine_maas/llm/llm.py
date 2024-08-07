import logging
from collections.abc import Generator

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
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
from core.model_runtime.model_providers.volcengine_maas.client import MaaSClient
from core.model_runtime.model_providers.volcengine_maas.errors import (
    AuthErrors,
    BadRequestErrors,
    ConnectionErrors,
    RateLimitErrors,
    ServerUnavailableErrors,
)
from core.model_runtime.model_providers.volcengine_maas.llm.models import ModelConfigs
from core.model_runtime.model_providers.volcengine_maas.volc_sdk import MaasException

logger = logging.getLogger(__name__)


class VolcengineMaaSLargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                model_parameters: dict, tools: list[PromptMessageTool] | None = None,
                stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
        return self._generate(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials
        """
        # ping
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

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: list[PromptMessageTool] | None = None) -> int:
        if len(prompt_messages) == 0:
            return 0
        return self._num_tokens_from_messages(prompt_messages)

    def _num_tokens_from_messages(self, messages: list[PromptMessage]) -> int:
        """
        Calculate num tokens.

        :param messages: messages
        """
        num_tokens = 0
        messages_dict = [
            MaaSClient.convert_prompt_message_to_maas_message(m) for m in messages]
        for message in messages_dict:
            for key, value in message.items():
                num_tokens += self._get_num_tokens_by_gpt2(str(key))
                num_tokens += self._get_num_tokens_by_gpt2(str(value))

        return num_tokens

    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                  model_parameters: dict, tools: list[PromptMessageTool] | None = None,
                  stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:

        client = MaaSClient.from_credential(credentials)

        req_params = ModelConfigs.get(
            credentials['base_model_name'], {}).get('req_params', {}).copy()
        if credentials.get('context_size'):
            req_params['max_prompt_tokens'] = credentials.get('context_size')
        if credentials.get('max_tokens'):
            req_params['max_new_tokens'] = credentials.get('max_tokens')
        if model_parameters.get('max_tokens'):
            req_params['max_new_tokens'] = model_parameters.get('max_tokens')
        if model_parameters.get('temperature'):
            req_params['temperature'] = model_parameters.get('temperature')
        if model_parameters.get('top_p'):
            req_params['top_p'] = model_parameters.get('top_p')
        if model_parameters.get('top_k'):
            req_params['top_k'] = model_parameters.get('top_k')
        if model_parameters.get('presence_penalty'):
            req_params['presence_penalty'] = model_parameters.get(
                'presence_penalty')
        if model_parameters.get('frequency_penalty'):
            req_params['frequency_penalty'] = model_parameters.get(
                'frequency_penalty')
        if stop:
            req_params['stop'] = stop

        extra_model_kwargs = {}
        
        if tools:
            extra_model_kwargs['tools'] = [
                MaaSClient.transform_tool_prompt_to_maas_config(tool) for tool in tools
            ]

        resp = MaaSClient.wrap_exception(
            lambda: client.chat(req_params, prompt_messages, stream, **extra_model_kwargs))
        if not stream:
            return self._handle_chat_response(model, credentials, prompt_messages, resp)
        return self._handle_stream_chat_response(model, credentials, prompt_messages, resp)

    def _handle_stream_chat_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], resp: Generator) -> Generator:
        for index, r in enumerate(resp):
            choices = r['choices']
            if not choices:
                continue
            choice = choices[0]
            message = choice['message']
            usage = None
            if r.get('usage'):
                usage = self._calc_usage(model, credentials, r['usage'])
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

    def _handle_chat_response(self,  model: str, credentials: dict, prompt_messages: list[PromptMessage], resp: dict) -> LLMResult:
        choices = resp['choices']
        if not choices:
            return
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

        return LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=message['content'] if message['content'] else '',
                tool_calls=tool_calls,
            ),
            usage=self._calc_usage(model, credentials, resp['usage']),
        )

    def _calc_usage(self,  model: str, credentials: dict, usage: dict) -> LLMUsage:
        return self._calc_response_usage(model=model, credentials=credentials,
                                         prompt_tokens=usage['prompt_tokens'],
                                         completion_tokens=usage['completion_tokens']
                                         )

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        max_tokens = ModelConfigs.get(
            credentials['base_model_name'], {}).get('req_params', {}).get('max_new_tokens')
        if credentials.get('max_tokens'):
            max_tokens = int(credentials.get('max_tokens'))
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
                label={
                    'en_US': 'Presence Penalty',
                    'zh_Hans': '存在惩罚',
                },
                min=-2.0,
                max=2.0,
            ),
            ParameterRule(
                name='frequency_penalty',
                type=ParameterType.FLOAT,
                use_template='frequency_penalty',
                label={
                    'en_US': 'Frequency Penalty',
                    'zh_Hans': '频率惩罚',
                },
                min=-2.0,
                max=2.0,
            ),
            ParameterRule(
                name='max_tokens',
                type=ParameterType.INT,
                use_template='max_tokens',
                min=1,
                max=max_tokens,
                default=512,
                label=I18nObject(
                    zh_Hans='最大生成长度',
                    en_US='Max Tokens'
                )
            ),
        ]

        model_properties = ModelConfigs.get(
            credentials['base_model_name'], {}).get('model_properties', {}).copy()
        if credentials.get('mode'):
            model_properties[ModelPropertyKey.MODE] = credentials.get('mode')
        if credentials.get('context_size'):
            model_properties[ModelPropertyKey.CONTEXT_SIZE] = int(
                credentials.get('context_size', 4096))

        model_features = ModelConfigs.get(
            credentials['base_model_name'], {}).get('features', [])

        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties=model_properties,
            parameter_rules=rules,
            features=model_features,
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
