"""Composition root for External Agent control, execution, files and observations."""

import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

from celery import current_app as celery_app
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.application_services.rbac import RBACServices
from extensions.application_services.tracing import TracingServices
from extensions.ext_storage import storage
from libs.uuid_utils import uuidv7
from providers.a2a.control_adapters import (
    DifyExternalIconURLs,
    WorkspaceExternalAssetAccess,
    WorkspaceExternalSecretCodec,
)
from providers.a2a.files import DifyFileAdapter, RemoteFileRequester
from providers.a2a.gateway import A2AGateway
from providers.a2a.runtime_io import ExternalOutputNormalizer, ExternalRequestPartsBuilder
from providers.a2a.test_file_urls import DifyTestFileURLSigner
from providers.a2a.test_files import ExternalTestFileUpload
from providers.a2a.transport import BoundedTransport, SSRFRequester
from providers.a2a.workflow_access import ExternalWorkflowBindingAccess
from providers.a2a.workflow_node import DifyExternalWorkflowWake
from repositories.external_agents.asset_repository import ExternalAssetRepository
from repositories.external_agents.file_lifecycle_repository import ExternalFileLifecycleRepository
from repositories.external_agents.observability_repository import (
    ConnectionTraceSecretReader,
    DatabaseExternalObservationAccess,
    DatabaseTemporaryTestFileRemover,
    ExistingProviderTraceSender,
    ExternalObservabilityRepository,
)
from repositories.external_agents.runtime_repository import ExternalRuntimeRepository
from repositories.external_agents.test_file_access_repository import ExternalTestFileAccessRepository
from repositories.external_agents.test_file_repository import ExternalTestFileRepository
from repositories.external_agents.workflow_bindings import ExternalWorkflowBindingRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.external_agents.asset_service import ExternalAssetService
from services.external_agents.contracts import ExternalAgentLimits
from services.external_agents.file_profile import FILE_MODES, FileLimits
from services.external_agents.invocation_service import ExternalInvocationService
from services.external_agents.observability import ExternalObservabilityService
from services.external_agents.retention import ExternalRetentionService
from services.external_agents.runtime_contracts import RuntimeSettings
from services.external_agents.test_file_access import ExternalTestFileAccessService
from services.external_agents.test_service import ExternalTestService
from services.external_agents.traceability import TraceabilityNormalizer, TraceLimits
from services.external_agents.tracing_config import ExternalTraceDeliveryService, ExternalTracingConfigService
from services.external_agents.workflow_binding_service import ExternalWorkflowBindingService
from services.file_service import FileService
from services.tracing.adapters import WorkspaceTracingSecretCipher
from services.tracing.egress import SSRFEgress
from services.tracing.providers import ProviderConfigCodec
from services.tracing.registry import EntryPointTraceProviderCatalog

logger = logging.getLogger(__name__)


class _Clock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class _Ids:
    def new_id(self) -> str:
        return str(uuidv7())


def _resume(workflow_run_id: str) -> None:
    from tasks.app_generate import resume_app_execution

    resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": workflow_run_id}})


@dataclass(frozen=True, slots=True)
class ExternalAgentServices:
    enabled: bool
    assets: ExternalAssetService
    tests: ExternalTestService
    test_file_access: ExternalTestFileAccessService
    bindings: ExternalWorkflowBindingService
    runtime: ExternalInvocationService
    repository: ExternalRuntimeRepository
    observability: ExternalObservabilityService
    tracing_configs: ExternalTracingConfigService
    trace_delivery: ExternalTraceDeliveryService
    retention: ExternalRetentionService
    settings: RuntimeSettings
    limits: ExternalAgentLimits
    file_limits: FileLimits

    @property
    def capabilities(self) -> dict:
        return {
            "enabled": self.enabled,
            "protocol": "a2a-1.0.1",
            "transport": "HTTP+JSON",
            "authentication": ("none", "bearer"),
            "input_file_modes": tuple(sorted(FILE_MODES)),
            "limits": {**asdict(self.limits), "files": asdict(self.file_limits)},
        }

    def enqueue(self) -> None:
        try:
            celery_app.send_task("tasks.external_agent_task.drain_external_commands", queue="retention")
        except Exception:
            # Durable Commands are the source of truth; beat recovers a missed wakeup.
            logger.warning("External Agent command wakeup could not reach the broker")


