import decimal
from functools import wraps
from typing import List, Optional

from langchain import HuggingFaceHub
from langchain.callbacks.manager import Callbacks
from langchain.llms import HuggingFaceEndpoint
from langchain.schema import LLMResult

from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.error import LLMBadRequestError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs


def handle_huggingface_hub_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            raise LLMBadRequestError(f"Huggingface Hub: {str(e)}")

    return wrapper


class HuggingfaceHubModel(BaseLLM):
    def __init__(self, model_provider: BaseModelProvider,
                 name: str,
                 model_kwargs: ModelKwargs,
                 streaming: bool = False,
                 callbacks: Callbacks = None):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        model_rules = model_provider.get_model_parameter_rules(name, self.type)
        provider_model_kwargs = self._to_model_kwargs_input(model_rules, model_kwargs)

        if credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            client = HuggingFaceEndpoint(
                endpoint_url=credentials['huggingfacehub_endpoint_url'],
                task="text2text-generation",
                model_kwargs=provider_model_kwargs,
                huggingfacehub_api_token=credentials['huggingfacehub_api_token'],
                callbacks=callbacks
            )
        else:
            client = HuggingFaceHub(
                repo_id=name,
                task='text2text-generation',
                model_kwargs=provider_model_kwargs,
                huggingfacehub_api_token=credentials['huggingfacehub_api_token'],
                callbacks=callbacks
            )

        self.model_mode = ModelMode.COMPLETION

        super().__init__(model_provider, client, name, model_rules, model_kwargs, streaming)

    @handle_huggingface_hub_exceptions
    def _run(self, messages: List[PromptMessage],
             stop: Optional[List[str]] = None,
             callbacks: Callbacks = None,
             **kwargs) -> LLMResult:
        """
        run predict by prompt messages and stop words.

        :param messages:
        :param stop:
        :param callbacks:
        :return:
        """
        prompts = self._get_prompt_from_messages(messages)
        return self._client.generate([prompts], stop, callbacks)

    def get_num_tokens(self, messages: List[PromptMessage]) -> int:
        """
        get num tokens of prompt messages.

        :param messages:
        :return:
        """
        prompts = self._get_prompt_from_messages(messages)
        return self._client.get_num_tokens(prompts)

    def get_token_price(self, tokens: int, message_type: MessageType):
        # not support calc price
        return decimal.Decimal('0')

    def get_currency(self):
        raise 'RMB'
