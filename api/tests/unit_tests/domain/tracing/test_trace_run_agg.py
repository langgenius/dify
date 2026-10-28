from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceEvent, AgentTraceSpan
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace

from domain.tracing.errors import TraceRunConflictError, TraceRunError, TraceRunLimitError, TraceRunNotFoundError
from domain.tracing.sources import SourceNodeExecution
from domain.tracing.trace_run_agg import TraceBatch, TraceInvocation, TraceRunAgg, TraceRunState, TraceSourceKind

NOW = datetime(2026, 10, 1, 12, 0, 0)
POLICY: dict[str, object] = {
    "enabled": True,
    "tracing_provider": "langfuse",
    "capture_content": False,
    "capture_agent": True,
}
CONFIG: dict[str, object] = {"public_key": "enc:public", "secret_key": "enc:secret", "host": "https://langfuse.test"}


def identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def frozen(
    *,
    source_kind: TraceSourceKind = "message",
    policy: dict[str, object] = POLICY,
    config: dict[str, object] | None = CONFIG,
) -> TraceRunAgg:
    return TraceRunAgg.freeze(
        run_id=str(uuid4()),
        trace_id=uuid4().hex,
        tenant_id=identifier("tenant"),
        app_id=identifier("app"),
        source_kind=source_kind,
        source_id=identifier("source"),
        session_id="session",
        policy=policy,
        stored_config=config,
        now=NOW,
    )


def invocation(run: TraceRunAgg, call_key: str = "first") -> TraceInvocation:
    return run.open_invocation(agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key=call_key)


def batch(
    run: TraceRunAgg,
    opened: TraceInvocation,
    *,
    final: bool = True,
    batch_id: UUID | None = None,
    name: str = "Agent execution",
    status: str = "ok",
) -> dict[str, object]:
    """The JSON form of a runtime batch, as the service hands it to the run."""
    return AgentTraceBatch(
        run_id=UUID(run.id),
        invocation_id=UUID(opened.id),
        batch_id=batch_id or uuid4(),
        final=final,
        spans=[
            AgentTraceSpan(
                trace_id=run.trace_id,
                span_id="a" * 16,
                parent_span_id=opened.span_id,
                name=name,
                start_time_ns=1_000_000_000,
                end_time_ns=2_000_000_000,
                status="error" if status == "error" else "ok",
                status_message="provider said no" if status == "error" else None,
                attributes={"gen_ai.operation.name": "invoke_agent", "gen_ai.input.messages": "private prompt"},
                events=[AgentTraceEvent(name="token", timestamp_ns=1_500_000_000)],
            )
        ],
    ).model_dump(mode="json")


def ingest(run: TraceRunAgg, payload: Mapping[str, object], *, now: datetime = NOW) -> int:
    return run.ingest(payload, max_spans=100, max_bytes=1_000_000, now=now)


def business_terminal(run: TraceRunAgg) -> Trace:
    """A message's canonical trace: its root span and the LLM span the Agent runtime replaces."""
    started = datetime.fromtimestamp(0, UTC)
    return Trace(
        trace_id="f" * 32,
        external_trace_id="caller-trace",
        session_id="conversation",
        user_id="user",
        parent=None,
        trace_root=None,
        spans=(
            Span(
                span_id=span_id_for(run.source_id),
                parent_span_id=None,
                name="message",
                kind=SpanKind.CHAIN,
                start_time=started,
                end_time=started + timedelta(seconds=3),
                status=SpanStatus.ERROR,
                error="private failure",
                inputs={"query": "private question"},
                outputs="private answer",
                attributes={"app_id": run.app_id, "private": "value"},
            ),
            Span(
                span_id=span_id_for(f"{run.source_id}:llm"),
                parent_span_id=span_id_for(run.source_id),
                name="llm",
                kind=SpanKind.LLM,
                start_time=started,
                end_time=started + timedelta(seconds=3),
                status=SpanStatus.OK,
            ),
        ),
    )


def exportable(run: TraceRunAgg) -> TraceRunAgg:
    """Collect one final batch and the business terminal, so the run can be claimed."""
    ingest(run, batch(run, invocation(run)))
    run.capture_terminal(business_terminal(run), now=NOW)
    return run


