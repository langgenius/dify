"""Short-lived database reads for Agent App and workflow sandbox bindings."""

from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.workspace import WorkspaceOwnerScope
from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    read_workflow_agent_session_branch,
    read_workflow_agent_session_policy,
)
from core.workflow.nodes.agent_v2.session_store import resolve_workflow_agent_workspace_owner_scope
from machinery.context import RequestContext
from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentWorkspaceBinding, AgentWorkspaceOwnerType
from models.enums import AppStatus
from models.model import App, AppMode, Conversation, Message
from models.workflow import WorkflowNodeExecutionModel
from repositories.agent.agent_app_repository import AgentAppRepository
from repositories.agent.agent_workspace_repository import AgentWorkspaceRepository
from services.agent.sandbox_contracts import (
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
        """Resolve an active binding for an admitted Agent App and account.

        Check the caller and binding in one read session. A missing or mismatched
        owner raises AgentSandboxBindingNotFoundError without modifying any row.
        """
        with self._session_factory() as session:
            caller: AgentConfigDraft | Conversation | None
            if caller_type == "build_draft":
                agent = session.scalar(
                    select(Agent).where(
                        Agent.id == agent_id,
                        Agent.tenant_id == tenant_id,
                    )
                )
                if agent is None or (agent.backing_app_id or agent.app_id) != app_id:
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
            binding = AgentWorkspaceRepository(session=session).get_active_binding(
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
        """Resolve only the workspace permitted by the execution's frozen policy.

        Pre: the application owner was admitted and the execution IDs are
        caller-scoped. Post: disabled Chatflow runs and session generations are
        checked against their original owner; malformed policy fails closed.
        This read never changes the participant or its lifecycle.
        """
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
        invocation_id = process_data.get(WORKFLOW_TOOL_INVOCATION_ID_KEY) if process_data is not None else None
        if (
            execution is None
            or execution.agent_workspace_binding_id is None
            or not isinstance(workflow_agent_binding_id, str)
            or (invocation_id is not None and not isinstance(invocation_id, str))
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
        try:
            continue_agent_session, session_generation = read_workflow_agent_session_policy(process_data)
            session_branch = read_workflow_agent_session_branch(process_data)
        except ValueError as error:
            raise AgentSandboxBindingNotFoundError(
                "this Workflow Agent node execution has invalid session policy"
            ) from error
        binding = AgentWorkspaceRepository(session=session).get_active_binding(
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
                workflow_tool_invocation_id=invocation_id,
                continue_agent_session=continue_agent_session,
                session_generation=session_generation,
                session_branch=session_branch,
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
