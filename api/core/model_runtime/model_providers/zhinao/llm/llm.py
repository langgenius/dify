from collections.abc import Generator
from typing import Optional, Union

from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel


class ZhinaoLargeLanguageModel(OAIAPICompatLargeLanguageModel):
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
        self._add_custom_parameters(credentials)
        return super()._invoke(model, credentials, prompt_messages, model_parameters, tools, stop, stream)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        self._add_custom_parameters(credentials)
        super().validate_credentials(model, credentials)

    @classmethod
    def _add_custom_parameters(cls, credentials: dict) -> None:
        credentials["mode"] = "chat"
        credentials["endpoint_url"] = "https://api.360.cn/v1"
