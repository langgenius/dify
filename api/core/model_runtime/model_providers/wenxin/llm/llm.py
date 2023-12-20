from typing import Generator, List, Optional, Union, cast
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool, AssistantPromptMessage, UserPromptMessage
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.errors.invoke import InvokeConnectionError, InvokeServerUnavailableError, InvokeRateLimitError, \
    InvokeAuthorizationError, InvokeBadRequestError, InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError

class ErnieBotLarguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, 
                prompt_messages: list[PromptMessage], model_parameters: dict, 
                tools: list[PromptMessageTool] | None = None, stop: List[str] | None = None, 
                stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
        return self._generate(model=model, credentials=credentials, prompt_messages=prompt_messages,
                                model_parameters=model_parameters, tools=tools, stop=stop, stream=stream, user=user)

    def get_num_tokens(self, model: str, prompt_messages: list[PromptMessage], 
                       tools: list[PromptMessageTool] | None = None) -> int:
        pass

    def _num_tokens_from_messages(self, messages: List[PromptMessage],) -> int:
        """Calculate num tokens for baichuan model"""
        pass

    def validate_credentials(self, model: str, credentials: dict) -> None:
        pass

    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], 
                 model_parameters: dict, tools: list[PromptMessageTool] | None = None, 
                 stop: List[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:
        pass

    def _handle_chat_generate_response(self, model: str,
                                       prompt_messages: list[PromptMessage],
                                       credentials: dict,
                                       response: None) -> LLMResult:
        pass

    def _handle_chat_generate_stream_response(self, model: str,
                                              prompt_messages: list[PromptMessage],
                                              credentials: dict,
                                              response: Generator[None, None, None]) -> Generator:
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
            ]
        }