def claimed(run: TraceRunAgg, *, now: datetime = NOW) -> str:
    token = str(uuid4())
    assert run.claim_export(token=token, owner_exists=True, collection_timeout=60, lease_seconds=30, now=now)
    return token


def not_claimed(run: TraceRunAgg, *, owner_exists: bool = True, now: datetime = NOW) -> bool:
    return not run.claim_export(
        token=str(uuid4()), owner_exists=owner_exists, collection_timeout=60, lease_seconds=30, now=now
    )


class TestFreezing:
    @staticmethod
    def test_collecting_run_freezes_the_destination_and_capture_policy() -> None:
        run = frozen(policy={**POLICY, "capture_content": True})

        assert run.state is TraceRunState.COLLECTING
        assert run.provider == "langfuse"
        assert run.provider_config == CONFIG
        assert run.capture_content is True
        assert run.capture_agent is True
        assert run.root_span_id == span_id_for(run.source_id)
        assert run.updated_at == NOW

    @staticmethod
    @pytest.mark.parametrize(
        ("policy", "config"),
        [
            ({**POLICY, "enabled": False}, CONFIG),
            ({**POLICY, "enabled": "true"}, CONFIG),
            ({**POLICY, "tracing_provider": None}, CONFIG),
            (POLICY, None),
            ({}, None),
        ],
    )
    def test_run_without_an_enabled_stored_destination_is_not_collected(
        policy: dict[str, object], config: dict[str, object] | None
    ) -> None:
        run = frozen(policy=policy, config=config)

        assert run.state is TraceRunState.NOT_COLLECTED
        assert run.provider == ""
        assert run.provider_config == {}
        assert run.capture_content is False
        assert run.capture_agent is False

    @staticmethod
    def test_revision_names_the_frozen_policy_and_configuration() -> None:
        assert frozen().config_revision == frozen().config_revision
        assert frozen().config_revision != frozen(config={**CONFIG, "host": "https://other.test"}).config_revision
        assert frozen().config_revision != frozen(policy={**POLICY, "capture_content": True}).config_revision

    @staticmethod
    def test_session_is_bounded_and_falls_back_to_the_source() -> None:
        long = TraceRunAgg.freeze(
            run_id=str(uuid4()),
            trace_id=uuid4().hex,
            tenant_id=identifier("tenant"),
            app_id=identifier("app"),
            source_kind="message",
            source_id=identifier("source"),
            session_id="s" * 300,
            policy=POLICY,
            stored_config=CONFIG,
            now=NOW,
        )
        empty = TraceRunAgg.freeze(
            run_id=str(uuid4()),
            trace_id=uuid4().hex,
            tenant_id=identifier("tenant"),
            app_id=identifier("app"),
            source_kind="message",
            source_id=identifier("source"),
            session_id="",
            policy=POLICY,
            stored_config=CONFIG,
            now=NOW,
        )

        assert long.session_id == "s" * 255
        assert empty.session_id == identifier("source")

    @staticmethod
    def test_initialization_failure_closes_the_source_without_a_destination() -> None:
        run = TraceRunAgg.initialization_failed(
            run_id=str(uuid4()),
            trace_id=uuid4().hex,
            tenant_id=identifier("tenant"),
            app_id=identifier("app"),
            source_kind="workflow",
            source_id=identifier("source"),
            now=NOW,
        )

        assert run.state is TraceRunState.FAILED
        assert run.error_code == "tracing_initialization_failed"
        assert run.terminal_at == NOW
        assert (run.provider, run.config_revision, run.provider_config) == ("", "", {})
        assert not run.capture_content
        assert not run.capture_agent
        assert not_claimed(run)


