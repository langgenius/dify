"""Resolve and proxy read-only access to an Agent App conversation's sandbox.

The Agent App's shell layer runs bash in a per-conversation sandbox workspace on
the agent backend. The workspace identity (``session_id``) is generated inside
the shell layer and rides the conversation's ``session_snapshot``. This service
extracts that id and proxies list/preview/download to the agent backend's
read-only workspace endpoints, so the console can show a "sandbox file system"
inspector without the API ever touching shellctl directly.
"""

from __future__ import annotations

from collections.abc import Callable

from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import select

from clients.agent_backend.request_builder import DIFY_SHELL_LAYER_ID
from clients.agent_backend.workspace_files_client import (
    WorkspaceDownloadResult,
    WorkspaceFilesBackendClient,
    WorkspaceListResult,
    WorkspacePreviewResult,
)
from configs import dify_config
from core.app.apps.agent_app.session_store import AgentAppRuntimeSessionStore
from core.db.session_factory import session_factory
from models.agent import (
    AgentRuntimeSessionOwnerType,
    WorkflowAgentRuntimeSession,
    WorkflowAgentRuntimeSessionStatus,
)


class AgentWorkspaceInspectorError(Exception):
    """A workspace inspection failure mapped to an HTTP status by the controller."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class AgentAppWorkspaceService:
    """List/preview/download files in an Agent App conversation's sandbox workspace."""

    def __init__(
        self,
        *,
        session_store: AgentAppRuntimeSessionStore | None = None,
        client_factory: Callable[[], WorkspaceFilesBackendClient] | None = None,
    ) -> None:
        self._session_store = session_store or AgentAppRuntimeSessionStore()
        self._client_factory = client_factory or _default_client_factory

    def list_files(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> WorkspaceListResult:
        session_id = self._resolve_session_id(tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id)
        return self._client_factory().list_files(session_id, path)

    def preview(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> WorkspacePreviewResult:
        session_id = self._resolve_session_id(tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id)
        return self._client_factory().preview(session_id, path)

    def download(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str) -> WorkspaceDownloadResult:
        session_id = self._resolve_session_id(tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id)
        return self._client_factory().download(session_id, path)

    def _resolve_session_id(self, *, tenant_id: str, app_id: str, conversation_id: str) -> str:
        snapshot = self._session_store.load_active_snapshot_for_conversation(
            tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id
        )
        if snapshot is None:
            raise AgentWorkspaceInspectorError(
                "no_active_session",
                "this conversation has no active sandbox session yet",
                status_code=404,
            )
        session_id = _shell_session_id(snapshot)
        if not session_id:
            raise AgentWorkspaceInspectorError(
                "no_sandbox",
                "this conversation's agent has no sandbox workspace",
                status_code=404,
            )
        return session_id


class WorkflowAgentWorkspaceService:
    """List/preview/download files in a Workflow Agent node sandbox workspace."""

    def __init__(
        self,
        *,
        client_factory: Callable[[], WorkspaceFilesBackendClient] | None = None,
    ) -> None:
        self._client_factory = client_factory or _default_client_factory

    def list_files(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ) -> WorkspaceListResult:
        session_id = self._resolve_session_id(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
        )
        return self._client_factory().list_files(session_id, path)

    def preview(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ) -> WorkspacePreviewResult:
        session_id = self._resolve_session_id(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
        )
        return self._client_factory().preview(session_id, path)

    def download(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ) -> WorkspaceDownloadResult:
        session_id = self._resolve_session_id(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
        )
        return self._client_factory().download(session_id, path)

    def _resolve_session_id(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
    ) -> str:
        stmt = select(WorkflowAgentRuntimeSession).where(
            WorkflowAgentRuntimeSession.owner_type == AgentRuntimeSessionOwnerType.WORKFLOW_RUN,
            WorkflowAgentRuntimeSession.tenant_id == tenant_id,
            WorkflowAgentRuntimeSession.app_id == app_id,
            WorkflowAgentRuntimeSession.workflow_run_id == workflow_run_id,
            WorkflowAgentRuntimeSession.node_id == node_id,
            WorkflowAgentRuntimeSession.status == WorkflowAgentRuntimeSessionStatus.ACTIVE,
        )
        if node_execution_id:
            stmt = stmt.where(WorkflowAgentRuntimeSession.node_execution_id == node_execution_id)
        stmt = stmt.order_by(WorkflowAgentRuntimeSession.updated_at.desc()).limit(1)

        with session_factory.create_session() as session:
            row = session.scalar(stmt)

        if row is None:
            raise AgentWorkspaceInspectorError(
                "no_active_session",
                "this workflow Agent node has no active sandbox session yet",
                status_code=404,
            )
        snapshot = CompositorSessionSnapshot.model_validate_json(row.session_snapshot)
        session_id = _shell_session_id(snapshot)
        if not session_id:
            raise AgentWorkspaceInspectorError(
                "no_sandbox",
                "this workflow Agent node has no sandbox workspace",
                status_code=404,
            )
        return session_id


def _shell_session_id(snapshot: CompositorSessionSnapshot) -> str | None:
    for layer in snapshot.layers:
        if layer.name == DIFY_SHELL_LAYER_ID:
            session_id = layer.runtime_state.get("session_id")
            return session_id if isinstance(session_id, str) and session_id else None
    return None


def _default_client_factory() -> WorkspaceFilesBackendClient:
    base_url = dify_config.AGENT_BACKEND_BASE_URL
    if not base_url:
        raise AgentWorkspaceInspectorError(
            "inspector_unavailable",
            "the sandbox file inspector is not available (agent backend not configured)",
            status_code=503,
        )
    return WorkspaceFilesBackendClient(base_url)


__all__ = ["AgentAppWorkspaceService", "AgentWorkspaceInspectorError", "WorkflowAgentWorkspaceService"]
