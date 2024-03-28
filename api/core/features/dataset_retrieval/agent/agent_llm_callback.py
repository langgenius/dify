import logging
from typing import Optional

from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.model_providers.__base.ai_model import AIModel

logger = logging.getLogger(__name__)


class AgentLLMCallback(Callback):

    def __init__(self, agent_callback: AgentLoopGatherCallbackHandler) -> None:
        self.agent_callback = agent_callback

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
        self.agent_callback.on_llm_before_invoke(
            prompt_messages=prompt_messages
        )

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
        pass

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
        self.agent_callback.on_llm_after_invoke(
            result=result
        )

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
        self.agent_callback.on_llm_error(
            error=ex
        )
