"""Resolve product locators to ACTIVE Workspace Bindings and proxy file access."""

from __future__ import annotations

import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, cast

from dify_agent.client import Client
from dify_agent.layers.execution_context import (
    DifyExecutionContextAgentConfigVersionKind,
    DifyExecutionContextLayerConfig,
)
from dify_agent.protocol import (
    BindingFileDownloadRequest,
    BindingFileListResponse,
    BindingFileReadResponse,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from clients.agent_backend.factory import create_agent_backend_client
from configs import dify_config
from core.db.session_factory import session_factory
from core.tools.signature import bind_file_uri
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, AppMode, Conversation
from models.workflow import WorkflowNodeExecutionModel
from services.agent.roster_service import AgentRosterService
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope
from services.file_request_service import FileRequestService


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


class AgentSandboxDownload(BaseModel):
    url: str


@dataclass(frozen=True, slots=True)
class _ResolvedBinding:
    """Detached scalar Binding data safe to carry beyond its read transaction.

    Resolvers must end the transaction before Dify Agent network I/O; ORM and
    session-bound objects never cross that boundary.
    """

    backend_binding_ref: str
    agent_id: str
    agent_config_version_id: str
    agent_config_version_kind: str


class AgentAppSandboxService:
    def __init__(self, *, client_factory: Callable[[], Client] | None = None) -> None:
        self._client_factory = client_factory or _default_client_factory

    @staticmethod
    def resolve_app_id(*, tenant_id: str, agent_id: str) -> str:
        with session_factory.create_session() as session:
            app = AgentRosterService(session).get_agent_runtime_app_model(
                tenant_id=tenant_id,
                agent_id=agent_id,
            )
            return app.id

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
    ) -> BindingFileListResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            return client.list_binding_files_sync(binding.backend_binding_ref, path)

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
    ) -> BindingFileReadResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            return client.read_binding_file_sync(binding.backend_binding_ref, path)

    def download_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
        path: str,
    ) -> AgentSandboxDownload:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            agent_id=agent_id,
            caller_type=caller_type,
            caller_id=caller_id,
            account_id=account_id,
        )
        with self._client_factory() as client:
            downloaded = client.download_binding_file_sync(
                BindingFileDownloadRequest(
                    backend_binding_ref=binding.backend_binding_ref,
                    path=path,
                    execution_context=DifyExecutionContextLayerConfig(
                        tenant_id=tenant_id,
                        user_id=account_id,
                        user_from="account",
                        app_id=app_id,
                        conversation_id=caller_id if caller_type == "conversation" else None,
                        agent_id=agent_id,
                        agent_config_version_id=binding.agent_config_version_id,
                        agent_config_version_kind=cast(
                            DifyExecutionContextAgentConfigVersionKind,
                            binding.agent_config_version_kind,
                        ),
                        agent_mode="agent_app",
                        invoke_from="debugger",
                    ),
                )
            )
        return _download_response(tenant_id=tenant_id, account_id=account_id, reference=downloaded.reference)

    @staticmethod
    def _resolve_binding(
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
    ) -> _ResolvedBinding:
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
            return _binding_value(binding)


class WorkflowAgentSandboxService:
    def __init__(self, *, client_factory: Callable[[], Client] | None = None) -> None:
        self._client_factory = client_factory or _default_client_factory

    @staticmethod
    def resolve_app_id(*, tenant_id: str, app_id: str) -> str | None:
        with session_factory.create_session() as session:
            return session.scalar(
                select(App.id).where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.status == "normal",
                    App.mode.in_((AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value)),
                )
            )

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
    ) -> BindingFileListResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
            session=session,
        )
        with self._client_factory() as client:
            return client.list_binding_files_sync(binding.backend_binding_ref, path)

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
    ) -> BindingFileReadResponse:
        binding = self._resolve_binding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
            session=session,
        )
        with self._client_factory() as client:
            return client.read_binding_file_sync(binding.backend_binding_ref, path)

    def download_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        account_id: str,
        path: str,
    ) -> AgentSandboxDownload:
        with session_factory.create_session() as session:
            binding = self._resolve_binding(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                node_execution_id=node_execution_id,
                session=session,
            )
        with self._client_factory() as client:
            downloaded = client.download_binding_file_sync(
                BindingFileDownloadRequest(
                    backend_binding_ref=binding.backend_binding_ref,
                    path=path,
                    execution_context=DifyExecutionContextLayerConfig(
                        tenant_id=tenant_id,
                        user_id=account_id,
                        user_from="account",
                        app_id=app_id,
                        workflow_run_id=workflow_run_id,
                        node_id=node_id,
                        node_execution_id=node_execution_id,
                        agent_id=binding.agent_id,
                        agent_config_version_id=binding.agent_config_version_id,
                        agent_config_version_kind=cast(
                            DifyExecutionContextAgentConfigVersionKind,
                            binding.agent_config_version_kind,
                        ),
                        agent_mode="workflow_run",
                        invoke_from="debugger",
                    ),
                )
            )
        return _download_response(tenant_id=tenant_id, account_id=account_id, reference=downloaded.reference)

    @staticmethod
    def _resolve_binding(
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        session: Session,
    ) -> _ResolvedBinding:
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
        resolved = _binding_value(binding)
        # Deliberately end the read transaction before the caller performs Dify Agent I/O.
        session.rollback()
        return resolved


def _binding_value(binding: AgentWorkspaceBinding) -> _ResolvedBinding:
    return _ResolvedBinding(
        backend_binding_ref=binding.backend_binding_ref,
        agent_id=binding.agent_id,
        agent_config_version_id=binding.agent_config_version_id,
        agent_config_version_kind=binding.agent_config_version_kind.value,
    )


def _download_response(*, tenant_id: str, account_id: str, reference: str) -> AgentSandboxDownload:
    try:
        result = FileRequestService().request_download(
            tenant_id=tenant_id,
            user_id=account_id,
            user_from="account",
            invoke_from="debugger",
            file_mapping={"transfer_method": "tool_file", "reference": reference},
        )
        url = bind_file_uri(result.download_uri, dify_config.FILES_URL)
    except ValueError as exc:
        raise AgentSandboxInspectorError(
            "binding_file_download_unavailable",
            "Binding file could not be converted to a download URL",
            status_code=502,
        ) from exc
    return AgentSandboxDownload(url=_with_as_attachment(url))


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
            "the Binding file inspector is not available (Agent backend not configured)",
            status_code=503,
        )
    return create_agent_backend_client(
        base_url=base_url,
        api_token=dify_config.AGENT_BACKEND_API_TOKEN,
        binding_file_download_timeout=dify_config.AGENT_BACKEND_BINDING_FILE_DOWNLOAD_TIMEOUT_SECONDS,
    )


__all__ = [
    "AgentAppSandboxService",
    "AgentSandboxDownload",
    "AgentSandboxInfo",
    "AgentSandboxInspectorError",
    "WorkflowAgentSandboxService",
]
