from collections.abc import Generator

from httpx import Response

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
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


class XinferenceAILargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], 
                model_parameters: dict, tools: list[PromptMessageTool] | None = None, 
                stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
        -> LLMResult | Generator:
        """
            invoke LLM

            see `core.model_runtime.model_providers.__base.large_language_model.LargeLanguageModel._invoke`
        """
        if 'temperature' in model_parameters:
            if model_parameters['temperature'] < 0.01:
                model_parameters['temperature'] = 0.01
            elif model_parameters['temperature'] > 1.0:
                model_parameters['temperature'] = 0.99

        return self._generate(
            model=model, credentials=credentials, prompt_messages=prompt_messages, model_parameters=model_parameters,
            tools=tools, stop=stop, stream=stream, user=user,
        )

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
            validate credentials

            credentials should be like:
            {
                'model_type': 'text-generation',
                'server_url': 'server url',
                'model_uid': 'model uid',
            }
        """

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: list[PromptMessageTool] | None = None) -> int:
        """
            get number of tokens

            cause XinferenceAI LLM is a customized model, we could net detect which tokenizer to use
            so we just take the GPT2 tokenizer as default
        """
        return self._num_tokens_from_messages(prompt_messages, tools)

    
    def _convert_prompt_message_to_text(self, message: list[PromptMessage]) -> str:
        """
            convert prompt message to text
        """
        text = ''
        for item in message:
            if isinstance(item, UserPromptMessage):
                text += item.content
            elif isinstance(item, SystemPromptMessage):
                text += item.content
            elif isinstance(item, AssistantPromptMessage):
                text += item.content
            else:
                raise NotImplementedError(f'PromptMessage type {type(item)} is not supported')
        return text

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        rules = [
            ParameterRule(
                name='temperature',
                type=ParameterType.FLOAT,
                use_template='temperature',
                label=I18nObject(
                    zh_Hans='温度',
                    en_US='Temperature'
                ),
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
                name='max_tokens',
                type=ParameterType.INT,
                use_template='max_tokens',
                min=1,
                max=int(credentials.get('context_length', 2048)),
                default=min(512, int(credentials.get('context_length', 2048))),
                label=I18nObject(
                    zh_Hans='最大生成长度',
                    en_US='Max Tokens'
                )
            )
        ]

        completion_type = None

        if 'completion_type' in credentials:
            if credentials['completion_type'] == 'chat':
                completion_type = LLMMode.CHAT.value
            elif credentials['completion_type'] == 'completion':
                completion_type = LLMMode.COMPLETION.value
            else:
                raise ValueError(f'completion_type {credentials["completion_type"]} is not supported')
        
        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            parameter_rules=rules,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties={
                ModelPropertyKey.MODE: completion_type,
                ModelPropertyKey.CONTEXT_SIZE: int(credentials.get('context_length', 2048)),
            },
        )

        return entity
    
    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], 
                 model_parameters: dict,
                 tools: list[PromptMessageTool] | None = None, 
                 stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
        """
            generate text from LLM

            see `core.model_runtime.model_providers.__base.large_language_model.LargeLanguageModel._generate`
            
            extra_model_kwargs can be got by `XinferenceHelper.get_xinference_extra_parameter`
        """
        if 'server_url' not in credentials:
            raise CredentialsValidateFailedError('server_url is required in credentials')
        
        if credentials['server_url'].endswith('/'):
            credentials['server_url'] = credentials['server_url'][:-1]
        
        return self._handle_chat_generate_response(model=model, credentials=credentials, prompt_messages=prompt_messages,
                                                        tools=tools)

    def _handle_chat_generate_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                        tools: list[PromptMessageTool],
                                        resp: Response) -> LLMResult:
        """
            handle normal chat generate response
        """
        pass

    def _handle_chat_stream_response(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                                        tools: list[PromptMessageTool],
                                        resp: Response) -> Generator:
        """
            handle stream chat generate response
        """
        pass

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
            ],
            InvokeServerUnavailableError: [
            ],
            InvokeRateLimitError: [
            ],
            InvokeAuthorizationError: [
            ],
            InvokeBadRequestError: [
                ValueError
            ]
        }