class TestInvocations:
    @staticmethod
    def test_call_key_names_one_invocation_under_its_parent_span() -> None:
        run = frozen()
        app_invocation = invocation(run)
        node_invocation = run.open_invocation(
            agent_id=identifier("agent"), node_execution_id=identifier("node"), attempt=1, call_key="node:1"
        )

        assert invocation(run) == app_invocation
        assert app_invocation.id == str(uuid5(UUID(run.id), "first"))
        assert app_invocation.parent_span_id == run.root_span_id
        assert node_invocation.parent_span_id == span_id_for(identifier("node"))
        assert set(run.invocations) == {app_invocation.id, node_invocation.id}

    @staticmethod
    def test_repeated_call_key_keeps_its_agent_binding() -> None:
        run = frozen()
        invocation(run)

        with pytest.raises(TraceRunConflictError, match="tracing_invocation_conflict"):
            run.open_invocation(agent_id=identifier("other-agent"), node_execution_id=None, attempt=0, call_key="first")

    @staticmethod
    def test_invocations_open_only_while_the_run_collects() -> None:
        not_collected = frozen(config=None)
        exporting = exportable(frozen())
        claimed(exporting)

        for run in (not_collected, exporting):
            with pytest.raises(TraceRunConflictError, match="tracing_run_not_collecting"):
                invocation(run, "late")


class TestIngestion:
    @staticmethod
    def test_final_batch_is_stored_and_finalizes_its_invocation() -> None:
        run = frozen()
        opened = invocation(run)
        payload = batch(run, opened)

        assert ingest(run, payload) == 1

        (stored,) = run.new_batches
        assert (stored.id, stored.invocation_id, stored.final) == (payload["batch_id"], opened.id, True)
        assert run.receipts[stored.id].payload_hash == stored.payload_hash
        assert run.span_count == 1
        assert run.payload_bytes > 0
        assert run.invocations[opened.id].finalized is True
        assert run.invocations[opened.id].finalized_at == NOW

    @staticmethod
    def test_replayed_batch_is_accepted_again_after_the_run_closed() -> None:
        run = frozen()
        opened = invocation(run)
        payload = batch(run, opened)
        ingest(run, payload)
        run.capture_terminal(business_terminal(run), now=NOW)
        run.export_accepted(claimed(run), provider_trace_id="remote", trace_url=None, span_urls={}, now=NOW)

        assert ingest(run, payload) == 1
        assert len(run.new_batches) == 1
        assert run.span_count == 1

    @staticmethod
    def test_batch_id_replays_only_with_the_same_payload_and_invocation() -> None:
        run = frozen()
        opened = invocation(run)
        other = invocation(run, "second")
        payload = batch(run, opened, final=False)
        ingest(run, payload)
        batch_id = UUID(str(payload["batch_id"]))

        with pytest.raises(TraceRunConflictError, match="tracing_batch_conflict"):
            ingest(run, batch(run, opened, final=False, batch_id=batch_id, name="changed"))
        with pytest.raises(TraceRunConflictError, match="tracing_batch_conflict"):
            ingest(run, batch(run, other, final=False, batch_id=batch_id))
        assert run.span_count == 1

    @staticmethod
    def test_batch_of_an_unknown_invocation_is_not_found() -> None:
        run = frozen()
        foreign = invocation(frozen(), "first")

        with pytest.raises(TraceRunNotFoundError, match="tracing_invocation_not_found"):
            ingest(run, batch(run, foreign))

    @staticmethod
    def test_finalized_invocation_and_closed_run_accept_no_new_batch() -> None:
        run = frozen()
        opened = invocation(run)
        ingest(run, batch(run, opened))

        with pytest.raises(TraceRunConflictError, match="tracing_collection_closed"):
            ingest(run, batch(run, opened))

        closed = frozen()
        late = invocation(closed)
        closed.capture_terminal(business_terminal(closed), now=NOW)
        after_timeout = NOW + timedelta(seconds=61)
        assert not_claimed(closed, now=after_timeout)
        assert closed.state is TraceRunState.FAILED
        with pytest.raises(TraceRunConflictError, match="tracing_collection_closed"):
            ingest(closed, batch(closed, late), now=after_timeout)

    @staticmethod
    def test_spans_must_belong_to_the_run_trace() -> None:
        run = frozen()
        opened = invocation(run)
        foreign = AgentTraceBatch(
            run_id=UUID(run.id),
            invocation_id=UUID(opened.id),
            batch_id=uuid4(),
            final=True,
            spans=[
                AgentTraceSpan(
                    trace_id="e" * 32,
                    span_id="a" * 16,
                    parent_span_id=opened.span_id,
                    name="Agent execution",
                    start_time_ns=1_000_000_000,
                    end_time_ns=2_000_000_000,
                    status="ok",
                )
            ],
        )

        with pytest.raises(TraceRunConflictError, match="tracing_trace_id_mismatch"):
            ingest(run, foreign.model_dump(mode="json"))
        assert run.new_batches == []

    @staticmethod
    @pytest.mark.parametrize(("max_spans", "max_bytes"), [(0, 1_000_000), (100, 10)])
    def test_limits_reject_the_whole_batch(max_spans: int, max_bytes: int) -> None:
        run = frozen()
        opened = invocation(run)

        with pytest.raises(TraceRunLimitError, match="tracing_payload_limit"):
            run.ingest(batch(run, opened), max_spans=max_spans, max_bytes=max_bytes, now=NOW)

        assert run.new_batches == []
        assert (run.span_count, run.payload_bytes) == (0, 0)
        assert run.invocations[opened.id].finalized is False

    @staticmethod
    def test_content_off_stores_only_allowlisted_span_data() -> None:
        hidden = frozen()
        ingest(hidden, batch(hidden, invocation(hidden), status="error"))
        shown = frozen(policy={**POLICY, "capture_content": True})
        ingest(shown, batch(shown, invocation(shown), status="error"))

        (hidden_span,) = hidden.new_batches[0].spans
        (shown_span,) = shown.new_batches[0].spans
        assert hidden_span["attributes"] == {"gen_ai.operation.name": "invoke_agent"}
        assert hidden_span["events"] == []
        assert hidden_span["status_message"] == "Agent operation failed"
        assert shown_span["attributes"]["gen_ai.input.messages"] == "private prompt"
        assert len(shown_span["events"]) == 1
        assert shown_span["status_message"] == "provider said no"


