"""Resolve product locators to ACTIVE Workspace Bindings and proxy file access."""

from __future__ import annotations

import urllib.parse
from collections.abc import Callable
from typing import Any, Literal, cast

from dify_agent.client import Client
from dify_agent.layers.execution_context import (
    DifyExecutionContextAgentConfigVersionKind,
    DifyExecutionContextLayerConfig,
)
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
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, Conversation
from models.workflow import WorkflowNodeExecutionModel
from services.agent.roster_service import AgentRosterService
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope


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
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
    ) -> AgentSandboxInfo:
        self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
            account_id=account_id,
        )
        return AgentSandboxInfo(workspace_cwd=".")

    def list_files(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
        path: str,
    ) -> WorkspaceListResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            return client.list_workspace_files_sync(binding.backend_binding_ref, path)

    def read_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
        path: str,
    ) -> WorkspaceReadResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            return client.read_workspace_file_sync(binding.backend_binding_ref, path)

    def upload_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
        path: str,
    ) -> AgentSandboxUploadDownload:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
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
                        conversation_id=caller_id if caller_type == "conversation" else None,
                        agent_id=agent_id,
                        agent_config_version_id=binding.agent_config_version_id,
                        agent_config_version_kind=cast(
                            DifyExecutionContextAgentConfigVersionKind,
                            binding.agent_config_version_kind.value,
                        ),
                        agent_mode="agent_app",
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
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
    ) -> AgentWorkspaceBinding:
        with session_factory.create_session() as session:
            caller: AgentConfigDraft | Conversation | None
            if caller_type == "build_draft":
                agent = session.scalar(
                    select(Agent).where(
                        Agent.id == agent_id,
                        Agent.tenant_id == tenant_id,
                    )
                )
                if agent is None or AgentRosterService.runtime_backing_app_id(agent) != app_id:
                    caller = None
                else:
                    caller = session.scalar(
                        select(AgentConfigDraft).where(
                            AgentConfigDraft.id == caller_id,
                            AgentConfigDraft.tenant_id == tenant_id,
                            AgentConfigDraft.agent_id == agent_id,
                            AgentConfigDraft.account_id == account_id,
                            AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                        )
                    )
                owner_scope = WorkspaceOwnerScope(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                    owner_id=caller_id,
                )
            else:
                caller = session.scalar(
                    select(Conversation)
                    .join(App, App.id == Conversation.app_id)
                    .where(
                        App.tenant_id == tenant_id,
                        Conversation.app_id == app_id,
                        Conversation.id == caller_id,
                        Conversation.from_account_id == account_id,
                        Conversation.is_deleted.is_(False),
                    )
                )
                owner_scope = WorkspaceOwnerScope(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                    owner_id=caller_id,
                )
            if caller is None or caller.agent_workspace_binding_id is None:
                raise AgentSandboxInspectorError(
                    "no_active_binding",
                    "this caller has no active Agent Workspace Binding",
                    status_code=404,
                )
            binding = AgentWorkspaceService.get_active_binding(
                session=session,
                tenant_id=tenant_id,
                binding_id=caller.agent_workspace_binding_id,
                expected_owner_scope=owner_scope,
            )
            if binding is None or binding.agent_id != agent_id:
                raise AgentSandboxInspectorError(
                    "no_active_binding",
                    "this caller has no active Agent Workspace Binding",
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
        node_execution_id: str,
        path: str,
        session: Session,
    ) -> WorkspaceListResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
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
        node_execution_id: str,
        path: str,
        session: Session,
    ) -> WorkspaceReadResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
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
        node_execution_id: str,
        path: str,
        session: Session,
    ) -> AgentSandboxUploadDownload:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
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
                        agent_config_version_kind=cast(
                            DifyExecutionContextAgentConfigVersionKind,
                            binding.agent_config_version_kind.value,
                        ),
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
        node_execution_id: str,
        session: Session,
    ) -> AgentWorkspaceBinding:
        execution = session.scalar(
            select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.id == node_execution_id,
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                WorkflowNodeExecutionModel.app_id == app_id,
                WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                WorkflowNodeExecutionModel.node_id == node_id,
            )
        )
        process_data = execution.process_data_dict if execution is not None else None
        workflow_agent_binding_id = process_data.get("workflow_agent_binding_id") if process_data is not None else None
        if (
            execution is None
            or execution.agent_workspace_binding_id is None
            or not isinstance(workflow_agent_binding_id, str)
        ):
            raise AgentSandboxInspectorError(
                "no_active_binding",
                "this Workflow Agent node execution has no active Workspace Binding",
                status_code=404,
            )
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
            tenant_id=tenant_id,
            binding_id=execution.agent_workspace_binding_id,
            expected_owner_scope=WorkspaceOwnerScope(
                tenant_id=tenant_id,
                app_id=app_id,
                owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
                owner_id=workflow_run_id,
                owner_scope_key=f"{node_id}:{workflow_agent_binding_id}",
            ),
        )
        if binding is None:
            raise AgentSandboxInspectorError(
                "no_active_binding",
                "this Workflow Agent node execution has no active Workspace Binding",
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
