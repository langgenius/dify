from collections.abc import Callable, Generator, Sequence
from typing import Any, override

from core.app.apps.exc import ModerationInvocationError
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMStructuredOutput, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, PromptMessageTool
from graphon.node_events import NodeEventPayload, NodeRunResult
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol, LLMProtocol
from graphon.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode


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


class DifyParameterExtractorNode(ParameterExtractorNode):
    """Retain moderation types until Graphon includes them in failed extraction results.

    Like the base node lifecycle, each instance executes one run at a time.
    The temporary type belongs only to that run and is cleared on every exit.
    """

    _moderation_error_type: str = ""

    @classmethod
    @override
    def version(cls) -> str:
        """Return the explicit registry version required for every Dify node implementation."""
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        """Run normal extraction, preserving a caught moderation type without changing its verdict or outputs."""
        try:
            result = super()._run()
            if result.status == WorkflowNodeExecutionStatus.FAILED and self._moderation_error_type:
                result.error_type = self._moderation_error_type
            return result
        finally:
            self._moderation_error_type = ""

    @override
    def _invoke(
        self,
        model_instance: LLMProtocol,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool],
        stop: Sequence[str] | None,
    ) -> tuple[str, LLMUsage, AssistantPromptMessage.ToolCall | None]:
        """Delegate invocation and preserve only the type of a moderation error the base node will catch."""
        try:
            return super()._invoke(model_instance, prompt_messages, tools, stop)
        except ModerationInvocationError as error:
            self._moderation_error_type = type(error).__name__
            raise