def build_external_agent_services(
    *,
    sessions: sessionmaker[Session],
    workspaces: WorkspaceRepository,
    rbac: RBACServices,
    tracing: TracingServices,
    files: FileService,
) -> ExternalAgentServices:
    clock, ids = _Clock(), _Ids()
    codec = WorkspaceExternalSecretCodec()
    access = WorkspaceExternalAssetAccess(
        workspaces=workspaces, permissions=rbac.members, rbac_enabled=dify_config.RBAC_ENABLED
    )
    assets = ExternalAssetRepository(session_factory=sessions)
    limits = ExternalAgentLimits(
        logical_budget_seconds=min(
            dify_config.EXTERNAL_AGENTS_LOGICAL_BUDGET_SECONDS, dify_config.WORKFLOW_MAX_EXECUTION_TIME
        ),
        connect_timeout_seconds=dify_config.EXTERNAL_AGENTS_HTTP_CONNECT_SECONDS,
        request_timeout_seconds=dify_config.EXTERNAL_AGENTS_HTTP_TIMEOUT_SECONDS,
        sse_window_seconds=dify_config.EXTERNAL_AGENTS_SSE_WINDOW_SECONDS,
        poll_interval_seconds=dify_config.EXTERNAL_AGENTS_POLL_SECONDS,
        cancellation_window_seconds=dify_config.EXTERNAL_AGENTS_CANCEL_WINDOW_SECONDS,
        tracking_seconds=dify_config.EXTERNAL_AGENTS_TRACKING_SECONDS,
        max_background_queries=dify_config.EXTERNAL_AGENTS_BACKGROUND_MAX_QUERIES,
        workspace_query_concurrency=dify_config.EXTERNAL_AGENTS_WORKSPACE_QUERY_CONCURRENCY,
        endpoint_query_concurrency=dify_config.EXTERNAL_AGENTS_ENDPOINT_QUERY_CONCURRENCY,
    )
    file_limits = FileLimits(
        max_files=min(dify_config.EXTERNAL_AGENTS_MAX_FILES, dify_config.UPLOAD_FILE_BATCH_LIMIT),
        max_document_bytes=min(
            dify_config.EXTERNAL_AGENTS_DOCUMENT_BYTES, dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024**2
        ),
        max_image_bytes=min(
            dify_config.EXTERNAL_AGENTS_IMAGE_BYTES, dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024**2
        ),
        max_total_bytes=dify_config.EXTERNAL_AGENTS_TOTAL_FILE_BYTES,
    )
    settings = RuntimeSettings(
        admission_enabled=dify_config.EXTERNAL_AGENTS_ENABLED,
        logical_budget_seconds=limits.logical_budget_seconds,
        io_timeout_seconds=limits.request_timeout_seconds,
        sse_window_seconds=limits.sse_window_seconds,
        poll_interval_seconds=limits.poll_interval_seconds,
        cancellation_window_seconds=limits.cancellation_window_seconds,
        tracking_seconds=limits.tracking_seconds,
        background_initial_interval_seconds=dify_config.EXTERNAL_AGENTS_BACKGROUND_INITIAL_SECONDS,
        background_max_interval_seconds=dify_config.EXTERNAL_AGENTS_BACKGROUND_MAX_SECONDS,
        background_max_queries=limits.max_background_queries,
        workspace_query_concurrency=limits.workspace_query_concurrency,
        endpoint_query_concurrency=limits.endpoint_query_concurrency,
    )
    transport_settings = {
        "max_concurrent_io": dify_config.EXTERNAL_AGENTS_IO_CONCURRENCY,
        "connect_timeout_seconds": limits.connect_timeout_seconds,
        "request_timeout_seconds": limits.request_timeout_seconds,
    }
    gateway = A2AGateway(BoundedTransport(SSRFRequester(), **transport_settings), credential_decoder=codec)
    remote = BoundedTransport(RemoteFileRequester(), **transport_settings)
    file_adapter = DifyFileAdapter(
        sessions=sessions,
        storage=storage,
        files=files,
        lifecycle=ExternalFileLifecycleRepository(sessions=sessions),
        remote_transport=remote,
        limits=file_limits,
    )
    trace_limits = TraceLimits()
    observations = ExternalObservabilityRepository(sessions=sessions, limits=trace_limits)
    observation_access = DatabaseExternalObservationAccess(sessions=sessions, assets=access, permissions=rbac.members)
    observation_service = ExternalObservabilityService(
        store=observations,
        access=observation_access,
        normalizer=TraceabilityNormalizer(trace_limits),
        secrets=ConnectionTraceSecretReader(sessions=sessions, codec=codec),
    )
    trace_delivery = ExternalTraceDeliveryService(
        store=observations,
        access=observation_access,
        clock=clock.now,
        sender=ExistingProviderTraceSender(
            providers=EntryPointTraceProviderCatalog(),
            codec=ProviderConfigCodec(WorkspaceTracingSecretCipher()),
            egress=SSRFEgress(),
        ),
    )
    normalizer = ExternalOutputNormalizer(
        files=file_adapter,
        observations=observation_service,
        limits=file_limits,
        trace_delivery=trace_delivery,
        now=clock.now,
        max_variable_bytes=dify_config.MAX_VARIABLE_SIZE,
    )
    repository = ExternalRuntimeRepository(sessions, settings)
    runtime = ExternalInvocationService(
        store=repository,
        connections=repository,
        gateway=gateway,
        inputs=ExternalRequestPartsBuilder(
            assets=assets,
            files=file_adapter,
            limits=file_limits,
            trace_delivery=trace_delivery,
            now=clock.now,
            max_variable_bytes=dify_config.MAX_VARIABLE_SIZE,
        ),
        outputs=normalizer,
        observer=normalizer,
        wake=DifyExternalWorkflowWake(sessions=sessions, enqueue_resume=_resume),
        clock=clock,
        ids=ids,
        settings=settings,
    )
    return ExternalAgentServices(
        enabled=dify_config.EXTERNAL_AGENTS_ENABLED,
        test_file_access=ExternalTestFileAccessService(
            store=ExternalTestFileAccessRepository(sessions=sessions, clock=clock.now),
            access=access,
            signer=DifyTestFileURLSigner(
                secret_key=dify_config.SECRET_KEY,
                base_url=dify_config.FILES_URL,
                signature_ttl_seconds=dify_config.FILES_ACCESS_TIMEOUT,
                clock=clock.now,
            ),
        ),
        bindings=ExternalWorkflowBindingService(
            store=ExternalWorkflowBindingRepository(sessions=sessions),
            access=access,
            workflows=ExternalWorkflowBindingAccess(),
        ),
        assets=ExternalAssetService(
            store=assets,
            access=access,
            reference_access=observation_access,
            icons=DifyExternalIconURLs(),
            gateway=gateway,
            secrets=codec,
            clock=clock.now,
            new_id=ids.new_id,
            limits=limits,
        ),
        tests=ExternalTestService(
            assets=assets,
            access=access,
            runtime=runtime,
            statistics=observations,
            clock=clock,
            files=ExternalTestFileRepository(sessions=sessions, limits=file_limits),
            uploads=ExternalTestFileUpload(files=files, remote=remote, limits=file_limits),
            limits=file_limits,
            max_variable_bytes=dify_config.MAX_VARIABLE_SIZE,
        ),
        runtime=runtime,
        repository=repository,
        observability=observation_service,
        tracing_configs=ExternalTracingConfigService(
            store=observations, access=observation_access, provider=tracing.provider_configs
        ),
        trace_delivery=trace_delivery,
        retention=ExternalRetentionService(
            store=observations, files=DatabaseTemporaryTestFileRemover(sessions=sessions, storage=storage)
        ),
        settings=settings,
        limits=limits,
        file_limits=file_limits,
    )
