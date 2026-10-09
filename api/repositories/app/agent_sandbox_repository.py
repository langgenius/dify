"""Short-lived database reads for Agent App and workflow sandbox bindings."""

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.agent_v2.session_store import resolve_workflow_agent_workspace_owner_scope
from machinery.context import RequestContext
from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentWorkspaceBinding, AgentWorkspaceOwnerType
from models.enums import AppStatus
from models.model import App, AppMode, Conversation, Message
from models.workflow import WorkflowNodeExecutionModel
from repositories.app.agent_app_repository import AgentAppRepository
from services.agent.roster_service import AgentRosterService
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope
from services.app.agent_app_contracts import (
    AgentSandboxBinding,
    AgentSandboxBindingNotFoundError,
    AgentSandboxCaller,
    SandboxCaller,
    WorkflowSandboxAppNotFoundError,
)


class AgentSandboxRepository:
    def __init__(self, *, session_factory: sessionmaker[Session], apps: AgentAppRepository) -> None:
        self._session_factory = session_factory
        self._apps = apps

    def resolve_binding(self, context: RequestContext, caller: SandboxCaller) -> AgentSandboxBinding:
        if isinstance(caller, AgentSandboxCaller):
            app_id = self._apps.resolve_runtime_app_id(tenant_id=context.active_workspace_id, agent_id=caller.agent_id)
            return self._resolve_agent_binding(
                tenant_id=context.active_workspace_id,
                account_id=context.account_id,
                app_id=app_id,
                agent_id=caller.agent_id,
                caller_type=caller.caller_type,
                caller_id=caller.caller_id,
            )
        with self._session_factory() as session:
            workflow_app_id = session.scalar(
                select(App.id).where(
                    App.id == caller.app_id,
                    App.tenant_id == context.active_workspace_id,
                    App.status == AppStatus.NORMAL,
                    App.mode.in_((AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)),
                )
            )
            if workflow_app_id is None:
                raise WorkflowSandboxAppNotFoundError
            return self._resolve_workflow_binding(
                tenant_id=context.active_workspace_id,
                app_id=workflow_app_id,
                workflow_run_id=caller.workflow_run_id,
                node_id=caller.node_id,
                node_execution_id=caller.node_execution_id,
                session=session,
            )

    def _resolve_agent_binding(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        caller_type: Literal["conversation", "build_draft"],
        caller_id: str,
        account_id: str,
    ) -> AgentSandboxBinding:
        with self._session_factory() as session:
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
                raise AgentSandboxBindingNotFoundError(
                    "this caller has no active Agent Workspace Binding",
                )
            binding = AgentWorkspaceService.get_active_binding(
                session=session,
                tenant_id=tenant_id,
                binding_id=caller.agent_workspace_binding_id,
                expected_owner_scope=owner_scope,
            )
            if binding is None or binding.app_id != app_id or binding.agent_id != agent_id:
                raise AgentSandboxBindingNotFoundError(
                    "this caller has no active Agent Workspace Binding",
                )
            return _binding_value(binding)

    @staticmethod
    def _resolve_workflow_binding(
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        session: Session,
    ) -> AgentSandboxBinding:
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
            raise AgentSandboxBindingNotFoundError(
                "this Workflow Agent node execution has no active Workspace Binding",
            )
        conversation_id = session.scalar(
            select(Message.conversation_id)
            .where(
                Message.app_id == app_id,
                Message.workflow_run_id == workflow_run_id,
            )
            .limit(1)
        )
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
            tenant_id=tenant_id,
            binding_id=execution.agent_workspace_binding_id,
            expected_owner_scope=resolve_workflow_agent_workspace_owner_scope(
                tenant_id=tenant_id,
                app_id=app_id,
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                workflow_agent_binding_id=workflow_agent_binding_id,
                node_execution_id=node_execution_id,
            ),
        )
        if binding is None or binding.app_id != app_id:
            raise AgentSandboxBindingNotFoundError(
                "this Workflow Agent node execution has no active Workspace Binding",
            )
        return _binding_value(binding)


def _binding_value(binding: AgentWorkspaceBinding) -> AgentSandboxBinding:
    return AgentSandboxBinding(
        app_id=binding.app_id,
        backend_binding_ref=binding.backend_binding_ref,
        agent_id=binding.agent_id,
        agent_config_version_id=binding.agent_config_version_id,
        agent_config_version_kind=binding.agent_config_version_kind.value,
    )
