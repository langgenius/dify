import logging
import time

from typing import Any, Dict, Union

from langchain.callbacks.base import BaseCallbackHandler

from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.entity.chain_result import ChainResult
from core.constant import llm_constant
from core.conversation_message_task import ConversationMessageTask


class MainChainGatherCallbackHandler(BaseCallbackHandler):
    """Callback Handler that prints to std out."""
    raise_error: bool = True

    def __init__(self, conversation_message_task: ConversationMessageTask) -> None:
        """Initialize callback handler."""
        self._current_chain_result = None
        self._current_chain_message = None
        self.conversation_message_task = conversation_message_task
        self.agent_loop_gather_callback_handler = AgentLoopGatherCallbackHandler(
            llm_constant.agent_model_name,
            conversation_message_task
        )

    def clear_chain_results(self) -> None:
        self._current_chain_result = None
        self._current_chain_message = None
        self.agent_loop_gather_callback_handler.current_chain = None

    @property
    def always_verbose(self) -> bool:
        """Whether to call verbose callbacks even if verbose is False."""
        return True

    @property
    def ignore_llm(self) -> bool:
        """Whether to ignore LLM callbacks."""
        return True

    @property
    def ignore_agent(self) -> bool:
        """Whether to ignore agent callbacks."""
        return True

    def on_chain_start(
        self, serialized: Dict[str, Any], inputs: Dict[str, Any], **kwargs: Any
    ) -> None:
        """Print out that we are entering a chain."""
        if not self._current_chain_result:
            chain_type = serialized['id'][-1]
            if chain_type:
                self._current_chain_result = ChainResult(
                    type=chain_type,
                    prompt=inputs,
                    started_at=time.perf_counter()
                )
                self._current_chain_message = self.conversation_message_task.init_chain(self._current_chain_result)
                self.agent_loop_gather_callback_handler.current_chain = self._current_chain_message

    def on_chain_end(self, outputs: Dict[str, Any], **kwargs: Any) -> None:
        """Print out that we finished a chain."""
        if self._current_chain_result and self._current_chain_result.status == 'chain_started':
            self._current_chain_result.status = 'chain_ended'
            self._current_chain_result.completion = outputs
            self._current_chain_result.completed = True
            self._current_chain_result.completed_at = time.perf_counter()

            self.conversation_message_task.on_chain_end(self._current_chain_message, self._current_chain_result)

            self.clear_chain_results()

    def on_chain_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        logging.error(error)
        self.clear_chain_results()