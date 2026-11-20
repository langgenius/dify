"""Capture status describes frozen permissions and payloads, never current config."""

import json
from datetime import timedelta

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.external_agent import ExternalAgentConnectionRevision, ExternalAgentInvocation
from models.external_agent_trace import (
    ExternalAgentDataTombstone,
    ExternalAgentTraceDelivery,
    ExternalAgentTraceTarget,
    ExternalAgentTracingConfig,
)
from models.model import App
from services.external_agents.observability import (
    ObservationAccessDeniedError,
    ObservationExpiredError,
    ObservationNotFoundError,
)
from services.external_agents.trace_capture import CAPTURE_REASONS_ATTRIBUTE, CAPTURE_STATUS_ATTRIBUTE
from services.external_agents.traceability import TraceLimits
from services.external_agents.tracing_config import ExternalTraceDeliveryService, build_external_trace
from tests.unit_tests.repositories.external_agents import test_observability_repository as fixtures
from tests.unit_tests.repositories.external_agents.test_observability_repository import (
    AGENT,
    APP,
    APP2,
    CONTEXT,
    DBNOW,
    EDITOR,
    NORMAL,
    NOW,
    OTHER,
    REVISION,
    TENANT,
    Secrets,
    UnexpectedIO,
    invocation,
    required,
    services,
    uid,
)

sessions = fixtures.sessions


def capture_fixture(
    sessions: sessionmaker[Session], *, source_allowed: bool, target_allowed: bool, redaction_available: bool
) -> tuple[str, ExternalTraceDeliveryService]:
    """Create a real scoped source/target and freeze before its synthetic dispatch."""
    identifier = invocation(sessions, dispatched_at=None, ended_at=None, local_state="waiting", origin="node_debug")
    repository, _, access, _ = services(sessions)
    with sessions.begin() as session:
        required(session.get(App, APP), App).tracing = json.dumps({"capture_content": source_allowed})
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                encrypted_config={},
                enabled=True,
                capture_content=target_allowed,
            )
        )
        if not redaction_available:
            session.delete(
                required(session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision)
            )
    repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.runtime_snapshot = {"parts": [{"text": "Resolved synthetic task"}]}
        row.outputs = {"count": 0, "flag": False, "empty": ""}
        row.local_state, row.dispatched_at, row.ended_at = "succeeded", DBNOW, DBNOW + timedelta(seconds=1)
    return identifier, ExternalTraceDeliveryService(
        store=repository,
        sender=UnexpectedIO(),
        access=access,
        clock=lambda: NOW,
        secrets=Secrets(),
        limits=TraceLimits(),
    )


def test_target_keeps_each_permission_after_current_settings_change(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions, dispatched_at=None, ended_at=None, local_state="waiting")
    repository, _, _, _ = services(sessions)
    with sessions.begin() as session:
        required(session.get(App, APP), App).tracing = json.dumps({"capture_content": False})
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                encrypted_config={},
                enabled=True,
                capture_content=True,
            )
        )
    repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(App, APP), App).tracing = json.dumps({"capture_content": True})
    with sessions() as session:
        target = session.scalars(select(ExternalAgentTraceTarget)).one()
        assert target.capture_policy == {
            "version": 1,
            "source_app_capture_content": False,
            "target_capture_content": True,
        }


@pytest.mark.parametrize(
    ("source", "target", "redaction", "expected", "reasons"),
    [
        (True, True, True, "content_included", ()),
        (False, True, True, "metadata_only", ("source_app_disabled",)),
        (True, False, True, "metadata_only", ("target_content_disabled",)),
        (False, False, True, "metadata_only", ("source_app_disabled", "target_content_disabled")),
        (True, True, False, "metadata_only", ("redaction_unavailable",)),
    ],
)
def test_status_reads_projected_result_from_frozen_payload(
    sessions: sessionmaker[Session],
    source: bool,
    target: bool,
    redaction: bool,
    expected: str,
    reasons: tuple[str, ...],
) -> None:
    """A saved permission is distinct from content and provider acceptance."""
    identifier, delivery = capture_fixture(
        sessions, source_allowed=source, target_allowed=target, redaction_available=redaction
    )
    pending = delivery.capture_status(CONTEXT, APP, identifier, now=NOW).targets[0]
    assert pending.status == "pending"
    assert pending.delivery_state is pending.payload_revision is None
    original = delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(App, APP), App).tracing = json.dumps({"capture_content": not source})
        session.scalars(select(ExternalAgentTracingConfig)).one().capture_content = not target
        before = session.scalars(select(ExternalAgentTraceDelivery.trace_payload)).one()
    result = delivery.capture_status(CONTEXT, APP, identifier, now=NOW)
    status = result.targets[0]
    assert result.targets_frozen
    assert status.capture_content is (source and target)
    assert status.capture_policy is not None
    assert status.capture_policy.source_app_capture_content is source
    assert status.capture_policy.target_capture_content is target
    assert status.status == expected
    assert status.reasons == reasons
    assert status.delivery_state == "pending"
    assert status.payload_revision == 0
    assert delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW) == original
    with sessions() as session:
        assert session.scalars(select(ExternalAgentTraceDelivery.trace_payload)).one() == before


