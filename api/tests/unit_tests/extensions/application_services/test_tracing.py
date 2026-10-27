from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.application_services.tracing import build_tracing_services
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing.adapters import (
    CeleryExportRetryQueue,
    CeleryTraceEmitter,
    WorkspaceTracingSecretCipher,
    schedule_agent_trace_export,
    send_to_enterprise_telemetry,
)
from services.tracing.egress import SSRFEgress
from services.tracing.registry import EntryPointTraceProviderCatalog
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks


def test_delivery_reads_through_the_deployment_adapters(sqlite_session_factory: sessionmaker[Session]) -> None:
    tracing = build_tracing_services(database_client=sqlite_session_factory)
    delivery = tracing.delivery

    assert isinstance(delivery._records, TraceRecordRepository)
    assert delivery._records._sessions is sqlite_session_factory
    assert isinstance(delivery._destinations, SQLAlchemyAppTracingConfigRepository)
    assert isinstance(delivery._providers, EntryPointTraceProviderCatalog)
    assert isinstance(delivery._codec._cipher, WorkspaceTracingSecretCipher)
    assert isinstance(delivery._egress, SSRFEgress)
    assert isinstance(delivery._retries, CeleryExportRetryQueue)
    assert isinstance(tracing.scopes._emitter, CeleryTraceEmitter)
    assert isinstance(tracing.scopes._policies, SQLAlchemyAppTracingConfigRepository)
    assert tracing.provider_configs._providers is delivery._providers
    assert tracing.provider_configs._codec is delivery._codec


def test_agent_collection_shares_the_providers_and_schedules_exports_on_the_trace_queue(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tracing = build_tracing_services(database_client=sqlite_session_factory)
    agent_traces = tracing.agent_traces

    assert isinstance(agent_traces._traces, ApplicationTraceRepository)
    assert isinstance(agent_traces._records, TraceRecordRepository)
    # Agent traces never carry the enterprise telemetry dimensions.
    assert agent_traces._records._enterprise_details is False
    assert agent_traces._providers is tracing.delivery._providers
    assert agent_traces._schedule_export is schedule_agent_trace_export


@pytest.mark.parametrize("enabled", [True, False])
def test_agent_collection_joins_delivery_only_when_enabled(
    sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None], enabled: bool
) -> None:
    config_overrides(OPS_AGENT_TRACE_ENABLED=enabled, OPS_AGENT_TRACE_MAX_ATTEMPTS=3)

    tracing = build_tracing_services(database_client=sqlite_session_factory)

    assert (tracing.delivery._collector is tracing.agent_traces) is enabled
    assert isinstance(tracing.hooks, RuntimeApplicationTracingHooks) is enabled
    assert tracing.agent_traces._settings.enabled is enabled
    assert tracing.agent_traces._settings.max_export_attempts == 3
    assert tracing.provider_capabilities._api_collection_enabled is enabled


@pytest.mark.parametrize("edition", [DeploymentEdition.ENTERPRISE, DeploymentEdition.COMMUNITY])
def test_enterprise_telemetry_receives_records_with_its_dimensions_only_when_enabled(
    sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None], edition: DeploymentEdition
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition, ENTERPRISE_TELEMETRY_ENABLED=True, OPS_TRACE_EXPORT_MAX_ATTEMPTS=4)
    enterprise = edition == DeploymentEdition.ENTERPRISE

    delivery = build_tracing_services(database_client=sqlite_session_factory).delivery

    assert (delivery._enterprise_sink is send_to_enterprise_telemetry) is enterprise
    assert isinstance(delivery._records, TraceRecordRepository)
    assert delivery._records._enterprise_details is enterprise
    assert delivery._max_export_attempts == 4
