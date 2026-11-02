import logging
from collections.abc import Callable, Generator, Sequence
from typing import Any, override

from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMStructuredOutput
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.node_events import NodeEventPayload
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol

logger = logging.getLogger(__name__)


# TODO: Remove this Dify-specific node once graphon exposes a polling finalization hook
# and no longer rejects models that do not declare `structured-output`.
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
    ) -> Generator[NodeEventPayload | LLMStructuredOutput]:
        try:
            yield from super()._invoke_llm_with_polling(
                file_outputs=file_outputs,
                polling_model=polling_model,
                prompt_messages=prompt_messages,
                stop=stop,
            )
        finally:
            self._polling_finalizer()

    @override
    def _prepare_run_prompt(
        self,
        *,
        node_inputs: dict[str, Any],
    ) -> Generator[NodeEventPayload, None, Any]:
        """Do not reject structured output on models that do not declare `structured-output`.

        graphon raises `LLMNodeError(... stage=capability)` while preparing the prompt when the
        model schema lacks the `structured-output` feature. The model runtime, however, already
        handles that case: `invoke_llm_with_structured_output` injects the JSON schema into the
        prompt when the feature is absent, which is what Dify did before graphon added the check.
        The check is inline in `_prepare_run_prompt` and is the only reader of
        `structured_output_enabled` there, so the switch is lowered for the duration of the
        preparation and restored right after: the invocation still sees structured output as
        enabled and keeps requesting it.
        """
        node_data = self.node_data
        switch_on = node_data.structured_output_switch_on
        if node_data.structured_output_enabled:
            logger.debug(
                "Skipping graphon structured-output capability check for node %s; "
                "the model runtime falls back to prompt-based schema when needed.",
                self._node_id,
            )
        node_data.structured_output_switch_on = False
        try:
            return (yield from super()._prepare_run_prompt(node_inputs=node_inputs))
        finally:
            node_data.structured_output_switch_on = switch_on
