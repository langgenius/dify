"""Production :class:`OutputCheckModelInvoker` backed by ``ModelManager``.

Stage 4 §6: the file-output check needs a direct, non-streaming LLM call that
yields one assistant message plus token usage. Implementation choices:

* **No agent backend hop.** This is a one-shot evaluation, not an agentic
  loop. Going through the agent backend would conflate output-check usage
  with agent-run usage and introduce unnecessary protocol surface.
* **Reuse Agent Soul's model identity.** Callers supply ``provider`` and
  ``model_name`` from the same :class:`AgentSoulModelConfig` the agent itself
  uses; the check therefore inherits the tenant's existing model credentials
  and configuration without a separate setup.
* **Bucket usage separately.** Returned ``FileOutputCheckUsage`` is later
  recorded under ``WorkflowNodeExecutionMetadata.output_check_usage`` per
  decision D-2; never merged with agent-run usage.

Any exception raised inside ``ModelInstance.invoke_llm`` (provider error,
credential issue, network timeout, ...) is converted to a single
:class:`OutputCheckModelInvocationError`. The executor catches that and emits
a SKIPPED result tagged ``output_check_model_error`` so the surrounding retry
/ fail-branch logic still proceeds deterministically.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from core.model_manager import ModelManager
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType

from .output_check_executor import (
    FileOutputCheckUsage,
    OutputCheckModelInvocationError,
    OutputCheckModelResponse,
)

# Resolves a tenant id to a fresh ``ModelManager``. Defined as a Callable
# alias rather than a Protocol class so plain functions injected by tests
# (e.g. ``lambda _: stub``) satisfy the type without subclassing.
ModelManagerFactory = Callable[[str], ModelManager]


class ModelRuntimeOutputCheckInvoker:
    """Direct LLM invocation via the existing model_runtime stack.

    A fresh :class:`ModelManager` is built per invocation by default so
    credential-cache staleness cannot leak across workflow runs. Tests can
    inject their own ``model_manager_factory`` to avoid touching the provider
    manager and DB.
    """

    def __init__(
        self,
        model_manager_factory: ModelManagerFactory | None = None,
    ) -> None:
        self._factory: ModelManagerFactory = model_manager_factory or _default_model_manager_factory

    def invoke(
        self,
        *,
        tenant_id: str,
        model_provider: str,
        model_name: str,
        prompt: str,
        model_settings: Mapping[str, Any] | None = None,
    ) -> OutputCheckModelResponse:
        try:
            manager = self._factory(tenant_id)
            model_instance = manager.get_model_instance(
                tenant_id=tenant_id,
                provider=model_provider,
                model_type=ModelType.LLM,
                model=model_name,
            )
            result = model_instance.invoke_llm(
                prompt_messages=[UserPromptMessage(content=prompt)],
                model_parameters=dict(model_settings or {}),
                stream=False,
            )
        except Exception as exc:
            raise OutputCheckModelInvocationError(str(exc)) from exc

        if not isinstance(result, LLMResult):
            # ``stream=False`` is documented to return LLMResult; if the
            # provider implementation breaks that contract surface it through
            # the same uniform error path rather than a cryptic AttributeError
            # later.
            raise OutputCheckModelInvocationError(
                f"Expected LLMResult from non-streaming invoke, got {type(result).__name__}"
            )

        text = _flatten_assistant_text(result)
        usage = _to_file_output_check_usage(result.usage)
        return OutputCheckModelResponse(text=text, usage=usage)


def _default_model_manager_factory(tenant_id: str) -> ModelManager:
    return ModelManager.for_tenant(tenant_id)


def _flatten_assistant_text(result: LLMResult) -> str:
    """Extract a plain string from ``AssistantPromptMessage.content``.

    The model runtime allows multimodal content lists; for output check we
    only ever expect a text response, but defensive flattening prevents an
    unexpected list payload from crashing the parser.
    """
    content = result.message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for piece in content:
            piece_text = getattr(piece, "data", None) or getattr(piece, "text", None)
            if isinstance(piece_text, str):
                parts.append(piece_text)
        return "\n".join(parts)
    return ""


def _to_file_output_check_usage(usage: LLMUsage) -> FileOutputCheckUsage:
    """Project an :class:`LLMUsage` into the executor's narrower shape."""
    return FileOutputCheckUsage(
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        total_price=usage.total_price,
        currency=usage.currency,
        latency_ms=int(usage.latency * 1000),
    )
