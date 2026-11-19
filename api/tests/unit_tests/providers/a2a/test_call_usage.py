"""Real wire parsing, composition and SQL usage ownership for the finite profile."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.external_agent import ExternalAgentConnectionRevision, ExternalAgentHead, ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentTraceRecord, ExternalAgentTraceUsageSummary
from providers.a2a.call_usage import METADATA_USAGE_PROFILE, MetadataCallUsageProof
from providers.a2a.gateway import A2AGateway
from providers.a2a.transport import BoundedTransport, HTTPReply, SSRFRequester
from providers.a2a.types import ResponseV1, TaskStateV1
from repositories.external_agents.observability_repository import ExternalObservabilityRepository
from services.external_agents.contracts import ExternalOrigin
from services.external_agents.io_contracts import JsonObject, JsonValue
from services.external_agents.protocol import BearerAuth, ConnectionSpec, GatewayError, GatewayReceipt
from services.external_agents.runtime_contracts import ExecutionIdentity, Invocation, RuntimeScope, WaitPolicy
from services.external_agents.traceability import TraceLimits
from tests.helpers.unit.model_factories import make_account, make_tenant

NOW = datetime.now(UTC)


def _task(metadata: JsonObject, state: TaskStateV1 = TaskStateV1.COMPLETED) -> GatewayReceipt:
    """Parse a real v1 Task envelope and retain its gateway carrier provenance."""
    return A2AGateway._receipt(
        ResponseV1.model_validate(
            {"task": {"id": "task-1", "contextId": "ctx-1", "status": {"state": state}, "metadata": metadata}}
        )
    )


def _message(metadata: JsonObject) -> GatewayReceipt:
    """Parse a direct Agent Message with the same supported root metadata path."""
    return A2AGateway._receipt(
        ResponseV1.model_validate(
            {
                "message": {
                    "messageId": "message-1",
                    "contextId": "ctx-1",
                    "role": "ROLE_AGENT",
                    "parts": [{"text": "done"}],
                    "metadata": metadata,
                }
            }
        )
    )


@pytest.mark.parametrize("total", [0, 21501, 2**63 - 1])
@pytest.mark.parametrize("kind", ["task", "message"])
def test_root_wire_usage_is_a_final_remote_report_including_real_zero(total: int, kind: str) -> None:
    metadata: JsonObject = {"usage": {"totalTokens": total, "inputTokens": 7, "outputTokens": 11}}
    receipt = _task(metadata) if kind == "task" else _message(metadata)
    proof = MetadataCallUsageProof().prove(receipt)
    assert proof is not None
    usage, revision = proof
    assert usage.total_tokens == total
    assert usage.source_path == "metadata.usage.totalTokens"
    assert usage.adapter == METADATA_USAGE_PROFILE
    assert revision == 1


@pytest.mark.parametrize(
    "state", ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]
)
def test_all_authoritative_terminal_task_states_can_report_usage(state: TaskStateV1) -> None:
    assert MetadataCallUsageProof().prove(_task({"usage": {"totalTokens": 13}}, state)) is not None


@pytest.mark.parametrize(
    "usage",
    [
        None,
        [],
        {},
        {"totalTokens": None},
        {"totalTokens": True},
        {"totalTokens": False},
        {"totalTokens": -1},
        {"totalTokens": 1.0},
        {"totalTokens": "21501"},
        {"totalTokens": 2**63},
        {"total_tokens": 21501},
        {"totalTokens": 21501, "total_tokens": 13},
        {"inputTokens": 5, "outputTokens": 8},
    ],
)
def test_missing_invalid_or_ambiguous_totals_remain_unknown(usage: JsonValue) -> None:
    assert MetadataCallUsageProof().prove(_task({"usage": usage})) is None


@pytest.mark.parametrize("scope", ["context", "conversation", "session", "step", "unknown", None, 1, []])
def test_explicit_non_call_or_unrecognized_scope_is_not_promoted(scope: JsonValue) -> None:
    assert MetadataCallUsageProof().prove(_task({"usage": {"totalTokens": 21501, "scope": scope}})) is None


@pytest.mark.parametrize("scope", ["call", "invocation", "task"])
def test_supported_scope_must_match_the_current_receipt(scope: str) -> None:
    proof = MetadataCallUsageProof()
    assert proof.prove(_task({"usage": {"totalTokens": 0, "scope": scope}})) is not None
    if scope == "task":
        assert proof.prove(_message({"usage": {"totalTokens": 0, "scope": scope}})) is None
    assert proof.prove(_message({"usage": {"totalTokens": 0, "scope": "message"}})) is not None
    assert proof.prove(_task({"usage": {"totalTokens": 0, "scope": "message"}})) is None


@pytest.mark.parametrize(
    "state", ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"]
)
def test_partial_task_usage_never_becomes_a_final_total(state: TaskStateV1) -> None:
    assert MetadataCallUsageProof().prove(_task({"usage": {"totalTokens": 10}}, state)) is None


def test_nested_steps_and_unproven_payload_metadata_are_not_usage_carriers() -> None:
    receipt = _task({"steps": [{"usage": {"totalTokens": 21501}}]})
    assert MetadataCallUsageProof().prove(receipt) is None
    unproven = replace(_task({"usage": {"totalTokens": 21501}}), usage_carrier=None)
    assert MetadataCallUsageProof().prove(unproven) is None
    user_message = replace(_message({"usage": {"totalTokens": 21501}}), payload={"role": "ROLE_USER"})
    assert MetadataCallUsageProof().prove(user_message) is None


def _stream(terminal_metadata: JsonObject, *, foreign: bool = False) -> bytes:
    """Build actual SSE wire frames; an initial partial counter is deliberately present."""
    records: list[JsonObject] = [
        {
            "task": {
                "id": "task-1",
                "contextId": "ctx-1",
                "status": {"state": "TASK_STATE_WORKING"},
                "metadata": {"usage": {"totalTokens": 10}},
            }
        },
        {
            "statusUpdate": {
                "taskId": "foreign-task" if foreign else "task-1",
                "contextId": "ctx-1",
                "status": {"state": "TASK_STATE_COMPLETED"},
                "metadata": terminal_metadata,
            }
        },
    ]
    return "".join(f"data: {json.dumps(record)}\n\n" for record in records).encode()


@pytest.mark.parametrize("terminal_usage", [None, 21501])
def test_real_sse_gateway_uses_only_the_terminal_status_usage_carrier(terminal_usage: int | None) -> None:
    gateway = A2AGateway(BoundedTransport(SSRFRequester()))
    metadata: JsonObject = {} if terminal_usage is None else {"usage": {"totalTokens": terminal_usage}}
    receipt = gateway._stream_receipt(HTTPReply(200, {"content-type": "text/event-stream"}, _stream(metadata)))
    # Business/Trace metadata retains the original Task; only provenance can
    # distinguish its partial counter from the terminal event's report.
    assert receipt.payload["metadata"] == {"usage": {"totalTokens": 10}}
    proof = MetadataCallUsageProof().prove(receipt)
    if terminal_usage is None:
        assert receipt.usage_carrier is None
        assert proof is None
    else:
        assert proof is not None
        assert proof[0].total_tokens == 21501
        assert proof[0].source_path == "metadata.usage.totalTokens"


def test_foreign_sse_usage_is_rejected_before_it_can_form_proof() -> None:
    gateway = A2AGateway(BoundedTransport(SSRFRequester()))
    with pytest.raises(GatewayError, match="another task/context") as failure:
        gateway._stream_receipt(
            HTTPReply(
                200, {"content-type": "text/event-stream"}, _stream({"usage": {"totalTokens": 21501}}, foreign=True)
            )
        )
    assert failure.value.known_receipt is not None
    assert MetadataCallUsageProof().prove(failure.value.known_receipt) is None


@pytest.mark.parametrize("unsafe", [False, True])
def test_sse_usage_carrier_redaction_cannot_change_business_success(unsafe: bool) -> None:
    gateway = A2AGateway(BoundedTransport(SSRFRequester()))
    token = "private-usage-test-token"
    usage: JsonObject = {"totalTokens": 21501, "raw" if unsafe else "note": token}
    receipt = gateway._stream_receipt(HTTPReply(200, {"content-type": "text/event-stream"}, _stream({"usage": usage})))
    cleaned = gateway._scrub_receipt(
        receipt, ConnectionSpec(endpoint="https://agent.example", authentication=BearerAuth(token))
    )
    assert cleaned.payload == receipt.payload
    assert cleaned.state == "TASK_STATE_COMPLETED"
    if unsafe:
        assert cleaned.usage_carrier is None
        assert MetadataCallUsageProof().prove(cleaned) is None
    else:
        assert cleaned.usage_carrier is not None
        assert cleaned.usage_carrier.value == {"totalTokens": 21501, "note": "[REDACTED]"}
        assert MetadataCallUsageProof().prove(cleaned) is not None


def test_identity_only_credential_fallback_clears_usage_provenance() -> None:
    gateway = A2AGateway(BoundedTransport(SSRFRequester()))
    receipt = _task({"usage": {"totalTokens": 21501}, "url": "https://files.example/private-test-token"})
    with pytest.raises(GatewayError) as failure:
        gateway._scrub_receipt(
            receipt, ConnectionSpec(endpoint="https://agent.example", authentication=BearerAuth("private-test-token"))
        )
    assert failure.value.known_receipt is not None
    assert failure.value.known_receipt.usage_carrier is None
    assert MetadataCallUsageProof().prove(failure.value.known_receipt) is None


@pytest.fixture
def usage_owner(sqlite_session_factory: sessionmaker[Session]) -> tuple[RequestContext, str, str]:
    """Persist a real workspace/account and immutable connection for SQL owner checks."""
    tenant, actor, agent, revision = (str(uuid4()) for _ in range(4))
    with sqlite_session_factory.begin() as session:
        session.add_all([make_tenant(tenant_id=tenant), make_account(account_id=actor)])
        session.add(TenantAccountJoin(tenant_id=tenant, account_id=actor, role=TenantAccountRole.OWNER))
        session.add(ExternalAgentHead(agent_id=agent, tenant_id=tenant, active_connection_revision_id=revision))
        session.add(
            ExternalAgentConnectionRevision(
                id=revision,
                tenant_id=tenant,
                agent_id=agent,
                endpoint="https://agent.example",
                interface_url="https://agent.example",
                auth_type="none",
                credential_ciphertext=None,
                agent_card={},
                capabilities={},
                fingerprint="f" * 64,
                auth_check="not_exercised",
                created_by=actor,
                verified_at=NOW.replace(tzinfo=None),
            )
        )
    return RequestContext("usage-test", None, actor, tenant), agent, revision


def _attempt(
    sessions: sessionmaker[Session],
    owner: tuple[RequestContext, str, str],
    *,
    execution_key: str,
    sequence: int,
) -> Invocation:
    """Persist a dispatched retained test attempt and return its real runtime value."""
    context, agent, revision = owner
    identifier = str(uuid4())
    with sessions.begin() as session:
        session.add(
            ExternalAgentInvocation(
                id=identifier,
                tenant_id=context.active_workspace_id,
                agent_id=agent,
                request_key=identifier,
                execution_key=execution_key,
                origin="overview_test",
                initiator_id=context.account_id,
                connection_revision_id=revision,
                sequence=sequence,
                test_generation=1,
                dispatched_at=(NOW - timedelta(seconds=10)).replace(tzinfo=None),
                started_at=(NOW - timedelta(seconds=11)).replace(tzinfo=None),
                local_state="succeeded",
                local_wait_ended_at=NOW.replace(tzinfo=None),
                tracking_deadline=(NOW + timedelta(hours=1)).replace(tzinfo=None),
            )
        )
    return Invocation(
        id=identifier,
        scope=RuntimeScope(
            tenant_id=context.active_workspace_id,
            initiator_id=context.account_id,
            app_id=None,
            origin=ExternalOrigin.OVERVIEW_TEST,
        ),
        agent_id=agent,
        identity=ExecutionIdentity(execution_id=execution_key, node_id="agent", frame_id="root"),
        message_id=str(uuid4()),
        parts=(),
        policy=WaitPolicy(),
        declared_outputs=(),
        started_at=NOW - timedelta(seconds=11),
        logical_deadline=NOW + timedelta(hours=1),
        connection_revision_id=revision,
    )


@pytest.mark.parametrize("total", [0, 21501, 2**63 - 1])
@pytest.mark.parametrize("streaming", [False, True])
def test_composed_gateway_usage_persists_once_and_statistics_keeps_real_zero(
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
    usage_owner: tuple[RequestContext, str, str],
    total: int,
    streaming: bool,
) -> None:
    value = _attempt(sqlite_session_factory, usage_owner, execution_key=str(uuid4()), sequence=1)
    observer = account_application_services.external_agents.runtime._observer
    observer.observe(value, _task({"usage": {"totalTokens": 10}}, TaskStateV1.WORKING))
    with sqlite_session_factory() as session:
        assert session.get(ExternalAgentTraceUsageSummary, value.id) is None
    receipt = (
        A2AGateway(BoundedTransport(SSRFRequester()))._stream_receipt(
            HTTPReply(200, {"content-type": "text/event-stream"}, _stream({"usage": {"totalTokens": total}}))
        )
        if streaming
        else _task({"usage": {"totalTokens": total}})
    )
    observer.observe(value, receipt)
    # A final full Task can repeat the same report after SSE. Both are one
    # profile/path/revision, so the replay must not conflict or count twice.
    observer.observe(value, _task({"usage": {"totalTokens": total}}))
    observer.observe(value, receipt)
    observer.observe(value, receipt)
    context, agent, _ = usage_owner
    repository = ExternalObservabilityRepository(sessions=sqlite_session_factory, limits=TraceLimits())
    statistics = repository.test_statistics(context, agent_id=agent, invocation_id=value.id, now=NOW)
    assert statistics.total_tokens == total
    assert (
        statistics.attempt_count == statistics.token_reporting_numerator == statistics.token_reporting_denominator == 1
    )
    with sqlite_session_factory() as session:
        summary = session.get(ExternalAgentTraceUsageSummary, value.id)
        trace = session.get(ExternalAgentTraceRecord, value.id)
        assert summary is not None
        assert summary.total_tokens == total
        assert summary.revision == 1
        assert summary.source_path == "metadata.usage.totalTokens"
        assert trace is not None
        assert trace.revision == 1
        assert session.scalar(select(func.count()).select_from(ExternalAgentTraceUsageSummary)) == 1
    # Neither an invalid later report nor a changed final total can overwrite
    # this proof; the existing same-revision repository conflict is preserved.
    observer.observe(value, _task({"usage": {"totalTokens": True}}))
    observer.observe(value, _task({"usage": {"totalTokens": 1 if total == 0 else 0}}))
    assert repository.test_statistics(context, agent_id=agent, invocation_id=value.id, now=NOW) == statistics


@pytest.mark.parametrize("first_total", [None, 0, 13])
def test_retry_attempt_sql_statistics_never_sum_poll_or_trace_step_counters(
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
    usage_owner: tuple[RequestContext, str, str],
    first_total: int | None,
) -> None:
    key = str(uuid4())
    first = _attempt(sqlite_session_factory, usage_owner, execution_key=key, sequence=1)
    second = _attempt(sqlite_session_factory, usage_owner, execution_key=key, sequence=2)
    observer = account_application_services.external_agents.runtime._observer
    metadata: JsonObject = {"steps": [{"total_tokens": 999999}]}
    if first_total is not None:
        metadata["usage"] = {"totalTokens": first_total}
    canceled = _task(metadata, TaskStateV1.CANCELED)
    observer.observe(first, canceled)
    observer.observe(first, canceled)
    context, agent, _ = usage_owner
    repository = ExternalObservabilityRepository(sessions=sqlite_session_factory, limits=TraceLimits())
    pending = repository.test_statistics(context, agent_id=agent, invocation_id=second.id, now=NOW)
    assert pending.total_tokens is None
    assert pending.token_reporting_numerator == (0 if first_total is None else 1)
    assert pending.token_reporting_denominator == 2
    completed = _message({"usage": {"totalTokens": 8}})
    observer.observe(second, completed)
    observer.observe(second, completed)
    result = repository.test_statistics(context, agent_id=agent, invocation_id=second.id, now=NOW)
    assert result.total_tokens == (None if first_total is None else first_total + 8)
    assert result.attempt_count == result.token_reporting_denominator == 2
    assert result.token_reporting_numerator == (1 if first_total is None else 2)
