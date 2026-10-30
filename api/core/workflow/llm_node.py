from collections.abc import Callable, Generator, Sequence
from typing import Any, override

from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMStructuredOutput
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole
from graphon.node_events import NodeEventPayload
from graphon.nodes.llm.entities import LLMNodeChatModelMessage, LLMNodeCompletionModelPromptTemplate
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol
from libs.generative_ui_prompt import load_generative_ui_prompt


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
        if (self.node_data.model_extra or {}).get("generative_ui_enabled", False):
            if self.node_data.structured_output_enabled:
                raise ValueError("Generative UI cannot be combined with JSON structured output.")
            # UI programs are final answer content. Provider reasoning must use
            # the existing independent reasoning channel, including tagged models.
            self.node_data.reasoning_format = "separated"
            instructions = load_generative_ui_prompt()
            template = self.node_data.prompt_template
            if isinstance(template, LLMNodeCompletionModelPromptTemplate):
                prompt_field = "jinja2_text" if template.edition_type == "jinja2" and template.jinja2_text else "text"
                if prompt_field == "jinja2_text":
                    instructions = "{% raw %}" + instructions + "{% endraw %}"
                self.node_data.prompt_template = template.model_copy(
                    update={prompt_field: f"{instructions}\n\n{getattr(template, prompt_field)}"}
                )
            else:
                self.node_data.prompt_template = [
                    *template,
                    LLMNodeChatModelMessage(role=PromptMessageRole.SYSTEM, text=instructions),
                ]

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
