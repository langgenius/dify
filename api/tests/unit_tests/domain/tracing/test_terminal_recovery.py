from dataclasses import replace
from datetime import datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan

from domain.tracing.errors import TraceRunError
from domain.tracing.sources import MessageProgress, SourceWorkflowRun
from domain.tracing.terminal_recovery import message_terminal_due, workflow_terminal_due
from domain.tracing.trace_run_agg import TraceRunAgg

COMMITTED = datetime(2026, 10, 1, 12, 0, 0)
TIMEOUT = 60
POLICY: dict[str, object] = {"enabled": True, "tracing_provider": "langfuse", "capture_agent": True}


def identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def collecting(policy: dict[str, object]) -> TraceRunAgg:
    return TraceRunAgg.freeze(
        run_id=str(uuid4()),
        trace_id=uuid4().hex,
        tenant_id=identifier("tenant"),
        app_id=identifier("app"),
        source_kind="message",
        source_id=identifier("message"),
        session_id="session",
        policy=policy,
        stored_config={"host": "https://langfuse.test"},
        now=COMMITTED,
    )


def with_invocation(run: TraceRunAgg, *, finalized_at: datetime | None) -> TraceRunAgg:
    """The run with one Agent invocation, finalized at ``finalized_at`` unless that is ``None``."""
    opened = run.open_invocation(agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key="k")
    if finalized_at is not None:
        payload = AgentTraceBatch(
            run_id=UUID(run.id),
            invocation_id=UUID(opened.id),
            batch_id=uuid4(),
            final=True,
            spans=[
                AgentTraceSpan(
                    trace_id=run.trace_id,
                    span_id="a" * 16,
                    parent_span_id=opened.span_id,
                    name="Agent execution",
                    start_time_ns=1_000_000_000,
                    end_time_ns=2_000_000_000,
                    status="ok",
                )
            ],
        )
        run.ingest(payload, max_spans=100, max_bytes=1_000_000, now=finalized_at)
    return run


PROGRESS = MessageProgress(
    message_id=identifier("message"),
    conversation_id=identifier("conversation"),
    agent_app=True,
    paused=False,
    explicit_error=False,
    answer_saved=True,
    agent_stop_requested=False,
    updated_at=COMMITTED,
)


def due(run: TraceRunAgg, progress: MessageProgress, after: timedelta) -> bool:
    return message_terminal_due(run, progress, now=COMMITTED + after, collection_timeout=TIMEOUT)


class TestMessageTerminal:
    @staticmethod
    def test_saved_answer_is_the_terminal_once_it_settles() -> None:
        run = with_invocation(collecting(POLICY), finalized_at=COMMITTED)

        assert due(run, PROGRESS, timedelta(seconds=4)) is False
        assert due(run, PROGRESS, timedelta(seconds=5)) is True
        assert due(run, replace(PROGRESS, answer_saved=False, explicit_error=True), timedelta(seconds=5)) is True

    @staticmethod
    def test_paused_message_waits_unless_an_agent_stop_is_pending() -> None:
        run = with_invocation(collecting(POLICY), finalized_at=COMMITTED)
        paused = replace(PROGRESS, paused=True)

        assert due(run, paused, timedelta(minutes=5)) is False
        with pytest.raises(TraceRunError, match="business_terminal_not_persisted"):
            due(run, replace(paused, agent_stop_requested=True), timedelta(seconds=TIMEOUT + 1))

    @staticmethod
    def test_unfinished_invocation_waits_until_a_failed_message_times_out() -> None:
        run = with_invocation(collecting(POLICY), finalized_at=None)

        assert due(run, PROGRESS, timedelta(minutes=5)) is False
        assert due(run, replace(PROGRESS, explicit_error=True), timedelta(seconds=TIMEOUT)) is False
        with pytest.raises(TraceRunError, match="agent_trace_collection_incomplete"):
            due(run, replace(PROGRESS, explicit_error=True), timedelta(seconds=TIMEOUT + 1))

    @staticmethod
    def test_pending_agent_stop_waits_for_the_worker_handoff_until_its_deadline() -> None:
        run = with_invocation(collecting(POLICY), finalized_at=COMMITTED + timedelta(seconds=10))
        stopping = replace(PROGRESS, agent_stop_requested=True)

        assert due(run, stopping, timedelta(seconds=10 + TIMEOUT)) is False
        with pytest.raises(TraceRunError, match="business_terminal_not_persisted"):
            due(run, stopping, timedelta(seconds=10 + TIMEOUT + 1))

    @staticmethod
    def test_agent_capture_waits_for_its_first_invocation() -> None:
        assert due(collecting(POLICY), PROGRESS, timedelta(minutes=5)) is False
        assert due(collecting({**POLICY, "capture_agent": False}), PROGRESS, timedelta(minutes=5)) is True

    @staticmethod
    def test_usage_flush_without_the_final_answer_never_becomes_a_terminal() -> None:
        run = with_invocation(collecting(POLICY), finalized_at=COMMITTED)
        unsaved = replace(PROGRESS, answer_saved=False)

        assert due(run, unsaved, timedelta(seconds=TIMEOUT)) is False
        with pytest.raises(TraceRunError, match="business_terminal_not_persisted"):
            due(run, unsaved, timedelta(seconds=TIMEOUT + 1))


class TestWorkflowTerminal:
    @staticmethod
    @pytest.mark.parametrize(
        ("status", "finished_offset", "settled"),
        [
            ("running", None, False),
            ("succeeded", None, False),
            ("succeeded", timedelta(seconds=-4), False),
            ("succeeded", timedelta(seconds=-5), True),
            ("partial-succeeded", timedelta(seconds=-5), True),
            ("failed", timedelta(seconds=-5), True),
            ("stopped", timedelta(seconds=-5), True),
        ],
    )
    def test_workflow_run_is_the_terminal_once_it_finished_and_settled(
        status: str, finished_offset: timedelta | None, settled: bool
    ) -> None:
        workflow = SourceWorkflowRun(
            id=identifier("workflow-run"),
            workflow_id=identifier("workflow"),
            graph=None,
            status=status,
            finished_at=COMMITTED + finished_offset if finished_offset is not None else None,
            created_by=identifier("account"),
        )

        assert workflow_terminal_due(workflow, now=COMMITTED) is settled
