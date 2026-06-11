"""Console-facing services for Agent sandbox file operations.

These services hide the Agent backend's ``SandboxLocator`` protocol from Flask
controllers. Workflow sandbox access rebuilds a minimal Agent backend run
request from the persisted runtime session row, derives a locator with the
shared helper, and forwards the operation to ``/sandbox``. Agent App execution
in this worktree does not yet run through ``dify-agent`` shell-layer sessions,
so Agent App sandbox endpoints must remain explicitly unavailable instead of
fabricating shell state on the API host.
"""

from __future__ import annotations

from configs import dify_config
from dify_agent.client import DifyAgentClientError, DifyAgentHTTPError, DifyAgentTimeoutError, DifyAgentValidationError
from dify_agent.client import Client
from dify_agent.protocol import (
    CreateRunRequest,
    RunComposition,
    RunLayerSpec,
    SandboxListResult,
    SandboxLocator,
    SandboxReadEncoding,
    SandboxReadResult,
    SandboxUploadResult,
    build_sandbox_locator_from_run_request,
)
from libs.exception import BaseHTTPException

from clients.agent_backend.client import _normalize_dify_agent_error
from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError, AgentBackendValidationError
from clients.agent_backend.request_builder import CleanupLayerSpec
from core.workflow.nodes.agent_v2.session_store import StoredWorkflowAgentSession, WorkflowAgentRuntimeSessionStore


class SandboxOperationError(BaseHTTPException):
    """Console HTTP error with the backend sandbox ``{code, message}`` shape."""

    def __init__(self, *, error_code: str, description: str, status_code: int) -> None:
        self.error_code = error_code
        self.description = description
        self.code = status_code
        super().__init__(description)


class WorkflowAgentSandboxService:
    """Workflow-node sandbox operations backed by persisted runtime sessions."""

    session_store: WorkflowAgentRuntimeSessionStore
    sandbox_client: Client | None

    def __init__(
        self,
        *,
        session_store: WorkflowAgentRuntimeSessionStore,
        sandbox_client: Client | None,
    ) -> None:
        self.session_store = session_store
        self.sandbox_client = sandbox_client

    def list_files(self, *, tenant_id: str, app_id: str, workflow_run_id: str, node_id: str, path: str) -> SandboxListResult:
        locator = self._build_locator(tenant_id=tenant_id, app_id=app_id, workflow_run_id=workflow_run_id, node_id=node_id)
        return self._call_backend(lambda client: client.list_sandbox_files_sync(locator, path=path))

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        path: str,
        encoding: SandboxReadEncoding,
        max_bytes: int,
    ) -> SandboxReadResult:
        locator = self._build_locator(tenant_id=tenant_id, app_id=app_id, workflow_run_id=workflow_run_id, node_id=node_id)
        return self._call_backend(
            lambda client: client.read_sandbox_file_sync(locator, path=path, encoding=encoding, max_bytes=max_bytes)
        )

    def upload_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        path: str,
    ) -> SandboxUploadResult:
        locator = self._build_locator(tenant_id=tenant_id, app_id=app_id, workflow_run_id=workflow_run_id, node_id=node_id)
        return self._call_backend(lambda client: client.upload_sandbox_file_sync(locator, path=path))

    def _build_locator(self, *, tenant_id: str, app_id: str, workflow_run_id: str, node_id: str) -> SandboxLocator:
        stored_session = self.session_store.load_active_session_for_node(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
        )
        if stored_session is None:
            raise SandboxOperationError(
                error_code="sandbox_not_found",
                description="No active workflow sandbox session was found.",
                status_code=404,
            )
        try:
            request = _build_request_from_stored_session(stored_session)
            return build_sandbox_locator_from_run_request(request)
        except ValueError as exc:
            raise SandboxOperationError(
                error_code="sandbox_not_found",
                description=str(exc) or "Workflow sandbox session cannot be resumed.",
                status_code=404,
            ) from exc

    def _call_backend(self, operation):
        client = self.sandbox_client
        if client is None:
            raise SandboxOperationError(
                error_code="sandbox_unavailable",
                description="Agent backend sandbox client is not configured.",
                status_code=503,
            )
        try:
            return operation(client)
        except (DifyAgentValidationError, DifyAgentHTTPError, DifyAgentTimeoutError, DifyAgentClientError) as exc:
            backend_error = _normalize_dify_agent_error(exc)
            if isinstance(backend_error, AgentBackendHTTPError):
                detail = backend_error.detail
                if isinstance(detail, dict) and isinstance(detail.get("code"), str) and isinstance(detail.get("message"), str):
                    raise SandboxOperationError(
                        error_code=detail["code"],
                        description=detail["message"],
                        status_code=backend_error.status_code,
                    ) from exc
                raise SandboxOperationError(
                    error_code="sandbox_unavailable",
                    description=str(backend_error),
                    status_code=502,
                ) from exc
            if isinstance(backend_error, AgentBackendValidationError):
                raise SandboxOperationError(
                    error_code="sandbox_unavailable",
                    description=str(backend_error),
                    status_code=502,
                ) from exc
            if isinstance(backend_error, AgentBackendTransportError):
                raise SandboxOperationError(
                    error_code="sandbox_unavailable",
                    description=str(backend_error),
                    status_code=503,
                ) from exc
            raise SandboxOperationError(
                error_code="sandbox_unavailable",
                description=str(backend_error),
                status_code=503,
            ) from exc


