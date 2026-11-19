"""External content export follows frozen policy and retained typed sources."""

import json
from dataclasses import replace
from datetime import timedelta

import pytest
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.provider import LangfuseProvider
from dify_trace_sdk.model import Trace
from dify_trace_sdk.testing import RecordingEgress, otlp_attributes, otlp_spans, response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.external_agent import ExternalAgentConnectionRevision, ExternalAgentInvocation
from models.external_agent_trace import (
    ExternalAgentDataTombstone,
    ExternalAgentTraceDelivery,
    ExternalAgentTracingConfig,
)
from models.model import App
from providers.a2a.control_adapters import WorkspaceExternalSecretCodec
from repositories.external_agents.observability_repository import ConnectionTraceSecretReader
from services.external_agents.observability import ObservationExpiredError, ObservationNotFoundError
from services.external_agents.traceability import TraceLimits
from services.external_agents.tracing_config import ExternalTraceDeliveryService, build_external_trace
from tests.unit_tests.repositories.external_agents import test_observability_repository as fixtures
from tests.unit_tests.repositories.external_agents.test_observability_repository import (
    AGENT,
    APP,
    DBNOW,
    NOW,
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


@pytest.mark.parametrize(
    ("app_content", "asset_content", "auth", "captured", "final_state"),
    [
        (True, True, "bearer", True, "succeeded"),
        (True, True, "none", True, "succeeded"),
        (False, True, "bearer", False, "succeeded"),
        (True, False, "bearer", False, "succeeded"),
        (False, False, "missing", False, "succeeded"),
        (True, True, "reclaimed", False, "succeeded"),
        (True, True, "missing", False, "succeeded"),
        (True, True, "unreadable", False, "succeeded"),
        (True, True, "bearer", True, "failed"),
        (True, True, "bearer", True, "ended"),
    ],
)
def test_authorized_root_exports_frozen_task_and_validated_output(
    sessions: sessionmaker[Session], app_content: bool, asset_content: bool, auth: str, captured: bool, final_state: str
) -> None:
    identifier = invocation(sessions, dispatched_at=None, ended_at=None, local_state="waiting")
    repository, observations, access, _ = services(sessions)
    with sessions.begin() as session:
        required(session.get(App, APP), App).tracing = json.dumps(
            {"enabled": True, "tracing_provider": "langfuse", "capture_content": app_content, "capture_agent": False}
        )
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                encrypted_config={},
                enabled=True,
                capture_content=asset_content,
            )
        )
        revision = required(session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision)
        if auth == "missing":
            session.delete(revision)
        elif auth in {"none", "reclaimed"}:
            revision.auth_type = "none" if auth == "none" else "bearer"
            revision.credential_ciphertext = None
    repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.runtime_snapshot = {"parts": [{"text": "Frozen "}, {"text": "resolved task"}]}
        row.outputs = {"answer": "owned result", "count": 0, "flag": False, "empty": ""}
        row.dispatched_at, row.ended_at, row.local_state = DBNOW, DBNOW + timedelta(seconds=1), final_state
    observations.record_trace(
        tenant_id=TENANT,
        invocation_id=identifier,
        source_id="message",
        payload={
            "trace_id": "remote",
            "steps": [
                {
                    "step_id": "agent",
                    "call_type": 1,
                    "status": "completed",
                    "start_time": NOW.isoformat(),
                    "end_time": (NOW + timedelta(seconds=1)).isoformat(),
                    "step_action": {
                        "agent_invocation": {
                            "agent_name": "Local Codex",
                            "requests": {"count": 0, "flag": False, "empty": ""},
                        }
                    },
                },
                {
                    "step_id": "tool",
                    "parent_step_id": "agent",
                    "call_type": 2,
                    "status": "completed",
                    "start_time": NOW.isoformat(),
                    "end_time": (NOW + timedelta(seconds=1)).isoformat(),
                    "step_action": {"tool_invocation": {"tool_name": "Search", "parameters": {"query": "child"}}},
                },
            ],
        },
        received_at=NOW,
    )
    delivery = ExternalTraceDeliveryService(
        secrets=ConnectionTraceSecretReader(sessions=sessions, codec=WorkspaceExternalSecretCodec())
        if auth == "unreadable"
        else Secrets(),
        limits=TraceLimits(),
        store=repository,
        sender=UnexpectedIO(),
        access=access,
        clock=lambda: NOW,
    )
    first = delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert len(first) == 1
    with sessions() as session:
        payload = session.scalars(select(ExternalAgentTraceDelivery.trace_payload)).one()
        root = payload["spans"][0]
        assert root["inputs"] == ({"agent_task": "Frozen resolved task"} if captured else None)
        assert root["outputs"] == (
            {"answer": "owned result", "count": 0, "flag": False, "empty": ""}
            if captured and final_state == "succeeded"
            else None
        )
        agent, tool = payload["spans"][1:]
        assert agent["inputs"] == ({"count": 0, "flag": False, "empty": ""} if captured else None)
        assert tool["inputs"] == ({"query": "child"} if captured else None)
        assert agent["outputs"] is tool["outputs"] is None
        assert tool["parent_span_id"] == agent["span_id"]
        frozen_payload = payload
    source = repository.export_source(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    if not (app_content and asset_content):
        assert source.content.parts is source.content.outputs is source.content.auth_type is None
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.runtime_snapshot = {"parts": [{"text": "changed later"}]}
        row.outputs = {"answer": "must not rewrite frozen delivery"}
    assert delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW) == first
    with sessions() as session:
        assert session.scalars(select(ExternalAgentTraceDelivery.trace_payload)).one() == frozen_payload
    egress = RecordingEgress((response(200, {}),), grpc_target=None)
    LangfuseProvider(egress).send(
        LangfuseConfig(public_key="public-test", secret_key="private-test", host="https://collector.example"),
        Trace.model_validate(frozen_payload),
    )
    wire_root = otlp_attributes(otlp_spans(egress)[0])
    if captured:
        assert json.loads(str(wire_root["langfuse.observation.input"])) == {"agent_task": "Frozen resolved task"}
        if final_state == "succeeded":
            assert json.loads(str(wire_root["langfuse.observation.output"]))["flag"] is False
        else:
            assert "langfuse.observation.output" not in wire_root
        bounded = build_external_trace(
            source.owner,
            source.snapshot,
            source.targets[0],
            content=replace(source.content, parts=({"text": "x" * 3500},)),
            secrets=("hidden-token",),
            limits=TraceLimits(max_bytes=4096),
        )
        assert bounded is not None
        assert len(bounded.model_dump_json().encode()) <= 4096
        assert all(span.inputs is span.outputs is None for span in bounded.spans)
    else:
        assert "langfuse.observation.input" not in wire_root
        assert "langfuse.observation.output" not in wire_root


@pytest.mark.parametrize("closed", ["expired", "deleted_app", "tombstone"])
def test_content_bundle_cannot_bypass_closed_source_fences(sessions: sessionmaker[Session], closed: str) -> None:
    identifier = invocation(sessions, runtime_snapshot={"parts": [{"text": "private"}]}, outputs={"answer": "private"})
    repository, _, _, _ = services(sessions)
    with sessions.begin() as session:
        if closed == "expired":
            required(
                session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation
            ).retention_expires_at = DBNOW
        elif closed == "deleted_app":
            session.delete(required(session.get(App, APP), App))
        else:
            session.add(
                ExternalAgentDataTombstone(id=uid(), tenant_id=TENANT, owner_kind="app", owner_id=APP, deleted_at=DBNOW)
            )
    with pytest.raises((ObservationExpiredError, ObservationNotFoundError)):
        repository.export_source(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions() as session:
        assert not session.scalars(select(ExternalAgentTraceDelivery)).all()
