from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.client import DifyAgentHTTPError, DifyAgentTimeoutError, DifyAgentValidationError
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID
from dify_agent.protocol import SandboxListResult, SandboxReadResult, SandboxUploadResult

from clients.agent_backend.request_builder import CleanupLayerSpec
from core.workflow.nodes.agent_v2.session_store import StoredWorkflowAgentSession, WorkflowAgentSessionScope
from services.agent.sandbox_service import AgentAppSandboxService, SandboxOperationError, WorkflowAgentSandboxService


class _Store:
    def __init__(self, stored_session: StoredWorkflowAgentSession | None) -> None:
        self.stored_session = stored_session

    def load_active_session_for_node(self, **kwargs) -> StoredWorkflowAgentSession | None:
        self.last_kwargs = kwargs
        return self.stored_session



class _SandboxClient:
    def list_sandbox_files_sync(self, locator, *, path: str = ".") -> SandboxListResult:
        self.locator = locator
        self.path = path
        return SandboxListResult(path=path, entries=[], truncated=False)

    def read_sandbox_file_sync(self, locator, *, path: str, encoding: str, max_bytes: int) -> SandboxReadResult:
        self.locator = locator
        self.path = path
        self.encoding = encoding
        self.max_bytes = max_bytes
        return SandboxReadResult(path=path, encoding=encoding, content="hello", size=5, truncated=False)

    def upload_sandbox_file_sync(self, locator, *, path: str) -> SandboxUploadResult:
        self.locator = locator
        self.path = path
        return SandboxUploadResult(
            path=path,
            file={"id": "file-1", "name": path, "size": 5, "mime_type": "text/plain"},
        )


class _FailingHTTPClient:
    def list_sandbox_files_sync(self, locator, *, path: str = ".") -> SandboxListResult:
        del locator, path
        raise DifyAgentHTTPError(status_code=404, detail={"code": "sandbox_file_not_found", "message": "Missing file"})


class _FailingValidationClient:
    def list_sandbox_files_sync(self, locator, *, path: str = ".") -> SandboxListResult:
        del locator, path
        raise DifyAgentValidationError(detail={"field": "bad"})


class _FailingTransportClient:
    def list_sandbox_files_sync(self, locator, *, path: str = ".") -> SandboxListResult:
        del locator, path
        raise DifyAgentTimeoutError("connection lost")


def _stored_session() -> StoredWorkflowAgentSession:
    return StoredWorkflowAgentSession(
        scope=WorkflowAgentSessionScope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="node-exec-1",
            binding_id="binding-1",
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
        ),
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name="execution_context",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={},
                ),
                LayerSessionSnapshot(
                    name="shell",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={
                        "session_id": "internal",
                        "workspace_cwd": "/tmp/workspace",
                        "job_ids": [],
                        "job_offsets": {},
                    },
                ),
            ]
        ),
        backend_run_id="backend-run-1",
        composition_layer_specs=[
            CleanupLayerSpec(
                name="execution_context",
                type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                config={"tenant_id": "tenant-1", "invoke_from": "workflow_run"},
            ),
            CleanupLayerSpec(
                name="shell",
                type=DIFY_SHELL_LAYER_TYPE_ID,
                deps={"execution_context": "execution_context"},
                config={},
            ),
        ],
    )
def test_workflow_agent_sandbox_service_builds_locator_from_stored_session() -> None:
    store = _Store(_stored_session())
    client = _SandboxClient()
    service = WorkflowAgentSandboxService(session_store=store, sandbox_client=client)

    result = service.list_files(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        path=".",
    )

    assert result.path == "."
    assert [layer.name for layer in client.locator.composition.layers] == ["execution_context", "shell"]
    assert client.path == "."


def test_workflow_agent_sandbox_service_read_file_delegates_to_shared_client_method() -> None:
    store = _Store(_stored_session())
    client = _SandboxClient()
    service = WorkflowAgentSandboxService(session_store=store, sandbox_client=client)

    result = service.read_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        path="report.txt",
        encoding="utf-8",
        max_bytes=10,
    )

    assert result.content == "hello"
    assert [layer.name for layer in client.locator.composition.layers] == ["execution_context", "shell"]
    assert client.path == "report.txt"
    assert client.encoding == "utf-8"
    assert client.max_bytes == 10


def test_workflow_agent_sandbox_service_upload_file_delegates_to_shared_client_method() -> None:
    store = _Store(_stored_session())
    client = _SandboxClient()
    service = WorkflowAgentSandboxService(session_store=store, sandbox_client=client)

    result = service.upload_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        path="report.txt",
    )

    assert result.file.id == "file-1"
    assert [layer.name for layer in client.locator.composition.layers] == ["execution_context", "shell"]
    assert client.path == "report.txt"


def test_workflow_agent_sandbox_service_raises_not_found_without_active_session() -> None:
    service = WorkflowAgentSandboxService(session_store=_Store(None), sandbox_client=_SandboxClient())

    try:
        service.list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            path=".",
        )
    except SandboxOperationError as exc:
        assert exc.data["code"] == "sandbox_not_found"
    else:
        raise AssertionError("Expected sandbox_not_found error")


def test_workflow_agent_sandbox_service_maps_backend_http_error() -> None:
    service = WorkflowAgentSandboxService(session_store=_Store(_stored_session()), sandbox_client=_FailingHTTPClient())

    try:
        service.list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            path=".",
        )
    except SandboxOperationError as exc:
        assert exc.data["code"] == "sandbox_file_not_found"
        assert exc.data["message"] == "Missing file"
        assert exc.code == 404
    else:
        raise AssertionError("Expected sandbox_file_not_found error")


def test_workflow_agent_sandbox_service_maps_backend_validation_error() -> None:
    service = WorkflowAgentSandboxService(session_store=_Store(_stored_session()), sandbox_client=_FailingValidationClient())

    try:
        service.list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            path=".",
        )
    except SandboxOperationError as exc:
        assert exc.data["code"] == "sandbox_unavailable"
        assert exc.code == 502
    else:
        raise AssertionError("Expected sandbox_unavailable error")


def test_workflow_agent_sandbox_service_maps_backend_transport_error() -> None:
    service = WorkflowAgentSandboxService(session_store=_Store(_stored_session()), sandbox_client=_FailingTransportClient())

    try:
        service.list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            path=".",
        )
    except SandboxOperationError as exc:
        assert exc.data["code"] == "sandbox_unavailable"
        assert exc.code == 503
    else:
        raise AssertionError("Expected sandbox_unavailable error")


def test_agent_app_sandbox_service_reports_unavailable() -> None:
    service = AgentAppSandboxService()

    try:
        service.list_files(tenant_id="tenant-1", app_id="app-1", path="reports")
    except SandboxOperationError as exc:
        assert exc.data["code"] == "sandbox_unavailable"
        assert exc.code == 503
    else:
        raise AssertionError("Expected sandbox_unavailable error")
