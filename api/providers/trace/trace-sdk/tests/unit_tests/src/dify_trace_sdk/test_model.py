from datetime import UTC, datetime, timedelta

import pytest
from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import Cost, Span, SpanKind, SpanRef, SpanStatus, Trace
from pydantic import ValidationError

STARTED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def _span(span_id: str, parent_span_id: str | None) -> Span:
    return Span(
        span_id=span_id,
        parent_span_id=parent_span_id,
        name="step",
        kind=SpanKind.CHAIN,
        start_time=STARTED_AT,
        end_time=STARTED_AT + timedelta(seconds=1),
        status=SpanStatus.OK,
    )


def test_naive_datetimes_are_read_as_utc() -> None:
    span = Span(
        span_id=span_id_for("a"),
        parent_span_id=None,
        name="step",
        kind=SpanKind.CHAIN,
        start_time=datetime(2026, 1, 1, 8, 0),
        end_time=datetime(2026, 1, 1, 8, 1),
        status=SpanStatus.OK,
    )
    assert span.start_time == datetime(2026, 1, 1, 8, 0, tzinfo=UTC)


def test_span_rejects_end_before_start_and_invalid_ids() -> None:
    with pytest.raises(ValidationError):
        Span(
            span_id=span_id_for("a"),
            parent_span_id=None,
            name="step",
            kind=SpanKind.CHAIN,
            start_time=STARTED_AT,
            end_time=STARTED_AT - timedelta(seconds=1),
            status=SpanStatus.OK,
        )
    with pytest.raises(ValidationError):
        _span("0" * 16, None)
    with pytest.raises(ValidationError):
        _span("ABCDEF0123456789", None)


def test_trace_requires_parent_first_order() -> None:
    root, child = span_id_for("root"), span_id_for("child")
    with pytest.raises(ValidationError, match="must follow its parent"):
        Trace(
            trace_id=trace_id_for("t"),
            external_trace_id=None,
            session_id=None,
            user_id=None,
            parent=None,
            trace_root=None,
            spans=(_span(root, None), _span(span_id_for("orphan"), child)),
        )
    with pytest.raises(ValidationError, match="root of this unit"):
        Trace(
            trace_id=trace_id_for("t"),
            external_trace_id=None,
            session_id=None,
            user_id=None,
            parent=None,
            trace_root=None,
            spans=(_span(child, root),),
        )


def test_fragment_root_must_point_at_its_external_parent() -> None:
    parent = SpanRef(span_id=span_id_for("message"), start_time=STARTED_AT)
    with pytest.raises(ValidationError, match="root of this unit"):
        Trace(
            trace_id=trace_id_for("t"),
            external_trace_id=None,
            session_id=None,
            user_id=None,
            parent=parent,
            trace_root=parent,
            spans=(_span(span_id_for("tool"), None),),
        )


def test_fragment_names_its_parent_and_the_root_of_its_trace_together() -> None:
    trace_root = SpanRef(span_id=span_id_for("workflow"), start_time=STARTED_AT)
    tool_node = SpanRef(span_id=span_id_for("tool-node"), start_time=STARTED_AT)
    nested = _span(span_id_for("nested-workflow"), tool_node.span_id)

    def fragment(parent: SpanRef | None, root: SpanRef | None, spans: tuple[Span, ...]) -> Trace:
        return Trace(
            trace_id=trace_id_for("t"),
            external_trace_id=None,
            session_id=None,
            user_id=None,
            parent=parent,
            trace_root=root,
            spans=spans,
        )

    assert fragment(tool_node, trace_root, (nested,)).trace_root == trace_root
    with pytest.raises(ValidationError, match="set together"):
        fragment(tool_node, None, (nested,))
    with pytest.raises(ValidationError, match="set together"):
        fragment(None, trace_root, (_span(span_id_for("root"), None),))
    with pytest.raises(ValidationError, match="trace root cannot be a span of this unit"):
        fragment(tool_node, SpanRef(span_id=nested.span_id, start_time=STARTED_AT), (nested,))


def test_cost_must_be_finite() -> None:
    with pytest.raises(ValidationError):
        Cost(amount=float("inf"), currency="USD")


@pytest.mark.parametrize(
    "fields",
    [
        {"inputs": {"score": float("nan")}},
        {"outputs": [1.0, float("inf")]},
        {"attributes": {"ratio": float("-inf")}},
        {"time_to_first_token": float("inf")},
    ],
)
def test_spans_reject_numbers_strict_json_cannot_carry(fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Span.model_validate(
            {
                "span_id": span_id_for("a"),
                "parent_span_id": None,
                "name": "step",
                "kind": SpanKind.CHAIN,
                "start_time": STARTED_AT,
                "end_time": STARTED_AT,
                "status": SpanStatus.OK,
                **fields,
            }
        )
