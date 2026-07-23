"""LangSmith adapter for the provider-neutral unified tracing runtime."""

from collections.abc import Mapping
from typing import Any, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from langsmith import Client

from core.ops.exceptions import InvalidTraceParentContextError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.parent_context import (
    ParentContextCoordinator,
    ParentResolution,
    ParentResolutionKind,
    ProviderParentContext,
    destination_scope,
    resolve_parent_destination,
)
from core.ops.unified_trace.provider import ParentContextPublisher, UnifiedTraceInstance
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder, RepositoryWorkflowExecutionLoader
from core.ops.utils import generate_dotted_order
from dify_trace_langsmith.config import LangSmithConfig
from extensions.ext_redis import redis_client

type LangSmithRunType = Literal["chain", "llm", "retriever", "tool"]

_RUN_TYPE: dict[CanonicalSpanKind, LangSmithRunType] = {
    CanonicalSpanKind.CHAIN: "chain",
    CanonicalSpanKind.LLM: "llm",
    CanonicalSpanKind.RETRIEVER: "retriever",
    CanonicalSpanKind.TOOL: "tool",
    CanonicalSpanKind.AGENT: "chain",
}


def _provider_run_id(canonical_id: str) -> str:
    """Keep UUID execution IDs and deterministically map synthetic wrapper IDs."""
    try:
        return str(UUID(canonical_id))
    except ValueError:
        return str(uuid5(NAMESPACE_URL, f"dify-unified-trace:{canonical_id}"))


def _langsmith_value(value: Any, key: str) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    return {key: value}


def _langsmith_inputs(span: CanonicalSpan) -> dict[str, Any]:
    if span.metadata.get("trace_entity_type") == "message" and isinstance(span.inputs, str):
        return {"messages": [{"role": "user", "content": span.inputs}]}
    return _langsmith_value(span.inputs, "input")


class UnifiedLangSmithAdapter:
    """Translate canonical spans to LangSmith Runs with explicit hierarchy."""

    provider_name = "langsmith"

    def __init__(self, config: LangSmithConfig) -> None:
        # Parent context is published only after create_run returns, so unified
        # ordering requires synchronous writes rather than the SDK's default queue.
        self._client = Client(api_key=config.api_key, api_url=config.endpoint, auto_batch_tracing=False)
        self._project_name = config.project
        self._scope = destination_scope(self.provider_name, config.endpoint, config.project)

    @property
    def scope(self) -> str:
        return self._scope

    def emit(
        self,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
        publish_parent_context: ParentContextPublisher,
    ) -> None:
        provider_id_by_canonical_id = {span.id: _provider_run_id(span.id) for span in trace.spans}
        root_provider_id = provider_id_by_canonical_id[trace.root_span_id]
        restored_context = parent.context if parent and parent.kind is ParentResolutionKind.RESTORED else None
        external_parent_id: str | None
        external_parent_order: str | None

        if restored_context is not None:
            trace_id = restored_context.trace_id
            external_parent_id = restored_context.parent_id
            external_parent_order = restored_context.provider_context.get("dotted_order")
            if not external_parent_order:
                raise InvalidTraceParentContextError("LangSmith parent context is missing dotted_order")
        else:
            root_span = next(span for span in trace.spans if span.id == trace.root_span_id)
            external_parent_id = (
                _provider_run_id(root_span.parent_id)
                if root_span.parent_id and root_span.parent_id not in provider_id_by_canonical_id
                else None
            )
            trace_id = external_parent_id or root_provider_id
            external_parent_order = None

        dotted_order_by_canonical_id: dict[str, str] = {}
        for canonical_span in trace.spans:
            provider_id = provider_id_by_canonical_id[canonical_span.id]
            local_parent_id = (
                provider_id_by_canonical_id.get(canonical_span.parent_id or "") if canonical_span.parent_id else None
            )
            parent_run_id = local_parent_id
            parent_order = dotted_order_by_canonical_id.get(canonical_span.parent_id or "")
            if canonical_span.id == trace.root_span_id:
                parent_run_id = external_parent_id
                parent_order = external_parent_order

            dotted_order = generate_dotted_order(provider_id, canonical_span.start_time, parent_order)
            metadata = dict(canonical_span.metadata)
            if canonical_span.id == trace.root_span_id:
                if trace.session_id:
                    metadata["session_id"] = trace.session_id
                if trace.trace_id != trace_id:
                    metadata.setdefault("external_trace_id", trace.trace_id)
                if parent and parent.kind is ParentResolutionKind.LINKED_ROOT and parent.linked_parent:
                    metadata["linked_parent_workflow_run_id"] = parent.linked_parent.parent_workflow_run_id
                    metadata["linked_parent_node_execution_id"] = parent.linked_parent.parent_node_execution_id

            self._client.create_run(
                id=provider_id,
                name=canonical_span.name,
                inputs=_langsmith_inputs(canonical_span),
                outputs=_langsmith_value(canonical_span.outputs, "output"),
                run_type=_RUN_TYPE[canonical_span.kind],
                start_time=canonical_span.start_time,
                end_time=canonical_span.end_time,
                error=canonical_span.error if canonical_span.status is CanonicalSpanStatus.ERROR else None,
                extra={"metadata": metadata},
                tags=["dify", "synthetic" if canonical_span.synthetic else "execution"],
                parent_run_id=parent_run_id,
                trace_id=trace_id,
                dotted_order=dotted_order,
                session_name=self._project_name,
            )
            dotted_order_by_canonical_id[canonical_span.id] = dotted_order

            if canonical_span.can_parent_workflow or canonical_span.publishes_parent_context:
                publish_parent_context(
                    canonical_span.id,
                    ProviderParentContext(
                        provider=self.provider_name,
                        scope=self.scope,
                        trace_id=trace_id,
                        parent_id=provider_id,
                        provider_context={"dotted_order": dotted_order},
                    ),
                )


class UnifiedLangSmithTrace(UnifiedTraceInstance):
    """Fully isolated unified LangSmith trace instance selected by the new registry."""

    def __init__(self, config: LangSmithConfig) -> None:
        super().__init__(
            config,
            builder=CanonicalTraceBuilder(RepositoryWorkflowExecutionLoader(self.get_service_account_with_tenant)),
            adapter=UnifiedLangSmithAdapter(config),
            coordinator=ParentContextCoordinator(redis_client, resolve_parent_destination),
        )
