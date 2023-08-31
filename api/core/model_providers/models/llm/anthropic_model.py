import logging
from typing import List, Optional, Any

import anthropic
from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from core.third_party.langchain.llms.anthropic_llm import AnthropicLLM


class AnthropicModel(BaseLLM):
    model_mode: ModelMode = ModelMode.CHAT

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        return AnthropicLLM(
            model=self.name,
            streaming=self.streaming,
            callbacks=self.callbacks,
            default_request_timeout=60,
            **self.credentials,
            **provider_model_kwargs
        )

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
        return max(self._client.get_num_tokens_from_messages(prompts) - len(prompts), 0)

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        for k, v in provider_model_kwargs.items():
            if hasattr(self.client, k):
                setattr(self.client, k, v)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, anthropic.APIConnectionError):
            logging.warning("Failed to connect to Anthropic API.")
            return LLMAPIConnectionError(f"Anthropic: The server could not be reached, cause: {ex.__cause__}")
        elif isinstance(ex, anthropic.RateLimitError):
            return LLMRateLimitError("Anthropic: A 429 status code was received; we should back off a bit.")
        elif isinstance(ex, anthropic.AuthenticationError):
            return LLMAuthorizationError(f"Anthropic: {ex.message}")
        elif isinstance(ex, anthropic.BadRequestError):
            return LLMBadRequestError(f"Anthropic: {ex.message}")
        elif isinstance(ex, anthropic.APIStatusError):
            return LLMAPIUnavailableError(f"Anthropic: code: {ex.status_code}, cause: {ex.message}")
        else:
            return ex

    @property
    def support_streaming(self):
        return True