@pytest.mark.parametrize("allowed", [False, True])
def test_legacy_marker_and_policy_absence_stay_unknown_without_current_policy_inference(
    sessions: sessionmaker[Session], allowed: bool
) -> None:
    identifier, delivery = capture_fixture(
        sessions, source_allowed=True, target_allowed=allowed, redaction_available=True
    )
    delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        session.scalars(select(ExternalAgentTraceTarget)).one().capture_policy = None
        row = session.scalars(select(ExternalAgentTraceDelivery)).one()
        payload = dict(row.trace_payload)
        attributes: dict[str, object] = {}
        payload["spans"] = [{"attributes": attributes, "inputs": {"legacy": "not inspected"}}]
        row.trace_payload = payload
    status = delivery.capture_status(CONTEXT, APP, identifier, now=NOW).targets[0]
    assert status.capture_policy is None
    assert status.status == ("unknown" if allowed else "metadata_only")
    assert status.reasons == ("legacy_snapshot_unavailable",)


def test_budget_fallback_and_absent_content_are_specific_frozen_results(sessions: sessionmaker[Session]) -> None:
    identifier, _ = capture_fixture(sessions, source_allowed=True, target_allowed=True, redaction_available=True)
    repository, _, _, _ = services(sessions)
    source = repository.export_source(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    from dataclasses import replace

    trace = build_external_trace(
        source.owner,
        source.snapshot,
        source.targets[0],
        content=replace(source.content, parts=({"text": "x" * 3500},)),
        secrets=(),
        limits=TraceLimits(max_bytes=4096),
    )
    assert trace is not None
    assert all(span.inputs is span.outputs is None for span in trace.spans)
    assert trace.spans[0].attributes[CAPTURE_STATUS_ATTRIBUTE] == "metadata_only"
    assert trace.spans[0].attributes[CAPTURE_REASONS_ATTRIBUTE] == ["payload_budget_exceeded"]
    absent = build_external_trace(
        source.owner,
        source.snapshot,
        source.targets[0],
        content=replace(source.content, parts=None, outputs=None),
        secrets=(),
        limits=TraceLimits(),
    )
    assert absent is not None
    assert absent.spans[0].attributes[CAPTURE_REASONS_ATTRIBUTE] == ["content_not_available"]
    field_budget = build_external_trace(
        source.owner,
        source.snapshot,
        source.targets[0],
        content=replace(source.content, parts=({"text": "x" * 5000},), outputs=None),
        secrets=(),
        limits=TraceLimits(max_bytes=4096),
    )
    assert field_budget is not None
    assert field_budget.spans[0].inputs is field_budget.spans[0].outputs is None
    assert field_budget.spans[0].attributes[CAPTURE_REASONS_ATTRIBUTE] == ["payload_budget_exceeded"]


@pytest.mark.parametrize("value", [0, False, "", {}, []])
def test_only_child_explicit_false_zero_or_empty_still_counts_as_included(
    sessions: sessionmaker[Session], value: object
) -> None:
    identifier, delivery = capture_fixture(sessions, source_allowed=True, target_allowed=True, redaction_available=True)
    _, observations, _, _ = services(sessions)
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.runtime_snapshot = {}
        row.outputs = None
    observations.record_trace(
        tenant_id=TENANT,
        invocation_id=identifier,
        source_id="child-only",
        payload={
            "trace_id": "reported",
            "steps": [
                {
                    "step_id": "child",
                    "call_type": 2,
                    "status": "completed",
                    "start_time": NOW.isoformat(),
                    "end_time": (NOW + timedelta(seconds=1)).isoformat(),
                    "step_action": {"tool_invocation": {"tool_name": "Synthetic", "parameters": value}},
                }
            ],
        },
        received_at=NOW,
    )
    delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    status = delivery.capture_status(CONTEXT, APP, identifier, now=NOW).targets[0]
    assert status.status == "content_included"
    assert status.reasons == ()
    with sessions() as session:
        payload = session.scalars(select(ExternalAgentTraceDelivery.trace_payload)).one()
        assert payload["spans"][0]["inputs"] is payload["spans"][0]["outputs"] is None
        assert payload["spans"][1]["inputs"] == value


def test_no_target_and_before_freeze_remain_distinct(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions, dispatched_at=None)
    repository, _, _, _ = services(sessions)
    before = repository.capture_snapshot(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert not before.targets_frozen
    assert not before.targets
    repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    after = repository.capture_snapshot(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert after.targets_frozen
    assert not after.targets


def test_status_selects_latest_payload_revision_without_rewriting_previous_delivery(
    sessions: sessionmaker[Session],
) -> None:
    """An older delivery's acceptance cannot describe the newest payload intent."""
    identifier, delivery = capture_fixture(sessions, source_allowed=True, target_allowed=True, redaction_available=True)
    _, observations, _, _ = services(sessions)
    first = delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentTraceDelivery, first[0]), ExternalAgentTraceDelivery)
        row.state = "accepted"
        original_payload = row.trace_payload
    observations.record_trace(
        tenant_id=TENANT,
        invocation_id=identifier,
        source_id="later-revision",
        payload={
            "trace_id": "later",
            "steps": [
                {
                    "step_id": "child",
                    "call_type": 2,
                    "status": "completed",
                    "start_time": NOW.isoformat(),
                    "end_time": (NOW + timedelta(seconds=1)).isoformat(),
                    "step_action": {"tool_invocation": {"tool_name": "Synthetic", "parameters": False}},
                }
            ],
        },
        received_at=NOW,
    )
    second = delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert second != first
    status = delivery.capture_status(CONTEXT, APP, identifier, now=NOW).targets[0]
    assert status.payload_revision == 1
    assert status.delivery_state == "pending"
    assert status.status == "content_included"
    with sessions() as session:
        row = required(session.get(ExternalAgentTraceDelivery, first[0]), ExternalAgentTraceDelivery)
        assert row.trace_payload == original_payload
        assert row.state == "accepted"


@pytest.mark.parametrize(
    "denial", ["app", "tenant", "normal", "initiator", "resource", "permissions", "expired", "deleted", "tombstone"]
)
def test_status_rechecks_source_owner_permission_and_lifecycle(sessions: sessionmaker[Session], denial: str) -> None:
    identifier, _ = capture_fixture(sessions, source_allowed=True, target_allowed=True, redaction_available=True)
    repository, _, access, permissions = services(sessions)
    delivery = ExternalTraceDeliveryService(
        store=repository,
        sender=UnexpectedIO(),
        access=access,
        clock=lambda: NOW,
        secrets=Secrets(),
        limits=TraceLimits(),
    )
    context, app_id = CONTEXT, APP2 if denial == "app" else APP
    if denial == "tenant":
        context = context._replace(active_workspace_id=OTHER)
    elif denial == "normal":
        context = context._replace(account_id=NORMAL)
    elif denial == "initiator":
        context = context._replace(account_id=EDITOR)
    elif denial == "resource":
        context = context._replace(resource_app_ids=frozenset({APP2}))
    elif denial == "permissions":
        permissions.allowed = frozenset({APP2})
    with sessions.begin() as session:
        if denial == "expired":
            required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).test_expires_at = DBNOW
        elif denial == "deleted":
            session.delete(required(session.get(App, APP), App))
        elif denial == "tombstone":
            session.add(
                ExternalAgentDataTombstone(id=uid(), tenant_id=TENANT, owner_kind="app", owner_id=APP, deleted_at=DBNOW)
            )
    expected = (
        ObservationExpiredError
        if denial == "expired"
        else (
            ObservationAccessDeniedError
            if denial in {"normal", "initiator", "resource", "permissions"}
            else ObservationNotFoundError
        )
    )
    with pytest.raises(expected):
        delivery.capture_status(context, app_id, identifier, now=NOW)


def test_status_query_selects_only_bounded_markers_not_content_or_credentials(sessions: sessionmaker[Session]) -> None:
    identifier, delivery = capture_fixture(sessions, source_allowed=True, target_allowed=True, redaction_available=True)
    delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    queries: list[str] = []

    def record(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        queries.append(statement)

    with sessions() as session:
        engine = session.get_bind()
        assert isinstance(engine, Engine)
    event.listen(engine, "before_cursor_execute", record)
    try:
        assert delivery.capture_status(CONTEXT, APP, identifier, now=NOW).targets[0].status == "content_included"
    finally:
        event.remove(engine, "before_cursor_execute", record)
    selected = [statement.partition("FROM")[0] for statement in queries if statement.startswith("SELECT")]
    assert not any("encrypted_config" in statement or "runtime_snapshot" in statement for statement in selected)
    payload_reads = [statement for statement in selected if "trace_payload" in statement]
    assert len(payload_reads) == 1
    assert "JSON_EXTRACT" in payload_reads[0]
