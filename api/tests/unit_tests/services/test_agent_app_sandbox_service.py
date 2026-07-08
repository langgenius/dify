"""Unit tests for the Agent App / workflow sandbox services."""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import RuntimeLayerSpec, SandboxListResponse, SandboxReadResponse, SandboxUploadResponse
from sqlalchemy import delete

from core.app.apps.agent_app.session_store import AgentAppSessionScope, StoredAgentAppSession
from core.db.session_factory import session_factory
from models.agent import AgentRuntimeSession, AgentRuntimeSessionOwnerType, AgentRuntimeSessionStatus
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxInspectorError,
    AgentSandboxUploadDownload,
    WorkflowAgentSandboxService,
    _default_client_factory,
    _upload_download_response,
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


def _stored_session(
    *,
    session_snapshot: CompositorSessionSnapshot | None = None,
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
        runtime_layer_specs=_runtime_layer_specs(),
    )


def test_agent_app_sandbox_service_get_info_returns_metadata() -> None:
    store = FakeStore(_stored_session())
    client = FakeClient()
    service = AgentAppSandboxService(session_store=store, client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert result.session_id == "abc1234"
    assert result.workspace_cwd == "~/workspace/abc1234"
    assert client.calls == []
    assert store.scope == ("tenant-1", "app-1", "conv-1")


def test_agent_app_sandbox_service_builds_locator_and_proxies() -> None:
    store = FakeStore(_stored_session())
    client = FakeClient()
    service = AgentAppSandboxService(session_store=store, client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.list_files(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1", path=".")

    assert result.path == "."
    assert client.calls == [("list", ".")]
    assert store.scope == ("tenant-1", "app-1", "conv-1")


def test_agent_app_sandbox_service_upload_returns_download_url(monkeypatch: pytest.MonkeyPatch) -> None:
    store = FakeStore(_stored_session())
    client = FakeClient()
    captured: dict[str, object] = {}

    def fake_upload_download_response(*, tenant_id: str, file_mapping: dict[str, object]) -> AgentSandboxUploadDownload:
        captured["tenant_id"] = tenant_id
        captured["file_mapping"] = file_mapping
        return AgentSandboxUploadDownload(url="https://files.example/report.txt?token=1&as_attachment=true")

    monkeypatch.setattr("services.agent_app_sandbox_service._upload_download_response", fake_upload_download_response)
    service = AgentAppSandboxService(session_store=store, client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.upload_file(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1", path="report.txt")

    assert result.url == "https://files.example/report.txt?token=1&as_attachment=true"
    assert client.calls == [("upload", "report.txt")]
    assert store.scope == ("tenant-1", "app-1", "conv-1")
    assert captured == {
        "tenant_id": "tenant-1",
        "file_mapping": {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
    }


def test_agent_app_sandbox_service_raises_when_no_active_session() -> None:
    service = AgentAppSandboxService(session_store=FakeStore(None), client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert exc_info.value.code == "no_active_session"
    assert exc_info.value.status_code == 404


def test_agent_app_sandbox_service_raises_when_shell_workspace_metadata_missing() -> None:
    broken_session = _stored_session(session_snapshot=_snapshot(shell_runtime_state={"session_id": "abc1234"}))
    service = AgentAppSandboxService(session_store=FakeStore(broken_session), client_factory=lambda: FakeClient())  # type: ignore[arg-type]

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        service.get_info(tenant_id="tenant-1", app_id="app-1", conversation_id="conv-1")

    assert exc_info.value.code == "no_sandbox"
    assert exc_info.value.status_code == 404


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
def test_workflow_sandbox_service_resolves_locator_and_returns_download_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _insert_workflow_session()
    client = FakeClient()
    captured: dict[str, object] = {}

    def fake_upload_download_response(*, tenant_id: str, file_mapping: dict[str, object]) -> AgentSandboxUploadDownload:
        captured["tenant_id"] = tenant_id
        captured["file_mapping"] = file_mapping
        return AgentSandboxUploadDownload(url="https://files.example/report.txt?token=1&as_attachment=true")

    monkeypatch.setattr("services.agent_app_sandbox_service._upload_download_response", fake_upload_download_response)
    service = WorkflowAgentSandboxService(client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.upload_file(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="node-exec-1",
        path="report.txt",
        session=session_factory.create_session(),
    )

    assert result.url == "https://files.example/report.txt?token=1&as_attachment=true"
    assert client.calls == [("upload", "report.txt")]
    assert captured == {
        "tenant_id": "tenant-1",
        "file_mapping": {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
    }


def test_upload_download_response_resolves_signed_external_url(monkeypatch: pytest.MonkeyPatch) -> None:
    built_file = object()
    built_with: dict[str, object] = {}

    def fake_build_from_mapping(*, mapping: dict[str, object], tenant_id: str, access_controller: object) -> object:
        built_with["mapping"] = mapping
        built_with["tenant_id"] = tenant_id
        built_with["access_controller"] = access_controller
        return built_file

    class FakeRuntime:
        def __init__(self, *, file_access_controller: object) -> None:
            self.file_access_controller = file_access_controller

        def resolve_file_url(self, *, file: object, for_external: bool) -> str:
            assert file is built_file
            assert for_external is True
            return "https://files.example/files/tools/tool-file.txt?timestamp=1&nonce=2&sign=3"

    monkeypatch.setattr("services.agent_app_sandbox_service.file_factory.build_from_mapping", fake_build_from_mapping)
    monkeypatch.setattr("services.agent_app_sandbox_service.DifyWorkflowFileRuntime", FakeRuntime)

    result = _upload_download_response(
        tenant_id="tenant-1",
        file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
    )

    assert result.url == (
        "https://files.example/files/tools/tool-file.txt?timestamp=1&nonce=2&sign=3&as_attachment=true"
    )
    assert built_with["mapping"] == {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}
    assert built_with["tenant_id"] == "tenant-1"
    assert built_with["access_controller"] is not None


def test_upload_download_response_maps_resolution_failure_to_inspector_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_build_from_mapping(*, mapping: dict[str, object], tenant_id: str, access_controller: object) -> object:
        del mapping, tenant_id, access_controller
        raise ValueError("missing tool file")

    monkeypatch.setattr("services.agent_app_sandbox_service.file_factory.build_from_mapping", fake_build_from_mapping)

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        _upload_download_response(
            tenant_id="tenant-1",
            file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
        )

    assert exc_info.value.code == "sandbox_upload_download_unavailable"
    assert exc_info.value.status_code == 502


def test_upload_download_response_maps_missing_url_to_inspector_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    built_file = object()

    def fake_build_from_mapping(*, mapping: dict[str, object], tenant_id: str, access_controller: object) -> object:
        del mapping, tenant_id, access_controller
        return built_file

    class FakeRuntime:
        def __init__(self, *, file_access_controller: object) -> None:
            self.file_access_controller = file_access_controller

        def resolve_file_url(self, *, file: object, for_external: bool) -> None:
            assert file is built_file
            assert for_external is True

    monkeypatch.setattr("services.agent_app_sandbox_service.file_factory.build_from_mapping", fake_build_from_mapping)
    monkeypatch.setattr("services.agent_app_sandbox_service.DifyWorkflowFileRuntime", FakeRuntime)

    with pytest.raises(AgentSandboxInspectorError) as exc_info:
        _upload_download_response(
            tenant_id="tenant-1",
            file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
        )

    assert exc_info.value.code == "sandbox_upload_download_unavailable"
    assert exc_info.value.status_code == 502


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
        session=session_factory.create_session(),
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
        session=session_factory.create_session(),
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
            session=session_factory.create_session(),
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
            session=session_factory.create_session(),
        )

    assert exc_info.value.code == "no_sandbox"
