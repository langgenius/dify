"""Unit tests for the Agent App / workflow sandbox services."""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.client import DifyAgentHTTPError
from dify_agent.protocol import RuntimeLayerSpec, SandboxListResponse, SandboxReadResponse, SandboxUploadResponse
from sqlalchemy import delete

from core.app.apps.agent_app.session_store import AgentAppSessionScope, StoredAgentAppSession
from core.db.session_factory import session_factory
from models.agent import AgentRuntimeSession, AgentRuntimeSessionOwnerType, AgentRuntimeSessionStatus
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxInspectorError,
    WorkflowAgentSandboxService,
    _default_client_factory,
)


def _snapshot(
    *,
    session_id: str = "abc1234",
    shell_runtime_state: dict[str, str] | None = None,
) -> CompositorSessionSnapshot:
    runtime_state = (
        {"session_id": session_id, "workspace_cwd": f"~/workspace/{session_id}"}
        if shell_runtime_state is None
        else shell_runtime_state
    )
    return CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(
                name="shell",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state=runtime_state,
            ),
        ]
    )


def _runtime_layer_specs() -> list[RuntimeLayerSpec]:
    return [
        RuntimeLayerSpec(name="execution_context", type="dify.execution_context", config={"tenant_id": "tenant-1"}),
        RuntimeLayerSpec(name="shell", type="dify.shell", deps={"execution_context": "execution_context"}, config={}),
    ]


