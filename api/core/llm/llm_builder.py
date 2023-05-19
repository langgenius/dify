from typing import Union, Optional

from langchain.callbacks import CallbackManager
from langchain.llms.fake import FakeListLLM

from core.constant import llm_constant
from core.llm.error import ProviderTokenNotInitError
from core.llm.provider.base import BaseProvider
from core.llm.provider.llm_provider_service import LLMProviderService
from core.llm.streamable_azure_chat_open_ai import StreamableAzureChatOpenAI
from core.llm.streamable_azure_open_ai import StreamableAzureOpenAI
from core.llm.streamable_chat_open_ai import StreamableChatOpenAI
from core.llm.streamable_open_ai import StreamableOpenAI
from models.provider import ProviderType


class LLMBuilder:
    """
    This class handles the following logic:
    1. For providers with the name 'OpenAI', the OPENAI_API_KEY value is stored directly in encrypted_config.
    2. For providers with the name 'Azure OpenAI', encrypted_config stores the serialized values of four fields, as shown below:
       OPENAI_API_TYPE=azure
       OPENAI_API_VERSION=2022-12-01
       OPENAI_API_BASE=https://your-resource-name.openai.azure.com
       OPENAI_API_KEY=<your Azure OpenAI API key>
    3. For providers with the name 'Anthropic', the ANTHROPIC_API_KEY value is stored directly in encrypted_config.
    4. For providers with the name 'Cohere', the COHERE_API_KEY value is stored directly in encrypted_config.
    5. For providers with the name 'HUGGINGFACEHUB', the HUGGINGFACEHUB_API_KEY value is stored directly in encrypted_config.
    6. Providers with the provider_type 'CUSTOM' can be created through the admin interface, while 'System' providers cannot be created through the admin interface.
    7. If both CUSTOM and System providers exist in the records, the CUSTOM provider is preferred by default, but this preference can be changed via an input parameter.
    8. For providers with the provider_type 'System', the quota_used must not exceed quota_limit. If the quota is exceeded, the provider cannot be used. Currently, only the TRIAL quota_type is supported, which is permanently non-resetting.
    """

    @classmethod
    def to_llm(cls, tenant_id: str, model_name: str, **kwargs) -> Union[StreamableOpenAI, StreamableChatOpenAI, FakeListLLM]:
        if model_name == 'fake':
            return FakeListLLM(responses=[])

        provider = cls.get_default_provider(tenant_id)

        mode = cls.get_mode_by_model(model_name)
        if mode == 'chat':
            if provider == 'openai':
                llm_cls = StreamableChatOpenAI
            else:
                llm_cls = StreamableAzureChatOpenAI
        elif mode == 'completion':
            if provider == 'openai':
                llm_cls = StreamableOpenAI
            else:
                llm_cls = StreamableAzureOpenAI
        else:
            raise ValueError(f"model name {model_name} is not supported.")

        model_credentials = cls.get_model_credentials(tenant_id, provider, model_name)

        return llm_cls(
            model_name=model_name,
            temperature=kwargs.get('temperature', 0),
            max_tokens=kwargs.get('max_tokens', 256),
            top_p=kwargs.get('top_p', 1),
            frequency_penalty=kwargs.get('frequency_penalty', 0),
            presence_penalty=kwargs.get('presence_penalty', 0),
            callback_manager=kwargs.get('callback_manager', None),
            streaming=kwargs.get('streaming', False),
            # request_timeout=None
            **model_credentials
        )

    @classmethod
    def to_llm_from_model(cls, tenant_id: str, model: dict, streaming: bool = False,
                          callback_manager: Optional[CallbackManager] = None) -> Union[StreamableOpenAI, StreamableChatOpenAI]:
        model_name = model.get("name")
        completion_params = model.get("completion_params", {})

        return cls.to_llm(
            tenant_id=tenant_id,
            model_name=model_name,
            temperature=completion_params.get('temperature', 0),
            max_tokens=completion_params.get('max_tokens', 256),
            top_p=completion_params.get('top_p', 0),
            frequency_penalty=completion_params.get('frequency_penalty', 0.1),
            presence_penalty=completion_params.get('presence_penalty', 0.1),
            streaming=streaming,
            callback_manager=callback_manager
        )

    @classmethod
    def get_mode_by_model(cls, model_name: str) -> str:
        if not model_name:
            raise ValueError(f"empty model name is not supported.")

        if model_name in llm_constant.models_by_mode['chat']:
            return "chat"
        elif model_name in llm_constant.models_by_mode['completion']:
            return "completion"
        else:
            raise ValueError(f"model name {model_name} is not supported.")

    @classmethod
    def get_model_credentials(cls, tenant_id: str, model_provider: str, model_name: str) -> dict:
        """
        Returns the API credentials for the given tenant_id and model_name, based on the model's provider.
        Raises an exception if the model_name is not found or if the provider is not found.
        """
        if not model_name:
            raise Exception('model name not found')
        #
        # if model_name not in llm_constant.models:
        #     raise Exception('model {} not found'.format(model_name))

        # model_provider = llm_constant.models[model_name]

        provider_service = LLMProviderService(tenant_id=tenant_id, provider_name=model_provider)
        return provider_service.get_credentials(model_name)

    @classmethod
    def get_default_provider(cls, tenant_id: str) -> str:
        provider = BaseProvider.get_valid_provider(tenant_id)
        if not provider:
            raise ProviderTokenNotInitError()

        if provider.provider_type == ProviderType.SYSTEM.value:
            provider_name = 'openai'
        else:
            provider_name = provider.provider_name

        return provider_name
