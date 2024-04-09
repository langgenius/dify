import time
from collections.abc import Mapping
from typing import Any, Optional

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.chat_models.base import SimpleChatModel
from langchain.schema import AIMessage, BaseMessage, ChatGeneration, ChatResult


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
        messages: list[BaseMessage],
        stop: Optional[list[str]] = None,
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

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: Optional[list[str]] = None,
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
        llm_output = {"token_usage": {
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'total_tokens': 0,
        }}
        return ChatResult(generations=[generation], llm_output=llm_output)
