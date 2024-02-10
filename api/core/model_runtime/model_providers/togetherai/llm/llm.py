from collections.abc import Generator
from typing import Optional, Union

from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel


class TogetherAILargeLanguageModel(OAIAPICompatLargeLanguageModel):

    def _update_endpoint_url(self, credentials: dict):
        credentials['endpoint_url'] = "https://api.together.xyz/v1"
        return credentials

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super()._invoke(model, cred_with_endpoint, prompt_messages, model_parameters, tools, stop, stream, user)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().validate_credentials(model, cred_with_endpoint)

    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                  tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                  stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super()._generate(model, cred_with_endpoint, prompt_messages, model_parameters, tools, stop, stream, user)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().get_customizable_model_schema(model, cred_with_endpoint)

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().get_num_tokens(model, cred_with_endpoint, prompt_messages, tools)


