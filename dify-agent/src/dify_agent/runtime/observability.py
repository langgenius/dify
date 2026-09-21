"""Runtime-facing boundary for the opt-in Agent observability instance."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

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


@dataclass(frozen=True, slots=True)
class AgentObservability:
    client: Logfire
    include_content: bool = False
    trace_context_mode: Literal["isolated", "shared"] = "isolated"

    def instrument(self, agent: Agent[Any, Any]) -> None:
        self.client.instrument_pydantic_ai(
            agent,
            include_content=self.include_content,
            include_binary_content=False,
            tracer_provider=(
                # NOTE: Be EXTREMELY careful about this
                # data leakage risk if shared mode is used
                IsolatedTracerProvider(self.client)
                if self.trace_context_mode == "isolated"
                else self.client.config.get_tracer_provider()
            ),
        )


__all__ = ["AgentObservability", "IsolatedTracerProvider"]
