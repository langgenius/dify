from abc import ABC
from typing import Optional

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.model_providers.__base.ai_model import AIModel

_TEXT_COLOR_MAPPING = {
    "blue": "36;1",
    "yellow": "33;1",
    "pink": "38;5;200",
    "green": "32;1",
    "red": "31;1",
}


class Callback(ABC):
    """
    Base class for callbacks.
    Only for LLM.
    """
    raise_error: bool = False

    def on_before_invoke(self, llm_instance: AIModel, model: str, credentials: dict,
                         prompt_messages: list[PromptMessage], model_parameters: dict,
                         tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                         stream: bool = True, user: Optional[str] = None) -> None:
        """
        Before invoke callback

        :param llm_instance: LLM instance
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        """
        raise NotImplementedError()

    def on_new_chunk(self, llm_instance: AIModel, chunk: LLMResultChunk, model: str, credentials: dict,
                     prompt_messages: list[PromptMessage], model_parameters: dict,
                     tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                     stream: bool = True, user: Optional[str] = None):
        """
        On new chunk callback

        :param llm_instance: LLM instance
        :param chunk: chunk
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        """
        raise NotImplementedError()

    def on_after_invoke(self, llm_instance: AIModel, result: LLMResult, model: str, credentials: dict,
                        prompt_messages: list[PromptMessage], model_parameters: dict,
                        tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                        stream: bool = True, user: Optional[str] = None) -> None:
        """
        After invoke callback

        :param llm_instance: LLM instance
        :param result: result
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        """
        raise NotImplementedError()

    def on_invoke_error(self, llm_instance: AIModel, ex: Exception, model: str, credentials: dict,
                        prompt_messages: list[PromptMessage], model_parameters: dict,
                        tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                        stream: bool = True, user: Optional[str] = None) -> None:
        """
        Invoke error callback

        :param llm_instance: LLM instance
        :param ex: exception
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        """
        raise NotImplementedError()

    def print_text(
            self, text: str, color: Optional[str] = None, end: str = ""
    ) -> None:
        """Print text with highlighting and no end characters."""
        text_to_print = self._get_colored_text(text, color) if color else text
        print(text_to_print, end=end)

    def _get_colored_text(self, text: str, color: str) -> str:
        """Get colored text."""
        color_str = _TEXT_COLOR_MAPPING[color]
        return f"\u001b[{color_str}m\033[1;3m{text}\u001b[0m"
