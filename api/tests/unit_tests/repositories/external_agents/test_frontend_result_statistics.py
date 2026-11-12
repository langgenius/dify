"""Owned logical test statistics and secret-free provider summaries over real SQL."""

import json
from dataclasses import asdict
from datetime import timedelta
from uuid import UUID

import pytest
from dify_trace_sdk.testing import RecordingEgress
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.console.agent.external_observability import ExternalAgentTracingProviderOverviewApi
from models.account import TenantAccountJoin, TenantAccountRole
from models.external_agent_trace import ExternalAgentDataTombstone, ExternalAgentTracingConfig
from services.external_agents.observability import ObservationAccessDeniedError, ObservationConflictError
from services.external_agents.runtime_contracts import RuntimeError as ExternalRuntimeError
from services.external_agents.traceability import ReportedCallUsage
from services.external_agents.tracing_config import ExternalTracingConfigService
from services.tracing.provider_configs import ProviderConfigGateway
from services.tracing.providers import ProviderConfigCodec
from tests.helpers.unit.services.tracing_ports import InstalledTraceProviders, WorkspaceBoundCipher
from tests.unit_tests.controllers.console.agent.test_external_endpoint_contracts import (
    EndpointDomain,
    endpoint_domain,
    invoke,
    wire,
)
from tests.unit_tests.repositories.external_agents.test_observability_repository import (
    AGENT,
    APP,
    CONTEXT,
    DBNOW,
    EDITOR,
    NORMAL,
    NOW,
    OTHER,
    TENANT,
    invocation,
    services,
    sessions,
    uid,
)

__all__ = ["endpoint_domain", "sessions"]


def overview_attempt(sessions: sessionmaker[Session], **changes: object) -> str:
    values: dict[str, object] = {
        "origin": "overview_test",
        "app_id": None,
        "test_generation": 1,
        "local_wait_ended_at": DBNOW + timedelta(seconds=2),
    }
    values.update(changes)
    return invocation(sessions, **values)


def test_prepared_failure_has_no_external_attempt_or_fabricated_statistics(sessions: sessionmaker[Session]) -> None:
    identifier = overview_attempt(sessions, dispatched_at=None, local_state="failed")
    repository, _, _, _ = services(sessions)
    value = repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=identifier, now=NOW)
    assert asdict(value) == {
        "elapsed_time": None,
        "total_tokens": None,
        "attempt_count": 0,
        "token_reporting_numerator": 0,
        "token_reporting_denominator": 0,
    }


def test_retry_chain_counts_actual_dispatch_and_known_zero_without_other_tests(sessions: sessionmaker[Session]) -> None:
    execution = uid()
    first = overview_attempt(sessions, execution_key=execution, sequence=0)
    latest = overview_attempt(
        sessions,
        execution_key=execution,
        sequence=1,
        retry_of=first,
        dispatched_at=DBNOW + timedelta(seconds=7),
        local_wait_ended_at=DBNOW + timedelta(seconds=12),
    )
    repository, _, _, _ = services(sessions)
    for identifier, tokens in ((first, 0), (latest, 9)):
        owner = repository.owner(tenant_id=TENANT, invocation_id=identifier, now=NOW)
        repository.record_usage(
            owner=owner, usage=ReportedCallUsage(tokens, "call/total", "controlled-adapter"), revision=1, now=NOW
        )
    overview_attempt(sessions, execution_key=uid(), dispatched_at=DBNOW - timedelta(hours=1))
    overview_attempt(sessions, execution_key=execution, initiator_id=EDITOR, sequence=2)
    overview_attempt(sessions, execution_key=execution, agent_id=uid(), sequence=3)
    value = repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=latest, now=NOW + timedelta(hours=1))
    assert value.elapsed_time == 12
    assert value.total_tokens == 9
    assert value.attempt_count == value.token_reporting_numerator == value.token_reporting_denominator == 2
    pinned = repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=first, now=NOW + timedelta(hours=1))
    assert pinned.total_tokens == 0
    assert pinned.attempt_count == 1
    assert pinned.elapsed_time == 2


