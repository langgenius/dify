"""Unit tests for the Agent App sandbox workspace inspector service.

These cover session-id resolution from the conversation snapshot and proxying to
the backend client, with fakes for the session store and client (no DB / no HTTP).
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from sqlalchemy import delete

from clients.agent_backend.workspace_files_client import (
    WorkspaceDownloadResult,
    WorkspaceFileEntry,
    WorkspaceListResult,
    WorkspacePreviewResult,
)
from core.db.session_factory import session_factory
from models.agent import AgentRuntimeSession, AgentRuntimeSessionOwnerType, AgentRuntimeSessionStatus
from services.agent_app_workspace_service import (
    AgentAppWorkspaceService,
    AgentWorkspaceInspectorError,
    WorkflowAgentWorkspaceService,
)


def _snapshot(*, shell: bool = True, session_id: str | None = "abc1234") -> CompositorSessionSnapshot:
    layers = [LayerSessionSnapshot(name="history", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={})]
    if shell and session_id is not None:
        layers.append(
            LayerSessionSnapshot(
                name="shell",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={"session_id": session_id, "workspace_cwd": f"~/workspace/{session_id}"},
            )
        )
    elif shell:
        layers.append(LayerSessionSnapshot(name="shell", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}))
    return CompositorSessionSnapshot(layers=layers)


class FakeStore:
    def __init__(self, snapshot: CompositorSessionSnapshot | None) -> None:
        self._snapshot = snapshot
        self.scope: tuple[str, str, str] | None = None

    def load_active_snapshot_for_conversation(
        self, *, tenant_id: str, app_id: str, conversation_id: str
    ) -> CompositorSessionSnapshot | None:
        self.scope = (tenant_id, app_id, conversation_id)
        return self._snapshot


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def list_files(self, session_id: str, path: str) -> WorkspaceListResult:
        self.calls.append(("list", session_id, path))
        return WorkspaceListResult(
            path=path, entries=[WorkspaceFileEntry(name="a.txt", type="file", size=1, mtime=1)], truncated=False
        )

    def preview(self, session_id: str, path: str) -> WorkspacePreviewResult:
        self.calls.append(("preview", session_id, path))
        return WorkspacePreviewResult(path=path, size=5, truncated=False, binary=False, text="hello")

    def download(self, session_id: str, path: str) -> WorkspaceDownloadResult:
        self.calls.append(("download", session_id, path))
        return WorkspaceDownloadResult(path=path, size=3, truncated=False, content=b"abc")


def _service(
    snapshot: CompositorSessionSnapshot | None,
) -> tuple[AgentAppWorkspaceService, FakeClient, FakeStore]:
    store = FakeStore(snapshot)
    client = FakeClient()
    service = AgentAppWorkspaceService(session_store=store, client_factory=lambda: client)  # type: ignore[arg-type]
    return service, client, store


def test_list_resolves_session_id_and_proxies() -> None:
    service, client, store = _service(_snapshot(session_id="abc1234"))

    result = service.list_files(tenant_id="t1", app_id="app1", conversation_id="conv1", path="sub")

    assert result.entries[0].name == "a.txt"
    assert client.calls == [("list", "abc1234", "sub")]
    assert store.scope == ("t1", "app1", "conv1")


def test_preview_and_download_use_resolved_session() -> None:
    service, client, _ = _service(_snapshot(session_id="abc1234"))

    preview = service.preview(tenant_id="t", app_id="a", conversation_id="c", path="n.txt")
    download = service.download(tenant_id="t", app_id="a", conversation_id="c", path="b.bin")

    assert preview.text == "hello"
    assert download.content == b"abc"
    assert client.calls == [("preview", "abc1234", "n.txt"), ("download", "abc1234", "b.bin")]


def test_no_active_session_raises_404() -> None:
    service, client, _ = _service(None)

    with pytest.raises(AgentWorkspaceInspectorError) as exc_info:
        service.list_files(tenant_id="t", app_id="a", conversation_id="c", path=".")

    assert exc_info.value.code == "no_active_session"
    assert exc_info.value.status_code == 404
    assert client.calls == []


def test_snapshot_without_shell_layer_raises_no_sandbox() -> None:
    service, _, _ = _service(_snapshot(shell=False))

    with pytest.raises(AgentWorkspaceInspectorError) as exc_info:
        service.list_files(tenant_id="t", app_id="a", conversation_id="c", path=".")

    assert exc_info.value.code == "no_sandbox"
    assert exc_info.value.status_code == 404


def test_shell_layer_without_session_id_raises_no_sandbox() -> None:
    service, _, _ = _service(_snapshot(session_id=None))

    with pytest.raises(AgentWorkspaceInspectorError) as exc_info:
        service.preview(tenant_id="t", app_id="a", conversation_id="c", path="n.txt")

    assert exc_info.value.code == "no_sandbox"


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
    workflow_run_id: str = "run-1",
    node_id: str = "node-1",
    node_execution_id: str = "node-exec-1",
    binding_id: str = "binding-1",
    session_id: str = "abc1234",
) -> None:
    with session_factory.create_session() as session:
        session.add(
            AgentRuntimeSession(
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
                backend_run_id="backend-run-1",
                session_snapshot=_snapshot(session_id=session_id).model_dump_json(),
                composition_layer_specs="[]",
                status=AgentRuntimeSessionStatus.ACTIVE,
            )
        )
        session.commit()


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_workspace_service_resolves_run_node_session_and_proxies() -> None:
    _insert_workflow_session(session_id="def5678")
    client = FakeClient()
    service = WorkflowAgentWorkspaceService(client_factory=lambda: client)  # type: ignore[arg-type]

    result = service.list_files(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="node-exec-1",
        path=".",
    )

    assert result.entries[0].name == "a.txt"
    assert client.calls == [("list", "def5678", ".")]


@pytest.mark.usefixtures("_runtime_session_table")
def test_workflow_workspace_service_filters_by_node_execution_id() -> None:
    _insert_workflow_session(node_execution_id="node-exec-1", session_id="abc1234")
    _insert_workflow_session(node_execution_id="node-exec-2", binding_id="binding-2", session_id="def5678")
    client = FakeClient()
    service = WorkflowAgentWorkspaceService(client_factory=lambda: client)  # type: ignore[arg-type]

    _ = service.preview(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="node-exec-2",
        path="out.txt",
    )

    assert client.calls == [("preview", "def5678", "out.txt")]
