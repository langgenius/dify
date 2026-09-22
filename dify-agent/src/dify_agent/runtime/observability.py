from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final, Literal

from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import (
    INVALID_SPAN,
    Link,
    Span,
    SpanKind,
    Tracer,
    TracerProvider,
    get_current_span,
    set_span_in_context,
)
from opentelemetry.util.types import Attributes

from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig

if TYPE_CHECKING:
    from logfire import Logfire
    from pydantic_ai import Agent

DIFY_TRACE_ID_ATTRIBUTE: Final[str] = "dify.trace_id"
DIFY_TENANT_ID_ATTRIBUTE: Final[str] = "dify.tenant_id"
DIFY_APP_ID_ATTRIBUTE: Final[str] = "dify.app_id"
DIFY_AGENT_ID_ATTRIBUTE: Final[str] = "dify.agent_id"
DIFY_INVOKE_FROM_ATTRIBUTE: Final[str] = "dify.invoke_from"
DIFY_CONVERSATION_ID_ATTRIBUTE: Final[str] = "dify.conversation.id"
DIFY_WORKFLOW_ID_ATTRIBUTE: Final[str] = "dify.workflow.id"
DIFY_WORKFLOW_RUN_ID_ATTRIBUTE: Final[str] = "dify.workflow.run_id"
DIFY_NODE_ID_ATTRIBUTE: Final[str] = "dify.node.id"
DIFY_NODE_EXECUTION_ID_ATTRIBUTE: Final[str] = "dify.node.execution_id"
GEN_AI_USER_ID_ATTRIBUTE: Final[str] = "gen_ai.user.id"


def dify_run_attributes(execution_context: DifyExecutionContextLayerConfig) -> tuple[tuple[str, str], ...]:
    return tuple(
        (key, value)
        for key, value in (
            (DIFY_TRACE_ID_ATTRIBUTE, execution_context.trace_id),
            (DIFY_TENANT_ID_ATTRIBUTE, execution_context.tenant_id),
            (DIFY_APP_ID_ATTRIBUTE, execution_context.app_id),
            (DIFY_AGENT_ID_ATTRIBUTE, execution_context.agent_id),
            (GEN_AI_USER_ID_ATTRIBUTE, execution_context.user_id),
            (DIFY_INVOKE_FROM_ATTRIBUTE, execution_context.invoke_from),
            (DIFY_CONVERSATION_ID_ATTRIBUTE, execution_context.conversation_id),
            (DIFY_WORKFLOW_ID_ATTRIBUTE, execution_context.workflow_id),
            (DIFY_WORKFLOW_RUN_ID_ATTRIBUTE, execution_context.workflow_run_id),
            (DIFY_NODE_ID_ATTRIBUTE, execution_context.node_id),
            (DIFY_NODE_EXECUTION_ID_ATTRIBUTE, execution_context.node_execution_id),
        )
        if value
    )


@dataclass(frozen=True)
class IsolatedTracerProvider(TracerProvider):
    client: Logfire
    preserve_external_parent: bool = False

    def get_tracer(
        self,
        instrumenting_module_name: str,
        instrumenting_library_version: str | None = None,
        schema_url: str | None = None,
        attributes: Attributes = None,
    ) -> Tracer:
        delegate = self.client.config.get_tracer_provider().get_tracer(
            instrumenting_module_name,
            instrumenting_library_version,
            schema_url=schema_url,
            attributes=attributes,
        )
        return _IsolatedTracer(delegate, self.client, self.preserve_external_parent)


@dataclass(frozen=True)
class _IsolatedTracer(Tracer):
    delegate: Tracer
    client: Logfire
    preserve_external_parent: bool

    def _parent_context(self, context: Context | None) -> Context | None:
        parent = get_current_span(context)
        if not parent.get_span_context().is_valid:
            return context
        if isinstance(parent, ReadableSpan):
            instance_id = self.client.resource_attributes.get("service.instance.id")
            if instance_id is not None and parent.resource.attributes.get("service.instance.id") == instance_id:
                return context
        elif self.preserve_external_parent:
            return context
        return set_span_in_context(INVALID_SPAN, context)

    def start_span(
        self,
        name: str,
        context: Context | None = None,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Attributes = None,
        links: Sequence[Link] | None = None,
        start_time: int | None = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
    ) -> Span:
        return self.delegate.start_span(
            name,
            context=self._parent_context(context),
            kind=kind,
            attributes=attributes,
            links=links,
            start_time=start_time,
            record_exception=record_exception,
            set_status_on_exception=set_status_on_exception,
        )

    def start_as_current_span(
        self,
        name: str,
        context: Context | None = None,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Attributes = None,
        links: Sequence[Link] | None = None,
        start_time: int | None = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
        end_on_exit: bool = True,
    ):
        return self.delegate.start_as_current_span(
            name,
            context=self._parent_context(context),
            kind=kind,
            attributes=attributes,
            links=links,
            start_time=start_time,
            record_exception=record_exception,
            set_status_on_exception=set_status_on_exception,
            end_on_exit=end_on_exit,
        )


