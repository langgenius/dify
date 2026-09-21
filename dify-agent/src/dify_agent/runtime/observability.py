"""Runtime-facing boundary for the opt-in Agent observability instance.

Trajectory spans carry the Dify owners of the run so a trace can be attributed
to a workspace and an Agent without joining other Dify data. The tenant and
Agent ids are stamped on every span of one run through a tracer wrapper, because
the run span is not the only span a trajectory consumer filters or aggregates on.
"""

from __future__ import annotations

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

if TYPE_CHECKING:
    from logfire import Logfire
    from pydantic_ai import Agent

DIFY_TENANT_ID_ATTRIBUTE: Final[str] = "dify.tenant_id"
DIFY_AGENT_ID_ATTRIBUTE: Final[str] = "dify.agent_id"


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

    def instrument(self, agent: Agent[Any, Any], *, tenant_id: str | None = None, agent_id: str | None = None) -> None:
        """Instrument one run's agent and attribute its spans to the Dify owners.

        ``tenant_id`` and ``agent_id`` identify the Dify workspace and Agent that
        own the run. They are attached to every span the instrumented agent
        produces, because the run span is not the only span a trajectory consumer
        filters or aggregates on. Blank identifiers are omitted rather than
        exported as empty attributes.
        """
        self.client.instrument_pydantic_ai(
            agent,
            include_content=self.include_content,
            include_binary_content=False,
            tracer_provider=self._tracer_provider(tenant_id=tenant_id, agent_id=agent_id),
        )

    def _tracer_provider(self, *, tenant_id: str | None, agent_id: str | None) -> TracerProvider:
        provider: TracerProvider = (
            # NOTE: Be EXTREMELY careful about this
            # data leakage risk if shared mode is used
            IsolatedTracerProvider(self.client)
            if self.trace_context_mode == "isolated"
            else self.client.config.get_tracer_provider()
        )
        run_attributes = tuple(
            (key, value)
            for key, value in ((DIFY_TENANT_ID_ATTRIBUTE, tenant_id), (DIFY_AGENT_ID_ATTRIBUTE, agent_id))
            if value
        )
        if not run_attributes:
            return provider
        return RunScopedTracerProvider(provider, run_attributes)


__all__ = [
    "DIFY_AGENT_ID_ATTRIBUTE",
    "DIFY_TENANT_ID_ATTRIBUTE",
    "AgentObservability",
    "IsolatedTracerProvider",
    "RunScopedTracerProvider",
]
