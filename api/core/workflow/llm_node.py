from collections.abc import Callable, Generator, Sequence
from typing import Any, override

from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMStructuredOutput
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.node_events import NodeEventPayload
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol


# TODO: Remove this Dify-specific node once graphon exposes a polling finalization hook.
class DifyLLMNode(LLMNode):
    """Dify-owned LLM node lifecycle extensions."""

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    def __init__(
        self,
        *args: Any,
        polling_finalizer: Callable[[], None],
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._polling_finalizer = polling_finalizer

    @override
    def _invoke_llm_with_polling(
        self,
        *,
        file_outputs: list[File],
        polling_model: LLMPollingCapableProtocol,
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None,
    ) -> Generator[NodeEventPayload | LLMStructuredOutput, None, None]:
        try:
            yield from super()._invoke_llm_with_polling(
                file_outputs=file_outputs,
                polling_model=polling_model,
                prompt_messages=prompt_messages,
                stop=stop,
            )
        finally:
            self._polling_finalizer()
