from datetime import datetime

import pytest
from pydantic import ValidationError

from core.helper.trace_id_helper import ParentTraceContext
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace


def span(span_id: str, parent_id: str | None = None) -> CanonicalSpan:
    return CanonicalSpan(
        id=span_id,
        parent_id=parent_id,
        name=span_id,
        kind=CanonicalSpanKind.CHAIN,
        start_time=datetime(2025, 1, 1),
        end_time=None,
        status=CanonicalSpanStatus.OK,
    )


def test_canonical_trace_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        CanonicalTrace(
            trace_id="trace-1",
            session_id="session-1",
            root_span_id="root-1",
            spans=(),
            unknown=True,  # pyrefly: ignore[unexpected-keyword]
        )


def test_canonical_span_supports_links() -> None:
    linked_span = CanonicalSpan(
        id="linked-1",
        parent_id="message-2",
        name="linked",
        kind=CanonicalSpanKind.CHAIN,
        start_time=datetime(2025, 1, 1),
        end_time=None,
        status=CanonicalSpanStatus.OK,
        links=("message-1",),
    )

    assert linked_span.links == ("message-1",)


@pytest.mark.parametrize(
    ("root_span_id", "spans"),
    [
        ("missing", (span("root"),)),
        ("root", (span("root"), span("root", "root"))),
        ("root", (span("root", "outside"),)),
        ("root", (span("root"), span("child"))),
        ("root", (span("root"), span("child", "later"), span("later", "root"))),
    ],
)
def test_canonical_trace_rejects_invalid_fragment(
    root_span_id: str,
    spans: tuple[CanonicalSpan, ...],
) -> None:
    with pytest.raises(ValidationError):
        CanonicalTrace(
            trace_id="trace-1",
            session_id="session-1",
            root_span_id=root_span_id,
            spans=spans,
        )


def test_canonical_trace_rejects_conflicting_external_parent_modes() -> None:
    with pytest.raises(ValidationError):
        CanonicalTrace(
            trace_id="trace-1",
            session_id="session-1",
            root_span_id="root",
            spans=(span("root"),),
            external_parent=ParentTraceContext(
                parent_workflow_run_id="outer-run",
                parent_node_execution_id="outer-node",
            ),
            required_parent_context_id="message-1",
        )


def test_canonical_span_is_immutable() -> None:
    span = CanonicalSpan(
        id="span-1",
        parent_id=None,
        name="root",
        kind=CanonicalSpanKind.CHAIN,
        start_time=datetime(2025, 1, 1),
        end_time=None,
        status=CanonicalSpanStatus.OK,
    )

    assert span.publishes_parent_context is False

    trace = CanonicalTrace(
        trace_id="trace-1",
        session_id="session-1",
        root_span_id=span.id,
        spans=(span,),
    )
    assert trace.required_parent_context_id is None

    with pytest.raises(ValidationError):
        span.name = "changed"  # pyrefly: ignore[read-only]