class FakeStore:
    def __init__(self, session: StoredAgentAppSession | None) -> None:
        self.session = session
        self.scope: tuple[str, str, str] | None = None

    def load_active_session_for_conversation(self, *, tenant_id: str, app_id: str, conversation_id: str):
        self.scope = (tenant_id, app_id, conversation_id)
        return self.session


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.locators: list[object] = []

    def list_sandbox_files_sync(self, locator, path: str) -> SandboxListResponse:
        self.locators.append(locator)
        self.calls.append(("list", path))
        return SandboxListResponse(path=path, entries=[], truncated=False)

    def read_sandbox_file_sync(self, locator, path: str, max_bytes: int = 262144) -> SandboxReadResponse:
        del max_bytes
        self.locators.append(locator)
        self.calls.append(("read", path))
        return SandboxReadResponse(path=path, size=5, truncated=False, binary=False, text="hello")

    def upload_sandbox_file_sync(self, locator, path: str) -> SandboxUploadResponse:
        self.locators.append(locator)
        self.calls.append(("upload", path))
        return SandboxUploadResponse(
            path=path, file={"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}
        )


class FailingListClient:
    def list_sandbox_files_sync(self, locator, path: str) -> SandboxListResponse:
        del locator, path
        raise DifyAgentHTTPError(404, {"code": "sandbox_not_found", "message": "sandbox is gone"})


def _stored_session(
    *,
    session_snapshot: CompositorSessionSnapshot | None = None,
    runtime_layer_specs: list[RuntimeLayerSpec] | None = None,
) -> StoredAgentAppSession:
    return StoredAgentAppSession(
        scope=AgentAppSessionScope(
            tenant_id="tenant-1",
            app_id="app-1",
            conversation_id="conv-1",
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
        ),
        session_snapshot=_snapshot() if session_snapshot is None else session_snapshot,
        backend_run_id="run-1",
        runtime_layer_specs=_runtime_layer_specs() if runtime_layer_specs is None else runtime_layer_specs,
    )


def test_agent_app_sandbox_service_get_info_probes_and_returns_metadata() -> None:
    store = FakeStore(_stored_session())
    client = FakeClient()
    service = AgentAppSandboxService(session_store=store, client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert result.session_id == "abc1234"
    assert result.workspace_cwd == "~/workspace/abc1234"
    assert client.calls == [("list", ".")]
    assert store.scope == ("tenant-1", "app-1", "conv-1")


def test_agent_app_sandbox_service_builds_locator_and_proxies() -> None:
    store = FakeStore(_stored_session())
    client = FakeClient()
    service = AgentAppSandboxService(session_store=store, client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.list_files(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1", path=".")

    assert result.path == "."
    assert client.calls == [("list", ".")]
    assert store.scope == ("tenant-1", "app-1", "conv-1")


def test_agent_app_sandbox_service_raises_when_no_active_session() -> None:
    service = AgentAppSandboxService(session_store=FakeStore(None), client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert exc_info.value.code == "no_active_session"
    assert exc_info.value.status_code == 404


def test_agent_app_sandbox_service_raises_when_runtime_specs_cannot_build_locator() -> None:
    broken_session = _stored_session(runtime_layer_specs=[])
    service = AgentAppSandboxService(session_store=FakeStore(broken_session), client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert exc_info.value.code == "no_sandbox"


@pytest.mark.parametrize(
    "runtime_state",
    [
        {"workspace_cwd": "~/workspace/abc1234"},
        {"session_id": "abc1234"},
    ],
)
def test_agent_app_sandbox_service_raises_when_shell_workspace_metadata_missing(
    runtime_state: dict[str, str],
) -> None:
    broken_session = _stored_session(session_snapshot=_snapshot(shell_runtime_state=runtime_state))
    service = AgentAppSandboxService(session_store=FakeStore(broken_session), client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert exc_info.value.code == "no_sandbox"
    assert exc_info.value.status_code == 404


def test_agent_app_sandbox_service_get_info_preserves_backend_probe_errors() -> None:
    service = AgentAppSandboxService(
        session_store=FakeStore(_stored_session()),
        client_factory=lambda: FailingListClient(),  # type: ignore[arg-type]
    )

    with pytest.raises(DifyAgentHTTPError) as exc_info:
        service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == {"code": "sandbox_not_found", "message": "sandbox is gone"}


def test_default_client_factory_requires_agent_backend_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.agent_app_sandbox_service.dify_config.AGENT_BACKEND_BASE_URL", "")

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        _default_client_factory()

    assert exc_info.value.code == "inspector_unavailable"
    assert exc_info.value.status_code == 503


@pytest.fixture
def _runtime_session_table() -> Generator[None, None, None]:
    engine = session_factory.get_session_maker().kw["bind"]
    AgentRuntimeSession.__table__.create(bind=engine, checkfirst=True)
    yield
    with session_factory.create_session() as session:
        session.execute(delete(AgentRuntimeSession))
        session.commit()
    AgentRuntimeSession.__table__.drop(bind=engine, checkfirst=True)


def _insert_workflow_session(
    *,
    runtime_layer_specs: str | None = None,
    workflow_run_id: str = "run-1",
    node_id: str = "node-1",
    node_execution_id: str = "node-exec-1",
    binding_id: str = "binding-1",
    backend_run_id: str = "backend-run-1",
    updated_at: datetime | None = None,
    session_id: str = "abc1234",
) -> None:
    default_runtime_layer_specs = (
        '[{"name":"execution_context","type":"dify.execution_context","config":{"tenant_id":"tenant-1"}},'
        '{"name":"shell","type":"dify.shell","deps":{"execution_context":"execution_context"},"config":{}}]'
    )
    with session_factory.create_session() as session:
        row = AgentRuntimeSession(
            tenant_id="tenant-1",
            app_id="app-1",
            owner_type=AgentRuntimeSessionOwnerType.WORKFLOW_RUN,
            workflow_id="workflow-1",
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
            binding_id=binding_id,
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
            backend_run_id=backend_run_id,
            session_snapshot=_snapshot(session_id=session_id).model_dump_json(),
            composition_layer_specs=runtime_layer_specs or default_runtime_layer_specs,
            status=AgentRuntimeSessionStatus.ACTIVE,
        )
        if updated_at is not None:
            row.updated_at = updated_at
        session.add(row)
        session.commit()


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_sandbox_service_resolves_locator_and_proxies() -> None:
    _insert_workflow_session()
    client = FakeClient()
    service = WorkflowAgentSandboxService(client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.upload_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="node-exec-1",
        path="report.txt",
    )

    assert result.file.reference == "dify-file-ref:file-1"
    assert client.calls == [("upload", "report.txt")]


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_sandbox_service_filters_by_node_execution_id() -> None:
    _insert_workflow_session(
        node_execution_id="node-exec-1",
        binding_id="binding-1",
        backend_run_id="run-a",
        session_id="abc1234",
    )
    _insert_workflow_session(
        node_execution_id="node-exec-2",
        binding_id="binding-2",
        backend_run_id="run-b",
        session_id="def5678",
    )
    client = FakeClient()
    service = WorkflowAgentSandboxService(client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.read_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="node-exec-2",
        path="out.txt",
    )

    assert result.text == "hello"
    assert client.calls == [("read", "out.txt")]
    assert client.locators[0].session_snapshot.layers[1].runtime_state["session_id"] == "def5678"


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_sandbox_service_uses_latest_active_session_when_execution_id_omitted() -> None:
    _insert_workflow_session(
        node_execution_id="node-exec-1",
        binding_id="binding-1",
        backend_run_id="run-older",
        updated_at=datetime(2026, 1, 1, 0, 0, 0),
        session_id="abc1234",
    )
    _insert_workflow_session(
        node_execution_id="node-exec-2",
        binding_id="binding-2",
        backend_run_id="run-newer",
        updated_at=datetime(2026, 1, 1, 0, 0, 1),
        session_id="def5678",
    )
    client = FakeClient()
    service = WorkflowAgentSandboxService(client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.list_files(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id=None,
        path=".",
    )

    assert result.path == "."
    assert client.calls == [("list", ".")]
    assert client.locators[0].session_snapshot.layers[1].runtime_state["session_id"] == "def5678"


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_sandbox_service_raises_when_no_active_session() -> None:
    service = WorkflowAgentSandboxService(client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id=None,
            path=".",
        )

    assert exc_info.value.code == "no_active_session"
    assert exc_info.value.status_code == 404


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_sandbox_service_raises_when_runtime_specs_missing() -> None:
    _insert_workflow_session(runtime_layer_specs="[]")
    service = WorkflowAgentSandboxService(client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.list_files(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id=None,
            path=".",
        )

    assert exc_info.value.code == "no_sandbox"