class TestTerminal:
    @staticmethod
    def test_terminal_adopts_the_run_identity_and_capture_policy() -> None:
        run = frozen()

        run.capture_terminal(business_terminal(run), now=NOW)

        assert run.outer_trace is not None
        kept = Trace.model_validate(run.outer_trace)
        assert kept.trace_id == run.trace_id
        assert kept.session_id == "session"
        assert [span.name for span in kept.spans] == ["message"]
        (root,) = kept.spans
        assert (root.inputs, root.outputs) == (None, None)
        assert root.error == "Application execution failed"
        assert root.attributes == {"app_id": run.app_id, "external_trace_id": "caller-trace"}
        assert run.root_span_id == root.span_id
        assert run.terminal_at == NOW

    @staticmethod
    def test_first_terminal_wins() -> None:
        run = frozen()
        run.capture_terminal(business_terminal(run), now=NOW)
        first = run.outer_trace

        replacement = business_terminal(run).model_copy(update={"user_id": "someone else"})
        run.capture_terminal(replacement, now=NOW + timedelta(seconds=5))

        assert run.outer_trace == first
        assert run.terminal_at == NOW

    @staticmethod
    def test_closed_and_uncollected_runs_keep_no_terminal() -> None:
        uncollected = frozen(config=None)
        uncollected.capture_terminal(business_terminal(uncollected), now=NOW)
        failed = TraceRunAgg.initialization_failed(
            run_id=str(uuid4()),
            trace_id=uuid4().hex,
            tenant_id=identifier("tenant"),
            app_id=identifier("app"),
            source_kind="message",
            source_id=identifier("source"),
            now=NOW,
        )
        failed.capture_terminal(business_terminal(failed), now=NOW)

        assert uncollected.outer_trace is None
        assert failed.outer_trace is None

    @staticmethod
    @pytest.mark.parametrize("capture_content", [True, False])
    def test_finished_preview_node_becomes_the_terminal(capture_content: bool) -> None:
        run = frozen(source_kind="node", policy={**POLICY, "capture_content": capture_content})
        node = SourceNodeExecution(
            id=run.source_id,
            node_id="agent",
            workflow_id=None,
            workflow_run_id=None,
            title="Agent preview",
            status="running",
            error="private failure",
            inputs='{"query": "private"}',
            outputs=None,
            created_at=NOW,
            elapsed_time=2,
        )

        run.settle_preview(node, now=NOW)
        assert run.outer_trace is None

        run.settle_preview(
            SourceNodeExecution(
                id=node.id,
                node_id=node.node_id,
                workflow_id=None,
                workflow_run_id=None,
                title=node.title,
                status="failed",
                error=node.error,
                inputs=node.inputs,
                outputs=None,
                created_at=NOW,
                elapsed_time=2,
            ),
            now=NOW,
        )
        assert run.outer_trace is not None
        (span,) = Trace.model_validate(run.outer_trace).spans
        assert span.span_id == run.root_span_id
        assert span.end_time - span.start_time == timedelta(seconds=2)
        assert span.status is SpanStatus.ERROR
        assert span.error == ("private failure" if capture_content else "Node execution failed")
        assert span.inputs == ({"query": "private"} if capture_content else None)


