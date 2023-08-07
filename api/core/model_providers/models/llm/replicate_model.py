import decimal
from functools import wraps
from typing import List, Optional

from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult, get_buffer_string
from replicate.exceptions import ReplicateError, ModelError

from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.error import LLMBadRequestError
from core.third_party.langchain.llms.replicate_llm import EnhanceReplicate
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs


def handle_replicate_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except (ModelError, ReplicateError) as e:
            raise LLMBadRequestError(f"Replicate: {str(e)}")

    return wrapper


class ReplicateModel(BaseLLM):
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

        client = EnhanceReplicate(
            model=name + ':' + credentials.get('model_version'),
            input=provider_model_kwargs,
            streaming=streaming,
            callbacks=callbacks,
            replicate_api_token=credentials.get('replicate_api_token'),
        )

        self.model_mode = ModelMode.CHAT if name.endswith('-chat') else ModelMode.COMPLETION

        super().__init__(model_provider, client, name, model_rules, model_kwargs, streaming)

    @handle_replicate_exceptions
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
        extra_kwargs = {}
        if isinstance(prompts, list):
            system_messages = [message for message in messages if message.type == 'system']
            if system_messages:
                system_message = system_messages[0]
                extra_kwargs['system_prompt'] = system_message.content
                prompts = [message for message in messages if message.type != 'system']

            prompts = get_buffer_string(prompts)

        # The maximum length the generated tokens can have.
        # Corresponds to the length of the input prompt + max_new_tokens.
        if 'max_length' in self._client.input:
            self._client.input['max_length'] = min(
                self._client.input['max_length'] + self.get_num_tokens(messages),
                self.model_rules.max_tokens.max
            )

        return self._client.generate([prompts], stop, callbacks, **extra_kwargs)

    def get_num_tokens(self, messages: List[PromptMessage]) -> int:
        """
        get num tokens of prompt messages.

        :param messages:
        :return:
        """
        prompts = self._get_prompt_from_messages(messages)
        if isinstance(prompts, list):
            prompts = get_buffer_string(prompts)

        return self._client.get_num_tokens(prompts)

    def get_token_price(self, tokens: int, message_type: MessageType):
        # replicate only pay for prediction seconds
        return decimal.Decimal('0')

    def get_currency(self):
        raise 'USD'
