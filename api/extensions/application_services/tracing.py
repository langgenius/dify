"""Composition of the trace pipeline, Agent trace collection, and tracing provider configurations."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled
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
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import AgentTraceSettings
from services.tracing.delivery import TraceDeliveryService
from services.tracing.egress import SSRFEgress
from services.tracing.provider_configs import ProviderConfigGateway, TraceProviderCapabilitiesQuery
from services.tracing.providers import ProviderConfigCodec
from services.tracing.registry import EntryPointTraceProviderCatalog
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks
from services.tracing.scopes import TraceScopes
from services.tracing.service import ApplicationTracingService


@dataclass(frozen=True, slots=True)
class TracingServices:
    scopes: TraceScopes
    delivery: TraceDeliveryService
    agent_traces: ApplicationTracingService
    hooks: RuntimeApplicationTracingHooks | None
    """``None`` when the deployment does not collect Agent traces."""
    provider_configs: ProviderConfigGateway
    provider_capabilities: TraceProviderCapabilitiesQuery


def build_tracing_services(*, database_client: sessionmaker[Session]) -> TracingServices:
    egress = SSRFEgress()
    providers = EntryPointTraceProviderCatalog()
    codec = ProviderConfigCodec(WorkspaceTracingSecretCipher())
    builder = CanonicalTraceBuilder()
    configs = SQLAlchemyAppTracingConfigRepository(session_factory=database_client)
    enterprise_telemetry = is_enterprise_telemetry_enabled()
    agent_settings = AgentTraceSettings(
        enabled=dify_config.OPS_AGENT_TRACE_ENABLED,
        max_spans=dify_config.OPS_AGENT_TRACE_MAX_SPANS,
        max_bytes=dify_config.OPS_AGENT_TRACE_MAX_BYTES,
        collection_timeout_seconds=dify_config.OPS_AGENT_TRACE_COLLECTION_TIMEOUT,
        export_lease_seconds=dify_config.OPS_AGENT_TRACE_EXPORT_LEASE_SECONDS,
        max_export_attempts=dify_config.OPS_AGENT_TRACE_MAX_ATTEMPTS,
        retention_days=dify_config.OPS_AGENT_TRACE_RETENTION_DAYS,
    )
    agent_traces = ApplicationTracingService(
        traces=ApplicationTraceRepository(database_client),
        # App, workspace, and credential names are enterprise telemetry dimensions only.
        records=TraceRecordRepository(database_client, files_url=dify_config.FILES_URL, enterprise_details=False),
        builder=builder,
        providers=providers,
        codec=codec,
        egress=egress,
        schedule_export=schedule_agent_trace_export,
        settings=agent_settings,
    )
    return TracingServices(
        scopes=TraceScopes(
            emitter=CeleryTraceEmitter(), policies=configs, enterprise_enabled=is_enterprise_telemetry_enabled
        ),
        delivery=TraceDeliveryService(
            records=TraceRecordRepository(
                database_client, files_url=dify_config.FILES_URL, enterprise_details=enterprise_telemetry
            ),
            destinations=configs,
            providers=providers,
            codec=codec,
            builder=builder,
            egress=egress,
            retries=CeleryExportRetryQueue(),
            enterprise_sink=send_to_enterprise_telemetry if enterprise_telemetry else None,
            collector=agent_traces if agent_settings.enabled else None,
            max_export_attempts=dify_config.OPS_TRACE_EXPORT_MAX_ATTEMPTS,
        ),
        agent_traces=agent_traces,
        hooks=RuntimeApplicationTracingHooks(agent_traces) if agent_settings.enabled else None,
        provider_configs=ProviderConfigGateway(providers=providers, codec=codec, egress=egress),
        provider_capabilities=TraceProviderCapabilitiesQuery(
            providers=providers, api_collection_enabled=agent_settings.enabled
        ),
    )