class TestExport:
    @staticmethod
    def test_claim_waits_for_the_terminal_and_every_final_invocation() -> None:
        run = frozen()
        opened = invocation(run)
        ingest(run, batch(run, opened, final=False))
        assert not_claimed(run)

        run.capture_terminal(business_terminal(run), now=NOW)
        assert not_claimed(run)

        ingest(run, batch(run, opened))
        token = claimed(run)
        assert (run.state, run.export_token, run.attempts) == (TraceRunState.EXPORTING, token, 1)
        assert not_claimed(run)

    @staticmethod
    def test_incomplete_collection_fails_after_its_timeout() -> None:
        run = frozen()
        invocation(run)
        run.capture_terminal(business_terminal(run), now=NOW)

        later = NOW + timedelta(seconds=61)
        assert not_claimed(run, now=later)
        assert (run.state, run.error_code) == (TraceRunState.FAILED, "agent_trace_collection_incomplete")

    @staticmethod
    def test_run_whose_app_is_gone_fails_instead_of_exporting() -> None:
        run = exportable(frozen())

        assert not_claimed(run, owner_exists=False)
        assert (run.state, run.error_code, run.attempts) == (TraceRunState.FAILED, "tracing_owner_not_found", 0)

    @staticmethod
    def test_lease_renews_only_for_the_current_attempt() -> None:
        run = exportable(frozen())
        token = claimed(run)
        later = NOW + timedelta(seconds=20)

        assert run.renew_export_lease("other", now=later) is False
        assert run.renew_export_lease(token, now=later) is True
        assert run.export_heartbeat_at == later

    @staticmethod
    def test_expired_lease_becomes_uncertain_and_still_takes_the_late_acceptance() -> None:
        run = exportable(frozen())
        token = claimed(run)

        assert not_claimed(run, now=NOW + timedelta(seconds=31))
        assert (run.state, run.error_code) == (TraceRunState.UNCERTAIN, "export_lease_expired")

        run.export_failed(token, "provider_export_rejected", now=NOW)
        assert run.state is TraceRunState.UNCERTAIN
        trace_url = "https://langfuse.test/trace"
        run.export_accepted(token, provider_trace_id="remote", trace_url=trace_url, span_urls={"a" * 16: "u"}, now=NOW)
        assert (run.state, run.error_code, run.export_token) == (TraceRunState.ACCEPTED, None, None)
        assert (run.provider_trace_id, run.trace_url, run.span_urls) == ("remote", trace_url, {"a" * 16: "u"})
        assert run.accepted_at == NOW

    @staticmethod
    def test_retryable_failure_backs_off_until_the_attempts_run_out() -> None:
        run = exportable(frozen())
        run.export_deferred(claimed(run), max_attempts=2, now=NOW)

        assert (run.state, run.error_code) == (TraceRunState.RETRYING, "provider_temporarily_unavailable")
        assert run.next_attempt_at == NOW + timedelta(seconds=5)
        assert not_claimed(run)

        token = claimed(run, now=NOW + timedelta(seconds=5))
        run.export_deferred(token, max_attempts=2, now=NOW + timedelta(seconds=5))
        assert (run.state, run.error_code, run.attempts) == (TraceRunState.FAILED, "provider_retry_exhausted", 2)

    @staticmethod
    def test_outcomes_of_a_replaced_attempt_change_nothing() -> None:
        run = exportable(frozen())
        claimed(run)

        run.export_failed("replaced", "provider_export_rejected", now=NOW)
        run.export_uncertain("replaced", now=NOW)
        run.export_deferred("replaced", max_attempts=8, now=NOW)
        run.export_accepted("replaced", provider_trace_id="remote", trace_url=None, span_urls={}, now=NOW)

        assert run.state is TraceRunState.EXPORTING
        assert run.provider_trace_id is None


