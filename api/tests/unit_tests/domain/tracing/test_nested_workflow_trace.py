from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import Span, SpanKind, SpanRef, SpanStatus, Trace

from domain.tracing.nested_workflow_trace import OuterTrace, TracePlacement, nested_trace_placement

STARTED_AT = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)
TOOL_NODE = SpanRef(span_id=span_id_for("outer-tool-node"), start_time=STARTED_AT + timedelta(seconds=2))


def outer(run: str, *, same_destination: bool = True, collected: bool = False) -> OuterTrace:
    return OuterTrace(
        trace_id=trace_id_for(run),
        external_trace_id=f"{run}-caller",
        root=SpanRef(span_id=span_id_for(run), start_time=STARTED_AT),
        same_destination=same_destination,
        collected=collected,
    )


def joined(run: str) -> TracePlacement:
    return TracePlacement(
        trace_id=trace_id_for(run),
        external_trace_id=f"{run}-caller",
        parent=TOOL_NODE,
        trace_root=SpanRef(span_id=span_id_for(run), start_time=STARTED_AT),
    )


def span(span_id: str, parent_span_id: str | None) -> Span:
    return Span(
        span_id=span_id,
        parent_span_id=parent_span_id,
        name="workflow",
        kind=SpanKind.CHAIN,
        start_time=STARTED_AT + timedelta(seconds=3),
        end_time=STARTED_AT + timedelta(seconds=4),
        status=SpanStatus.OK,
    )


class TestNestedTracePlacement:
    @staticmethod
    def test_nested_run_hangs_from_the_tool_node_in_the_trace_of_its_outer_run() -> None:
        assert nested_trace_placement([outer("parent")], tool_node=TOOL_NODE) == joined("parent")

    @staticmethod
    def test_outer_runs_sharing_the_destination_join_the_outermost_trace() -> None:
        placement = nested_trace_placement([outer("parent"), outer("grandparent")], tool_node=TOOL_NODE)

        assert placement == joined("grandparent")

    @staticmethod
    def test_an_outer_run_exporting_elsewhere_starts_the_trace_below_it() -> None:
        assert nested_trace_placement(
            [outer("parent"), outer("grandparent", same_destination=False)], tool_node=TOOL_NODE
        ) == joined("parent")
        assert (
            nested_trace_placement([outer("parent", same_destination=False), outer("grandparent")], tool_node=TOOL_NODE)
            is None
        )

    @staticmethod
    def test_a_collected_outer_run_is_the_root_of_its_trace() -> None:
        placement = nested_trace_placement([outer("parent", collected=True), outer("grandparent")], tool_node=TOOL_NODE)

        assert placement == joined("parent")

    @staticmethod
    def test_a_nested_run_without_a_known_outer_trace_starts_its_own() -> None:
        assert nested_trace_placement([], tool_node=TOOL_NODE) is None

    @staticmethod
    def test_outer_runs_are_read_only_as_far_as_the_decision_needs() -> None:
        def outer_traces() -> Iterator[OuterTrace]:
            yield outer("parent", same_destination=False)
            raise AssertionError("the run above an outer run exporting elsewhere was read")

        assert nested_trace_placement(outer_traces(), tool_node=TOOL_NODE) is None


class TestTracePlacement:
    @staticmethod
    def test_placed_trace_hangs_its_root_from_the_tool_node_of_the_outer_trace() -> None:
        root_span_id, node_span_id = span_id_for("nested-run"), span_id_for("nested-node")
        trace = Trace(
            trace_id=trace_id_for("nested-run"),
            external_trace_id=None,
            session_id="session",
            user_id="account",
            parent=None,
            trace_root=None,
            spans=(span(root_span_id, None), span(node_span_id, root_span_id)),
        )

        placed = joined("parent").place(trace)

        assert placed.trace_id == trace_id_for("parent")
        assert placed.external_trace_id == "parent-caller"
        assert (placed.session_id, placed.user_id) == ("session", "account")
        assert placed.parent == TOOL_NODE
        assert placed.trace_root == SpanRef(span_id=span_id_for("parent"), start_time=STARTED_AT)
        assert [(item.span_id, item.parent_span_id) for item in placed.spans] == [
            (root_span_id, TOOL_NODE.span_id),
            (node_span_id, root_span_id),
        ]
