"""Real Runtime observation/SQL terminal commit precedes durable export recovery."""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.base import TypeBase
from models.external_agent import ExternalAgentHead, ExternalAgentInvocation
from models.external_agent_trace import (
    ExternalAgentTraceDelivery,
    ExternalAgentTraceReceipt,
    ExternalAgentTraceRecord,
    ExternalAgentTraceStep,
    ExternalAgentTraceTarget,
    ExternalAgentTraceUsageSummary,
    ExternalAgentTracingConfig,
)
from providers.a2a.runtime_io import ExternalOutputNormalizer
from repositories.external_agents.observability_repository import (
    DatabaseExternalObservationAccess,
    ExternalObservabilityRepository,
)
from repositories.external_agents.runtime_repository import ExternalRuntimeRepository
from services.external_agents.invocation_service import ExternalInvocationService
from services.external_agents.io_contracts import OutputField
from services.external_agents.observability import ExternalObservabilityService
from services.external_agents.protocol import GatewayReceipt
from services.external_agents.runtime_contracts import RuntimeScope, RuntimeSettings
from services.external_agents.traceability import (
    TRACEABILITY_METADATA_KEY,
    ReportedCallUsage,
    TraceabilityNormalizer,
    TraceLimits,
)
from services.external_agents.tracing_config import ExternalTraceDeliveryService
from tests.unit_tests.repositories.external_agents.test_observability_repository import (
    Access,
    Permissions,
    Secrets,
    UnexpectedIO,
    model_table,
    required,
)
from tests.unit_tests.repositories.external_agents.test_runtime_repository import (
    Clock,
    Ids,
    Inputs,
    RemoteAgent,
    Wake,
    domain,
    draft,
    uid,
)

__all__ = ["domain"]


def test_runtime_observe_before_terminal_commit_is_recovered_after_process_gap(
    domain: tuple[ExternalRuntimeRepository, sessionmaker[Session], RuntimeScope, str, str],
) -> None:
    runtime_store, sessions, scope, agent, _revision = domain
    TypeBase.metadata.create_all(
        sessions.kw["bind"],
        tables=[
            model_table(model)
            for model in (
                ExternalAgentTraceRecord,
                ExternalAgentTraceReceipt,
                ExternalAgentTraceStep,
                ExternalAgentTraceUsageSummary,
                ExternalAgentTracingConfig,
                ExternalAgentTraceTarget,
                ExternalAgentTraceDelivery,
            )
        ],
    )
    limits, clock = TraceLimits(), Clock()
    store = ExternalObservabilityRepository(sessions=sessions, limits=limits)
    access = DatabaseExternalObservationAccess(sessions=sessions, assets=Access(sessions), permissions=Permissions())
    observations = ExternalObservabilityService(
        store=store, access=access, normalizer=TraceabilityNormalizer(limits), secrets=Secrets()
    )
    delivery = ExternalTraceDeliveryService(store=store, sender=UnexpectedIO(), access=access, clock=clock.now)
    observer = ExternalOutputNormalizer(
        files=UnexpectedIO(), observations=observations, trace_delivery=delivery, now=clock.now
    )
    runtime = ExternalInvocationService(
        store=runtime_store,
        connections=runtime_store,
        gateway=RemoteAgent(direct=True),
        inputs=Inputs(),
        outputs=observer,
        observer=observer,
        wake=Wake(),
        clock=clock,
        ids=Ids(),
        settings=RuntimeSettings(),
    )
    with sessions.begin() as session:
        required(session.get(ExternalAgentHead, agent), ExternalAgentHead).tracing_enabled = True
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=scope.tenant_id,
                agent_id=agent,
                provider="phoenix",
                encrypted_config={},
                enabled=True,
            )
        )
    value = runtime.start(scope, draft(agent, declared_outputs=(OutputField(name="text", kind="string"),)))
    permit = runtime_store.acquire_dispatch(scope, value.id, now=clock.now())
    assert permit is not None
    delivery.freeze(tenant_id=scope.tenant_id, invocation_id=value.id, now=clock.now())
    dispatched = runtime_store.begin_send(scope, permit, now=clock.now())
    assert dispatched is not None
    receipt = GatewayReceipt(
        kind="message",
        context_id="context",
        payload={
            "parts": [{"text": "result"}],
            "metadata": {TRACEABILITY_METADATA_KEY: {"trace_id": "remote", "steps": [{"step_id": "step"}]}},
        },
    )
    # This is the real observer that Runtime invokes before its business save.
    observer.observe(dispatched, receipt)
    with sessions() as session:
        assert required(session.get(ExternalAgentInvocation, value.id), ExternalAgentInvocation).ended_at is None
        assert session.scalar(select(func.count()).select_from(ExternalAgentTraceDelivery)) == 0
    assert delivery.reconcile_sources(now=clock.now()) == 0
    # Runtime performs the same (idempotent) observation then commits success.
    # No post-commit fast hook is invoked: model a process exit at this boundary.
    runtime._observe(dispatched, receipt)
    assert runtime_store.get(scope, value.id).ended_at is not None
    assert runtime.result(scope, value.id).outputs == {"text": "result"}
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(ExternalAgentTraceDelivery)) == 0
    assert delivery.reconcile_sources(now=clock.now()) == 1
    assert delivery.reconcile_sources(now=clock.now()) == 0
    with sessions() as session:
        first = required(session.scalar(select(ExternalAgentTraceDelivery)), ExternalAgentTraceDelivery)
        assert first.state == "pending"
        frozen_id, frozen_payload = first.id, first.trace_payload
    observations.record_usage(
        tenant_id=scope.tenant_id,
        invocation_id=value.id,
        usage=ReportedCallUsage(0, "profile.total", "trusted-profile"),
        revision=1,
        received_at=clock.now(),
    )
    assert delivery.reconcile_sources(now=clock.now() + timedelta(seconds=1)) == 1
    assert delivery.reconcile_sources(now=clock.now() + timedelta(seconds=1)) == 0
    with sessions() as session:
        assert (
            required(session.get(ExternalAgentTraceDelivery, frozen_id), ExternalAgentTraceDelivery).trace_payload
            == frozen_payload
        )
        assert session.scalar(select(func.count()).select_from(ExternalAgentTraceDelivery)) == 2