class TestRetry:
    @staticmethod
    def test_uncertain_export_retries_only_with_the_duplicate_acknowledgement() -> None:
        run = exportable(frozen())
        run.export_uncertain(claimed(run), now=NOW)
        assert (run.state, run.error_code) == (TraceRunState.UNCERTAIN, "provider_acceptance_unknown")

        with pytest.raises(TraceRunConflictError, match="tracing_duplicate_acknowledgement_required"):
            run.release_for_retry(acknowledge_possible_duplicates=False, now=NOW)
        run.release_for_retry(acknowledge_possible_duplicates=True, now=NOW)

        assert (run.state, run.error_code, run.export_token, run.next_attempt_at) == (
            TraceRunState.READY,
            None,
            None,
            None,
        )
        assert claimed(run) is not None

    @staticmethod
    def test_ineligible_runs_are_not_released() -> None:
        accepted = exportable(frozen())
        accepted.export_accepted(claimed(accepted), provider_trace_id="r", trace_url=None, span_urls={}, now=NOW)
        rejected_by_collection = exportable(frozen())
        rejected_by_collection.export_failed(claimed(rejected_by_collection), "tracing_payload_invalid", now=NOW)
        collecting = frozen()

        cases: list[tuple[TraceRunAgg, type[TraceRunError], str]] = [
            (frozen(config=None), TraceRunNotFoundError, "tracing_run_not_found"),
            (accepted, TraceRunConflictError, "tracing_already_accepted"),
            (collecting, TraceRunConflictError, "tracing_retry_not_allowed"),
            (rejected_by_collection, TraceRunConflictError, "tracing_retry_not_allowed"),
        ]
        for run, error, code in cases:
            state = run.state
            with pytest.raises(error, match=code):
                run.release_for_retry(acknowledge_possible_duplicates=True, now=NOW)
            assert run.state is state


class TestRecoveryCheck:
    @staticmethod
    def test_unresolved_recovery_rotates_and_a_final_answer_fails_the_run() -> None:
        run = frozen()
        later = NOW + timedelta(minutes=1)

        run.recovery_checked(None, now=later)
        assert (run.state, run.updated_at) == (TraceRunState.COLLECTING, later)

        run.recovery_checked("business_terminal_not_persisted", now=later)
        assert (run.state, run.error_code) == (TraceRunState.FAILED, "business_terminal_not_persisted")

    @staticmethod
    def test_captured_terminal_is_not_touched_by_recovery() -> None:
        run = frozen()
        run.capture_terminal(business_terminal(run), now=NOW)

        run.recovery_checked("business_terminal_not_persisted", now=NOW + timedelta(minutes=1))

        assert (run.state, run.error_code, run.updated_at) == (TraceRunState.COLLECTING, None, NOW)


def agent_span(run: TraceRunAgg, span_id: str, parent_span_id: str, *, name: str, status: str) -> AgentTraceSpan:
    return AgentTraceSpan(
        trace_id=run.trace_id,
        span_id=span_id,
        parent_span_id=parent_span_id,
        name=name,
        start_time_ns=1_000_000_000,
        end_time_ns=2_000_000_000,
        status="error" if status == "error" else "ok",
        status_message="tool failed" if status == "error" else None,
        attributes={"gen_ai.operation.name": "invoke_agent"},
    )


def report(run: TraceRunAgg, opened: TraceInvocation, spans: list[AgentTraceSpan]) -> None:
    payload = AgentTraceBatch(
        run_id=UUID(run.id), invocation_id=UUID(opened.id), batch_id=uuid4(), final=True, spans=spans
    )
    ingest(run, payload.model_dump(mode="json"))


