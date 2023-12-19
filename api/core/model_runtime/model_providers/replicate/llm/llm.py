from typing import Optional, List, Union, Generator

from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel


class ReplicateLargeLanguageModel(LargeLanguageModel):

    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[List[str]] = None, stream: bool = True,
                user: Optional[str] = None) -> Union[LLMResult, Generator]:
        pass

    def get_num_tokens(self, model: str, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        pass

    def validate_credentials(self, model: str, credentials: dict) -> None:
        pass

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        pass
