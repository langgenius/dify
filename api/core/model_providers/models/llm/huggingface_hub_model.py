from typing import List, Optional, Any

from langchain import HuggingFaceHub
from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult

from core.model_providers.error import LLMBadRequestError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from core.third_party.langchain.llms.huggingface_endpoint_llm import HuggingFaceEndpointLLM


class HuggingfaceHubModel(BaseLLM):
    model_mode: ModelMode = ModelMode.COMPLETION

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        if self.credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            streaming = self.streaming

            if 'baichuan' in self.name.lower():
                streaming = False

            client = HuggingFaceEndpointLLM(
                endpoint_url=self.credentials['huggingfacehub_endpoint_url'],
                task=self.credentials['task_type'],
                model_kwargs=provider_model_kwargs,
                huggingfacehub_api_token=self.credentials['huggingfacehub_api_token'],
                callbacks=self.callbacks,
                streaming=streaming
            )
        else:
            client = HuggingFaceHub(
                repo_id=self.name,
                task=self.credentials['task_type'],
                model_kwargs=provider_model_kwargs,
                huggingfacehub_api_token=self.credentials['huggingfacehub_api_token'],
                callbacks=self.callbacks,
            )

        return client

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

    def prompt_file_name(self, mode: str) -> str:
        if 'baichuan' in self.name.lower():
            if mode == 'completion':
                return 'baichuan_completion'
            else:
                return 'baichuan_chat'
        else:
            return super().prompt_file_name(mode)

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        self.client.model_kwargs = provider_model_kwargs

    def handle_exceptions(self, ex: Exception) -> Exception:
        return LLMBadRequestError(f"Huggingface Hub: {str(ex)}")

    @property
    def support_streaming(self):
        if self.credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            if 'baichuan' in self.name.lower():
                return False

        return True
