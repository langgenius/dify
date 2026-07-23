"""Resolve product locators to ACTIVE Workspace Bindings and proxy file access."""

from __future__ import annotations

import urllib.parse
from collections.abc import Callable
from typing import Any

from dify_agent.client import Client
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import WorkspaceListResponse, WorkspaceReadResponse, WorkspaceUploadRequest
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from core.db.session_factory import session_factory
from factories import file_factory
from models.agent import (
    AgentDebugConversation,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, Conversation
from services.agent.workspace_service import AgentWorkspaceService


class AgentSandboxInspectorError(Exception):
    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class AgentSandboxInfo(BaseModel):
    workspace_cwd: str


class AgentSandboxUploadDownload(BaseModel):
    url: str


class AgentAppSandboxService:
    def __init__(self, *, client_factory: Callable[[], Client] | None = None) -> None:
        self._client_factory = client_factory or _default_client_factory

    def get_info(
        self, *, tenant_id: str, app_id: str, agent_id: str, conversation_id: str, account_id: str
    ) -> AgentSandboxInfo:
        self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            conversation_id=conversation_id,
            account_id=account_id,
        )
        return AgentSandboxInfo(workspace_cwd=".")

    def list_files(
        self, *, tenant_id: str, app_id: str, agent_id: str, conversation_id: str, account_id: str, path: str
    ) -> WorkspaceListResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            conversation_id=conversation_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            return client.list_workspace_files_sync(binding.backend_binding_ref, path)

    def read_file(
        self, *, tenant_id: str, app_id: str, agent_id: str, conversation_id: str, account_id: str, path: str
    ) -> WorkspaceReadResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            conversation_id=conversation_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            return client.read_workspace_file_sync(binding.backend_binding_ref, path)

    def upload_file(
        self, *, tenant_id: str, app_id: str, agent_id: str, conversation_id: str, account_id: str, path: str
    ) -> AgentSandboxUploadDownload:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            conversation_id=conversation_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            uploaded = client.upload_workspace_file_sync(
                WorkspaceUploadRequest(
                    backend_binding_ref=binding.backend_binding_ref,
                    path=path,
                    execution_context=DifyExecutionContextLayerConfig(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        conversation_id=conversation_id,
                        agent_id=agent_id,
                        agent_config_version_id=binding.agent_config_version_id,
                        agent_config_version_kind=binding.agent_config_version_kind.value,
                        agent_mode="agent_app",
                        invoke_from="debugger",
                    ),
                )
            )
        return _upload_download_response(tenant_id=tenant_id, file_mapping=uploaded.file.model_dump(mode="python"))

    @staticmethod
    def _resolve_binding(
        *, tenant_id: str, app_id: str, agent_id: str, conversation_id: str, account_id: str
    ) -> AgentWorkspaceBinding:
        with session_factory.create_session() as session:
            is_debug_conversation = session.scalar(
                select(AgentDebugConversation.id).where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.app_id == app_id,
                    AgentDebugConversation.agent_id == agent_id,
                    AgentDebugConversation.account_id == account_id,
                    AgentDebugConversation.conversation_id == conversation_id,
                )
            )
            if is_debug_conversation is None:
                is_owned_conversation = session.scalar(
                    select(Conversation.id)
                    .join(App, App.id == Conversation.app_id)
                    .where(
                        App.tenant_id == tenant_id,
                        Conversation.app_id == app_id,
                        Conversation.id == conversation_id,
                        Conversation.from_account_id == account_id,
                        Conversation.is_deleted.is_(False),
                    )
                )
                if is_owned_conversation is None:
                    raise AgentSandboxInspectorError(
                        "no_active_binding",
                        "this conversation has no active Agent Workspace Binding",
                        status_code=404,
                    )
            binding = AgentWorkspaceService.resolve_latest_active_conversation_binding(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                conversation_id=conversation_id,
                agent_id=agent_id,
                include_build_draft=is_debug_conversation is not None,
            )
            if binding is None:
                raise AgentSandboxInspectorError(
                    "no_active_binding",
                    "this conversation has no active Agent Workspace Binding",
                    status_code=404,
                )
            session.expunge(binding)
            return binding


