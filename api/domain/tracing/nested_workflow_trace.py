"""Place the trace of a nested workflow run in the trace of the run that started it.

A nested run joins the trace of the run whose tool node started it when both
export to the same destination, and its root hangs from that tool node. That
outer run joined the trace above it by the same rule, so the joined trace is the
outermost one reachable through runs sharing the destination. A run whose spans
are collected for Agent tracing is always the root of its own trace. Every
identifier is derived from committed records, so the units need no coordination.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from dify_trace_sdk.model import SpanRef, Trace


@dataclass(frozen=True, slots=True)
class OuterTrace:
    """The trace an outer run's spans go to when that run is the root of its trace."""

    trace_id: str
    external_trace_id: str | None
    """The caller-supplied trace ID the trace's root unit carries."""
    root: SpanRef
    same_destination: bool
    """Whether the nested run exports to the destination this trace goes to."""
    collected: bool
    """Whether the run's spans are collected for Agent tracing, which keeps it the root of its trace."""


@dataclass(frozen=True, slots=True)
class TracePlacement:
    """Where the trace of a nested run hangs in an outer trace."""

    trace_id: str
    external_trace_id: str | None
    parent: SpanRef
    trace_root: SpanRef

    def place(self, trace: Trace) -> Trace:
        """``trace`` as a unit of the outer trace, its root hanging from ``parent``."""
        root, *spans = trace.spans
        return Trace(
            trace_id=self.trace_id,
            external_trace_id=self.external_trace_id,
            session_id=trace.session_id,
            user_id=trace.user_id,
            parent=self.parent,
            trace_root=self.trace_root,
            spans=(root.model_copy(update={"parent_span_id": self.parent.span_id}), *spans),
        )


def nested_trace_placement(outer_traces: Iterable[OuterTrace], *, tool_node: SpanRef) -> TracePlacement | None:
    """Where the trace of a nested run hangs; ``None`` when it starts a trace of its own.

    ``outer_traces`` follows the runs that started the nested run, innermost
    first, and ends at the first run whose trace is not known yet. It is consumed
    only as far as the decision needs. ``tool_node`` is the span of the tool node
    that started the nested run.
    """
    joined: OuterTrace | None = None
    for outer in outer_traces:
        if not outer.same_destination:
            break
        joined = outer
        if outer.collected:
            break
    if joined is None:
        return None
    return TracePlacement(
        trace_id=joined.trace_id, external_trace_id=joined.external_trace_id, parent=tool_node, trace_root=joined.root
    )
