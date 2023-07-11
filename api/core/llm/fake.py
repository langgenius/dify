import time
from typing import List, Optional, Any, Mapping

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.chat_models.base import SimpleChatModel
from langchain.schema import BaseMessage, ChatResult, AIMessage, ChatGeneration


class FakeLLM(SimpleChatModel):
    """Fake ChatModel for testing purposes."""

    streaming: bool = False
    """Whether to stream the results or not."""
    response: str

    @property
    def _llm_type(self) -> str:
        return "fake-chat-model"

    def _call(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        """First try to lookup in queries, else return 'foo' or 'bar'."""
        return self.response

    @property
    def _identifying_params(self) -> Mapping[str, Any]:
        return {"response": self.response}

    def get_num_tokens(self, text: str) -> int:
        return 0

    def get_messages_tokens(self, messages: List[BaseMessage]) -> int:
        return 0

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        output_str = self._call(messages, stop=stop, run_manager=run_manager, **kwargs)
        if self.streaming:
            for token in output_str:
                if run_manager:
                    run_manager.on_llm_new_token(token)
                    time.sleep(0.01)

        message = AIMessage(content=output_str)
        generation = ChatGeneration(message=message)
        return ChatResult(generations=[generation])