class WorkflowAgentSandboxService:
    def __init__(self, *, client_factory: Callable[[], Client] | None = None) -> None:
        self._client_factory = client_factory or _default_client_factory

    def list_files(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        path: str,
        session: Session,
    ) -> WorkspaceListResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            session=session,
        )
        with self._client_factory() as client:
            return client.list_workspace_files_sync(binding.backend_binding_ref, path)

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        path: str,
        session: Session,
    ) -> WorkspaceReadResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            session=session,
        )
        with self._client_factory() as client:
            return client.read_workspace_file_sync(binding.backend_binding_ref, path)

    def upload_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        path: str,
        session: Session,
    ) -> AgentSandboxUploadDownload:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            session=session,
        )
        with self._client_factory() as client:
            uploaded = client.upload_workspace_file_sync(
                WorkspaceUploadRequest(
                    backend_binding_ref=binding.backend_binding_ref,
                    path=path,
                    execution_context=DifyExecutionContextLayerConfig(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        workflow_run_id=workflow_run_id,
                        node_id=node_id,
                        agent_id=binding.agent_id,
                        agent_config_version_id=binding.agent_config_version_id,
                        agent_config_version_kind=binding.agent_config_version_kind.value,
                        agent_mode="workflow_run",
                        invoke_from="debugger",
                    ),
                )
            )
        return _upload_download_response(tenant_id=tenant_id, file_mapping=uploaded.file.model_dump(mode="python"))

    @staticmethod
    def _resolve_binding(
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        session: Session,
    ) -> AgentWorkspaceBinding:
        binding = session.scalar(
            select(AgentWorkspaceBinding)
            .join(
                AgentWorkspace,
                (AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id)
                & (AgentWorkspace.id == AgentWorkspaceBinding.workspace_id),
            )
            .where(
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.app_id == app_id,
                AgentWorkspace.owner_type == AgentWorkspaceOwnerType.WORKFLOW_RUN,
                AgentWorkspace.owner_id == workflow_run_id,
                AgentWorkspace.owner_scope_key.like(f"{node_id}:%"),
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.app_id == app_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .order_by(AgentWorkspaceBinding.updated_at.desc())
            .limit(1)
        )
        if binding is None:
            raise AgentSandboxInspectorError(
                "no_active_binding",
                "this Workflow Agent node has no active Workspace Binding",
                status_code=404,
            )
        return binding


def _upload_download_response(*, tenant_id: str, file_mapping: dict[str, Any]) -> AgentSandboxUploadDownload:
    controller = DatabaseFileAccessController()
    runtime = DifyWorkflowFileRuntime(file_access_controller=controller)
    try:
        file = file_factory.build_from_mapping(mapping=file_mapping, tenant_id=tenant_id, access_controller=controller)
        url = runtime.resolve_file_url(file=file, for_external=True)
    except ValueError as exc:
        raise AgentSandboxInspectorError(
            "workspace_upload_download_unavailable",
            "uploaded Workspace file could not be converted to a download URL",
            status_code=502,
        ) from exc
    if not url:
        raise AgentSandboxInspectorError(
            "workspace_upload_download_unavailable",
            "uploaded Workspace file does not support download URL generation",
            status_code=502,
        )
    return AgentSandboxUploadDownload(url=_with_as_attachment(url))


def _with_as_attachment(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("as_attachment", "true"))
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def _default_client_factory() -> Client:
    base_url = dify_config.AGENT_BACKEND_BASE_URL
    if not base_url:
        raise AgentSandboxInspectorError(
            "inspector_unavailable",
            "the Workspace file inspector is not available (Agent backend not configured)",
            status_code=503,
        )
    return Client(base_url=base_url)


__all__ = [
    "AgentAppSandboxService",
    "AgentSandboxInfo",
    "AgentSandboxInspectorError",
    "AgentSandboxUploadDownload",
    "WorkflowAgentSandboxService",
]