def test_partial_usage_keeps_total_unknown_and_excludes_unsubmitted_retry(sessions: sessionmaker[Session]) -> None:
    execution = uid()
    first = overview_attempt(sessions, execution_key=execution, sequence=0)
    second = overview_attempt(sessions, execution_key=execution, sequence=1, retry_of=first)
    latest = overview_attempt(
        sessions,
        execution_key=execution,
        sequence=2,
        retry_of=second,
        dispatched_at=None,
        local_state="failed",
        local_wait_ended_at=DBNOW + timedelta(seconds=30),
    )
    repository, _, _, _ = services(sessions)
    repository.record_usage(
        owner=repository.owner(tenant_id=TENANT, invocation_id=first, now=NOW),
        usage=ReportedCallUsage(0, "call/total", "controlled-adapter"),
        revision=1,
        now=NOW,
    )
    value = repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=latest, now=NOW)
    assert value.total_tokens is None
    assert value.token_reporting_numerator == 1
    assert value.attempt_count == value.token_reporting_denominator == 2
    assert value.elapsed_time == 30


def test_step_tokens_are_not_a_proof_of_call_total_usage(sessions: sessionmaker[Session]) -> None:
    identifier = overview_attempt(sessions)
    repository, observation, _, _ = services(sessions)
    trace = observation.record_trace(
        tenant_id=TENANT,
        invocation_id=identifier,
        payload={"trace_id": "remote", "steps": [{"step_id": "s", "total_tokens": 999}]},
        source_id="test-step-carrier",
        received_at=NOW,
    )
    assert trace.steps[0].total_tokens == 999
    value = repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=identifier, now=NOW)
    assert value.total_tokens is None
    assert value.token_reporting_numerator == 0
    assert value.token_reporting_denominator == 1


@pytest.mark.parametrize("state", ["waiting", "retry_pending"])
def test_running_logical_duration_includes_retry_gap(sessions: sessionmaker[Session], state: str) -> None:
    identifier = overview_attempt(sessions, local_state=state)
    repository, _, _, _ = services(sessions)
    value = repository.test_statistics(
        CONTEXT, agent_id=AGENT, invocation_id=identifier, now=NOW + timedelta(seconds=40)
    )
    assert value.elapsed_time == 40
    assert value.total_tokens is None
    assert value.attempt_count == 1


@pytest.mark.parametrize(
    "change",
    [
        {"tenant_id": OTHER},
        {"initiator_id": EDITOR},
        {"agent_id": APP},
        {"origin": "production"},
        {"origin": "node_debug"},
        {"app_id": APP},
        {"deleted_at": DBNOW},
    ],
)
def test_statistics_rejects_wrong_actor_asset_origin_tenant_and_deleted_scope(
    sessions: sessionmaker[Session], change: dict[str, object]
) -> None:
    identifier = overview_attempt(sessions, **change)
    repository, _, _, _ = services(sessions)
    with pytest.raises(ExternalRuntimeError) as error:
        repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=identifier, now=NOW)
    assert error.value.code == "invocation_not_found"


@pytest.mark.parametrize("expiry", ["test_expires_at", "retention_expires_at"])
def test_expired_attempt_cannot_contribute_to_another_live_retry(sessions: sessionmaker[Session], expiry: str) -> None:
    execution = uid()
    overview_attempt(sessions, execution_key=execution, sequence=0, **{expiry: DBNOW})
    latest = overview_attempt(sessions, execution_key=execution, sequence=1)
    repository, _, _, _ = services(sessions)
    with pytest.raises(ExternalRuntimeError) as error:
        repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=latest, now=NOW)
    assert error.value.code == "test_expired"


def test_tombstoned_attempt_cannot_reappear_in_retry_statistics(sessions: sessionmaker[Session]) -> None:
    execution = uid()
    first = overview_attempt(sessions, execution_key=execution, sequence=0)
    latest = overview_attempt(sessions, execution_key=execution, sequence=1)
    with sessions.begin() as session:
        session.add(
            ExternalAgentDataTombstone(
                id=uid(), tenant_id=TENANT, owner_kind="invocation", owner_id=first, deleted_at=DBNOW
            )
        )
    repository, _, _, _ = services(sessions)
    with pytest.raises(ExternalRuntimeError) as error:
        repository.test_statistics(CONTEXT, agent_id=AGENT, invocation_id=latest, now=NOW)
    assert error.value.code == "invocation_not_found"


