"""Resolve and proxy sandbox file access for Agent App and workflow Agent sessions.

These services keep product-facing locators (conversation, workflow run, node)
on the API boundary and translate them into the agent backend's
``SandboxLocator`` using persisted non-sensitive runtime layer specs plus the
saved Agenton session snapshot.
"""

from __future__ import annotations

from collections.abc import Callable

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.client import Client
from dify_agent.protocol import RuntimeLayerSpec, SandboxLocator, build_sandbox_locator_from_layer_specs
from pydantic import TypeAdapter
from sqlalchemy import select

from configs import dify_config
from core.app.apps.agent_app.session_store import AgentAppRuntimeSessionStore
from core.db.session_factory import session_factory
from models.agent import AgentRuntimeSessionOwnerType, WorkflowAgentRuntimeSession, WorkflowAgentRuntimeSessionStatus

_RUNTIME_LAYER_SPECS_ADAPTER: TypeAdapter[list[RuntimeLayerSpec]] = TypeAdapter(list[RuntimeLayerSpec])


class AgentSandboxInspectorError(Exception):
    """A sandbox inspection failure mapped to an HTTP status by the controller."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class AgentAppSandboxService:
    """List/read/upload files in an Agent App conversation sandbox."""

    def __init__(
        self,
        *,
        session_store: AgentAppRuntimeSessionStore | None = None,
        client_factory: Callable[[], Client] | None = None,
    ) -> None:
        self._session_store = session_store or AgentAppRuntimeSessionStore()
        self._client_factory = client_factory or _default_client_factory

    def list_files(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str):
        locator = self._resolve_locator(tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id)
        return self._client_factory().list_sandbox_files_sync(locator, path)

    def read_file(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str):
        locator = self._resolve_locator(tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id)
        return self._client_factory().read_sandbox_file_sync(locator, path)

    def upload_file(self, *, tenant_id: str, app_id: str, conversation_id: str, path: str):
        locator = self._resolve_locator(tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id)
        return self._client_factory().upload_sandbox_file_sync(locator, path)

    def _resolve_locator(self, *, tenant_id: str, app_id: str, conversation_id: str) -> SandboxLocator:
        stored = self._session_store.load_active_session_for_conversation(
            tenant_id=tenant_id,
            app_id=app_id,
            conversation_id=conversation_id,
        )
        if stored is None:
            raise AgentSandboxInspectorError(
                "no_active_session",
                "this conversation has no active sandbox session yet",
                status_code=404,
            )
        return _build_locator_or_raise(
            snapshot=stored.session_snapshot,
            runtime_layer_specs=stored.runtime_layer_specs,
            not_found_message="this conversation's agent has no sandbox workspace",
        )


class WorkflowAgentSandboxService:
    """List/read/upload files in a workflow Agent node sandbox."""

    def __init__(self, *, client_factory: Callable[[], Client] | None = None) -> None:
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
    ):
        locator = self._resolve_locator(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
        )
        return self._client_factory().list_sandbox_files_sync(locator, path)

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ):
        locator = self._resolve_locator(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
        )
        return self._client_factory().read_sandbox_file_sync(locator, path)

    def upload_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
        path: str,
    ):
        locator = self._resolve_locator(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
        )
        return self._client_factory().upload_sandbox_file_sync(locator, path)

    def _resolve_locator(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str | None,
    ) -> SandboxLocator:
        """Resolve one workflow Agent sandbox from product-facing identifiers.

        Callers may target either a specific node execution or the current node
        as a whole. When ``node_execution_id`` is provided, lookup narrows to
        that execution's ACTIVE runtime-session row. When it is omitted, the
        service falls back to the most recently updated ACTIVE session for the
        same ``workflow_run_id + node_id`` pair so console sandbox inspection can
        still work from the broader workflow/node locator.
        """
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
            raise AgentSandboxInspectorError(
                "no_active_session",
                "this workflow Agent node has no active sandbox session yet",
                status_code=404,
            )
        return _build_locator_or_raise(
            snapshot=CompositorSessionSnapshot.model_validate_json(row.session_snapshot),
            runtime_layer_specs=_deserialize_runtime_layer_specs(row.composition_layer_specs),
            not_found_message="this workflow Agent node has no sandbox workspace",
        )


def _build_locator_or_raise(
    *,
    snapshot: CompositorSessionSnapshot,
    runtime_layer_specs: list[RuntimeLayerSpec],
    not_found_message: str,
) -> SandboxLocator:
    try:
        return build_sandbox_locator_from_layer_specs(
            layer_specs=runtime_layer_specs,
            session_snapshot=snapshot,
        )
    except ValueError as exc:
        raise AgentSandboxInspectorError("no_sandbox", not_found_message, status_code=404) from exc


def _deserialize_runtime_layer_specs(value: str | None) -> list[RuntimeLayerSpec]:
    if not value:
        return []
    return _RUNTIME_LAYER_SPECS_ADAPTER.validate_json(value)


def _default_client_factory() -> Client:
    base_url = dify_config.AGENT_BACKEND_BASE_URL
    if not base_url:
        raise AgentSandboxInspectorError(
            "inspector_unavailable",
            "the sandbox file inspector is not available (agent backend not configured)",
            status_code=503,
        )
    return Client(base_url=base_url)


__all__ = ["AgentAppSandboxService", "AgentSandboxInspectorError", "WorkflowAgentSandboxService"]