@dataclass(frozen=True)
class RunScopedTracerProvider(TracerProvider):
    """Stamp one run's fixed attributes on every span a delegate provider creates."""

    delegate: TracerProvider
    attributes: tuple[tuple[str, str], ...]

    def get_tracer(
        self,
        instrumenting_module_name: str,
        instrumenting_library_version: str | None = None,
        schema_url: str | None = None,
        attributes: Attributes = None,
    ) -> Tracer:
        delegate = self.delegate.get_tracer(
            instrumenting_module_name,
            instrumenting_library_version,
            schema_url=schema_url,
            attributes=attributes,
        )
        return _RunScopedTracer(delegate, self.attributes)


@dataclass(frozen=True)
class _RunScopedTracer(Tracer):
    delegate: Tracer
    attributes: tuple[tuple[str, str], ...]

    def _run_attributes(self, attributes: Attributes) -> Attributes:
        return {**(attributes or {}), **dict(self.attributes)}

    def start_span(
        self,
        name: str,
        context: Context | None = None,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Attributes = None,
        links: Sequence[Link] | None = None,
        start_time: int | None = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
    ) -> Span:
        return self.delegate.start_span(
            name,
            context=context,
            kind=kind,
            attributes=self._run_attributes(attributes),
            links=links,
            start_time=start_time,
            record_exception=record_exception,
            set_status_on_exception=set_status_on_exception,
        )

    def start_as_current_span(
        self,
        name: str,
        context: Context | None = None,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Attributes = None,
        links: Sequence[Link] | None = None,
        start_time: int | None = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
        end_on_exit: bool = True,
    ):
        return self.delegate.start_as_current_span(
            name,
            context=context,
            kind=kind,
            attributes=self._run_attributes(attributes),
            links=links,
            start_time=start_time,
            record_exception=record_exception,
            set_status_on_exception=set_status_on_exception,
            end_on_exit=end_on_exit,
        )


@dataclass(frozen=True, slots=True)
class AgentObservability:
    client: Logfire
    include_content: bool = False
    trace_context_mode: Literal["isolated", "shared"] = "isolated"

    def instrument(
        self,
        agent: Agent[Any, Any],
        *,
        execution_context: DifyExecutionContextLayerConfig | None = None,
    ) -> None:
        """Instrument one run's agent and attribute its spans to its Dify context.

        ``execution_context`` is the run's Dify identity and correlation context.
        Its Data Push-aligned attributes are attached to every span the
        instrumented agent produces; see ``dify_run_attributes``. Runs without an
        execution context are still instrumented, just without Dify attribution.
        """
        self.client.instrument_pydantic_ai(
            agent,
            include_content=self.include_content,
            include_binary_content=False,
            tracer_provider=self._tracer_provider(execution_context),
        )

    def _tracer_provider(self, execution_context: DifyExecutionContextLayerConfig | None) -> TracerProvider:
        provider: TracerProvider = (
            IsolatedTracerProvider(self.client)
            if self.trace_context_mode == "isolated"
            else self.client.config.get_tracer_provider()
        )
        if execution_context is None:
            return provider
        run_attributes = dify_run_attributes(execution_context)
        if not run_attributes:
            return provider
        return RunScopedTracerProvider(provider, run_attributes)

    async def aclose(self) -> None:
        """Flush and tear down this instance's own export pipeline.

        The owning scope closes the instance; shutdown is blocking, so it runs off
        the event loop. This only affects the Agent pipeline and leaves the
        platform Logfire instance running.
        """
        await asyncio.to_thread(self.client.shutdown, timeout_millis=5000)


__all__ = [
    "DIFY_AGENT_ID_ATTRIBUTE",
    "DIFY_APP_ID_ATTRIBUTE",
    "DIFY_CONVERSATION_ID_ATTRIBUTE",
    "DIFY_INVOKE_FROM_ATTRIBUTE",
    "DIFY_NODE_EXECUTION_ID_ATTRIBUTE",
    "DIFY_NODE_ID_ATTRIBUTE",
    "DIFY_TENANT_ID_ATTRIBUTE",
    "DIFY_TRACE_ID_ATTRIBUTE",
    "DIFY_WORKFLOW_ID_ATTRIBUTE",
    "DIFY_WORKFLOW_RUN_ID_ATTRIBUTE",
    "GEN_AI_USER_ID_ATTRIBUTE",
    "AgentObservability",
    "IsolatedTracerProvider",
    "RunScopedTracerProvider",
    "dify_run_attributes",
]