def test_provider_overview_is_one_secret_free_sorted_snapshot(sessions: sessionmaker[Session]) -> None:
    repository, _, access, _ = services(sessions)
    cipher = WorkspaceBoundCipher()
    egress = RecordingEgress([], grpc_target=None)
    service = ExternalTracingConfigService(
        store=repository,
        access=access,
        provider=ProviderConfigGateway(
            providers=InstalledTraceProviders(), codec=ProviderConfigCodec(cipher), egress=egress
        ),
    )
    assert asdict(service.overview(CONTEXT, AGENT)) == {"enabled_provider": None, "providers": ()}
    for provider in ("phoenix", "langfuse"):
        repository.save_config(
            context=CONTEXT,
            agent_id=AGENT,
            provider=provider,
            encrypted_config={"secret": "never-return-this", "endpoint": "https://private.example"},
            enabled=True,
            capture_content=provider == "phoenix",
            expected_revision=0,
            now=NOW,
        )
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=OTHER,
                agent_id=AGENT,
                provider="foreign-provider",
                encrypted_config={"secret": "foreign-secret"},
                enabled=True,
            )
        )
    overview = service.overview(CONTEXT, AGENT)
    assert overview.enabled_provider == "langfuse"
    assert [value.provider for value in overview.providers] == ["langfuse", "phoenix"]
    assert overview.providers[0].enabled is True
    assert overview.providers[1].enabled is False
    assert overview.providers[1].capture_content is True
    assert set(asdict(overview.providers[0])) == {"provider", "revision", "enabled", "capture_content"}
    assert "never-return-this" not in json.dumps(asdict(overview))
    assert "private.example" not in json.dumps(asdict(overview))
    assert cipher.decrypted == []
    assert egress.requests == []
    for actor in (NORMAL, EDITOR):
        with pytest.raises(ObservationAccessDeniedError):
            service.overview(CONTEXT._replace(account_id=actor), AGENT)
    with sessions.begin() as session:
        session.execute(
            update(ExternalAgentTracingConfig)
            .where(ExternalAgentTracingConfig.tenant_id == TENANT, ExternalAgentTracingConfig.agent_id == AGENT)
            .values(enabled=False)
        )
    assert service.overview(CONTEXT, AGENT).enabled_provider is None


def test_corrupt_multiple_enabled_provider_state_fails_without_picking_one(sessions: sessionmaker[Session]) -> None:
    repository, _, access, _ = services(sessions)
    with sessions.begin() as session:
        for provider in ("phoenix", "langfuse"):
            session.add(
                ExternalAgentTracingConfig(
                    id=uid(), tenant_id=TENANT, agent_id=AGENT, provider=provider, enabled=True, encrypted_config={}
                )
            )
    service = ExternalTracingConfigService(
        store=repository,
        access=access,
        provider=ProviderConfigGateway(
            providers=InstalledTraceProviders(),
            codec=ProviderConfigCodec(WorkspaceBoundCipher()),
            egress=RecordingEgress([], grpc_target=None),
        ),
    )
    with pytest.raises(ObservationConflictError, match="tracing_provider_state_conflict"):
        service.overview(CONTEXT, AGENT)


def test_provider_overview_transport_has_no_config_values_and_denies_editor(endpoint_domain: EndpointDomain) -> None:
    _, context, agent, _, sessions = endpoint_domain
    assert wire(invoke(endpoint_domain, ExternalAgentTracingProviderOverviewApi, "get", agent_id=UUID(agent))) == {
        "enabled_provider": None,
        "providers": [],
    }
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=context.active_workspace_id,
                agent_id=agent,
                provider="phoenix",
                enabled=True,
                revision=7,
                encrypted_config={"secret": "never-return-this"},
            )
        )
    result = wire(invoke(endpoint_domain, ExternalAgentTracingProviderOverviewApi, "get", agent_id=UUID(agent)))
    assert result == {
        "enabled_provider": "phoenix",
        "providers": [{"provider": "phoenix", "revision": 7, "enabled": True, "capture_content": False}],
    }
    with sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == context.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.EDITOR
    with pytest.raises(Forbidden):
        invoke(endpoint_domain, ExternalAgentTracingProviderOverviewApi, "get", agent_id=UUID(agent))
