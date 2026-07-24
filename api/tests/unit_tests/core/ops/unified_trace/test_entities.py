from datetime import datetime

import pytest
from pydantic import ValidationError

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace


def test_canonical_trace_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        CanonicalTrace(
            trace_id="trace-1",
            session_id="session-1",
            root_span_id="root-1",
            spans=(),
            unknown=True,
        )


def test_canonical_span_is_immutable():
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
        span.name = "changed"