class AgentAppSandboxService:
    """Agent App sandbox operations.

    Agent App requests are intentionally unavailable until the production Agent
    App runtime executes through ``dify-agent`` and returns a real shell-layer
    ``session_snapshot``. Returning a precise 503 is safer than persisting a
    synthetic workspace path on the API host that would not map to the actual
    execution environment.
    """

    def list_files(self, *, tenant_id: str, app_id: str, path: str) -> SandboxListResult:
        del tenant_id, app_id, path
        raise SandboxOperationError(
            error_code="sandbox_unavailable",
            description="Agent App sandbox is unavailable until Agent App execution runs through dify-agent shell sessions.",
            status_code=503,
        )

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        path: str,
        encoding: SandboxReadEncoding,
        max_bytes: int,
    ) -> SandboxReadResult:
        del tenant_id, app_id, path, encoding, max_bytes
        raise SandboxOperationError(
            error_code="sandbox_unavailable",
            description="Agent App sandbox is unavailable until Agent App execution runs through dify-agent shell sessions.",
            status_code=503,
        )

    def upload_file(self, *, tenant_id: str, app_id: str, path: str) -> SandboxUploadResult:
        del tenant_id, app_id, path
        raise SandboxOperationError(
            error_code="sandbox_unavailable",
            description="Agent App sandbox is unavailable until Agent App execution runs through dify-agent shell sessions.",
            status_code=503,
        )


def build_workflow_agent_sandbox_service() -> WorkflowAgentSandboxService:
    """Wire the workflow sandbox service with standard production dependencies."""
    sandbox_client: Client | None = None
    if dify_config.AGENT_BACKEND_BASE_URL:
        sandbox_client = Client(base_url=dify_config.AGENT_BACKEND_BASE_URL)
    return WorkflowAgentSandboxService(
        session_store=WorkflowAgentRuntimeSessionStore(),
        sandbox_client=sandbox_client,
    )


def build_agent_app_sandbox_service() -> AgentAppSandboxService:
    """Wire the Agent App sandbox service."""
    return AgentAppSandboxService()


def _build_request_from_stored_session(stored_session: StoredWorkflowAgentSession) -> CreateRunRequest:
    layers = [_run_layer_spec_from_cleanup_spec(spec) for spec in stored_session.composition_layer_specs]
    return CreateRunRequest(
        composition=RunComposition(layers=layers),
        session_snapshot=stored_session.session_snapshot,
    )


def _run_layer_spec_from_cleanup_spec(spec: CleanupLayerSpec) -> RunLayerSpec:
    return RunLayerSpec(
        name=spec.name,
        type=spec.type,
        deps=dict(spec.deps),
        metadata=dict(spec.metadata),
        config=spec.config,
    )
__all__ = [
    "AgentAppSandboxService",
    "SandboxOperationError",
    "WorkflowAgentSandboxService",
    "build_agent_app_sandbox_service",
    "build_workflow_agent_sandbox_service",
]