class TestExportedTrace:
    @staticmethod
    def test_runtime_spans_nest_under_their_invocation_with_the_run_identity() -> None:
        run = frozen(policy={**POLICY, "capture_content": True})
        run.capture_terminal(business_terminal(run), now=NOW)
        opened = run.open_invocation(agent_id=identifier("agent"), node_execution_id=None, attempt=1, call_key="k")
        report(
            run,
            opened,
            [
                agent_span(run, "a" * 16, opened.span_id, name="Agent execution", status="error"),
                agent_span(run, "b" * 16, "a" * 16, name="tool", status="ok"),
            ],
        )

        trace = run.exported_trace(run.new_batches)

        assert trace.trace_id == run.trace_id
        assert trace.session_id == "session"
        assert trace.user_id == "user"
        assert [item.span_id for item in trace.spans] == [run.root_span_id, opened.span_id, "a" * 16, "b" * 16]
        attempt = trace.spans[1]
        assert attempt.name == "Agent attempt 2"
        assert attempt.parent_span_id == run.root_span_id
        assert (attempt.status, attempt.error) == (SpanStatus.ERROR, "tool failed")
        assert attempt.attributes["invocation_id"] == opened.id
        assert all(item.attributes["dify.tracing.run_id"] == run.id for item in trace.spans)
        assert all(item.attributes["dify.tenant_id"] == run.tenant_id for item in trace.spans)

    @staticmethod
    def test_run_from_before_the_upgrade_exports_its_stored_terminal_shape() -> None:
        run = frozen()
        run.outer_trace = {
            "trace_id": run.trace_id,
            "root_span_id": run.root_span_id,
            "session_id": "legacy-session",
            "spans": [
                {
                    "id": run.root_span_id,
                    "parent_id": None,
                    "name": "message",
                    "kind": SpanKind.CHAIN.value,
                    "start_time": "2026-10-01T12:00:00Z",
                    "end_time": None,
                    "status": SpanStatus.OK.value,
                    "metadata": {"workflow_id": "legacy"},
                }
            ],
        }

        (root,) = run.exported_trace([]).spans

        assert root.span_id == run.root_span_id
        assert root.end_time == root.start_time
        assert root.attributes["workflow_id"] == "legacy"

    @staticmethod
    def test_run_without_a_captured_terminal_exports_nothing() -> None:
        with pytest.raises(TraceRunError, match="tracing_terminal_missing"):
            frozen().exported_trace([])

    @staticmethod
    @pytest.mark.parametrize(
        "code",
        [
            "tracing_invocation_empty",
            "tracing_invocation_not_found",
            "tracing_span_conflict",
            "tracing_invocation_parent_invalid",
            "tracing_invocation_root_missing",
        ],
    )
    def test_invalid_runtime_trees_are_rejected(code: str) -> None:
        run = frozen()
        run.capture_terminal(business_terminal(run), now=NOW)
        opened = run.open_invocation(agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key="k")
        root = agent_span(run, "a" * 16, opened.span_id, name="Agent execution", status="ok")
        batches: list[TraceBatch]
        match code:
            case "tracing_invocation_empty":
                batches = []
            case "tracing_invocation_not_found":
                report(run, opened, [root])
                batches = [replace(run.new_batches[0], invocation_id=identifier("other-invocation"))]
            case "tracing_span_conflict":
                report(run, opened, [root])
                conflicting = {**run.new_batches[0].spans[0], "name": "renamed"}
                batches = [*run.new_batches, replace(run.new_batches[0], id=str(uuid4()), spans=[conflicting])]
            case "tracing_invocation_parent_invalid":
                report(run, opened, [root, agent_span(run, "b" * 16, "c" * 16, name="orphan", status="ok")])
                batches = run.new_batches
            case _:
                detached = [
                    agent_span(run, "a" * 16, "b" * 16, name="detached", status="ok"),
                    agent_span(run, "b" * 16, "a" * 16, name="detached", status="ok"),
                ]
                report(run, opened, detached)
                batches = run.new_batches

        with pytest.raises(TraceRunError, match=code):
            run.exported_trace(batches)


class TestStates:
    @staticmethod
    def test_only_collecting_or_exported_runs_accept_a_terminal() -> None:
        accepting = {state for state in TraceRunState if state.accepts_terminal}

        assert accepting == {TraceRunState.COLLECTING, TraceRunState.READY, TraceRunState.RETRYING}

    @staticmethod
    def test_run_awaits_its_terminal_only_while_it_collects_without_one() -> None:
        collecting = frozen()
        captured = frozen()
        captured.capture_terminal(business_terminal(captured), now=NOW)

        assert collecting.awaits_terminal is True
        assert captured.awaits_terminal is False
        assert frozen(config=None).awaits_terminal is False
