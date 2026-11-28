"""Workflow Agent participant persistence keyed by node execution."""

from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from time import sleep

from dify_agent.protocol.snapshot import SessionSnapshot
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.workflow.node_execution_process_data import (
    AGENT_SESSION_BRANCH_KEY,
    AGENT_SESSION_GENERATION_KEY,
    CONTINUE_AGENT_SESSION_KEY,
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    read_workflow_agent_session_branch,
    read_workflow_agent_session_policy,
)
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.workflow import WorkflowNodeExecutionModel
from services.agent.workspace_service import (
    AgentWorkspaceNotFoundError,
    AgentWorkspaceService,
    WorkspaceOwnerScope,
)

_CALLER_VISIBILITY_ATTEMPTS = 60
_CALLER_VISIBILITY_INTERVAL_SECONDS = 0.05


def resolve_workflow_agent_workspace_owner_scope(
    *,
    tenant_id: str,
    app_id: str,
    conversation_id: str | None,
    workflow_run_id: str | None,
    node_id: str,
    workflow_agent_binding_id: str,
    node_execution_id: str | None = None,
    workflow_tool_invocation_id: str | None = None,
    continue_agent_session: bool = True,
    session_generation: str = "",
    session_branch: str = "",
) -> WorkspaceOwnerScope:
    """Choose the Workspace owner for a workflow Agent participant.

    Pre: caller identity and session policy have been validated. Missing run ID
    denotes a single-node preview, owned by its node execution instead.
    Post: enabled Chatflow nodes share their generation within one conversation;
    disabled nodes share only the current run. Different generations cannot
    share history or working files. Legacy keys and Workflow Tool scopes are
    unchanged. This function performs no I/O.
    """

    owner_scope_key = f"{node_id}:{workflow_agent_binding_id}"
    if conversation_id and workflow_tool_invocation_id is None and (session_generation or session_branch):
        # Hash the whole generation key so even long node IDs fit the 255-byte ledger key.
        generation_key = f"{owner_scope_key}:{session_generation}"
        if session_branch:
            generation_key = f"{generation_key}:branch:{session_branch}"
        owner_scope_key = f"session:{sha256(generation_key.encode()).hexdigest()}"
    if workflow_tool_invocation_id is not None:
        # Partition repeated Tool calls without splitting loop executions inside a call.
        owner_scope_key = f"workflow-tool:{workflow_tool_invocation_id}:{owner_scope_key}"
    if conversation_id and workflow_tool_invocation_id is None and continue_agent_session:
        return WorkspaceOwnerScope(
            tenant_id=tenant_id,
            app_id=app_id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=conversation_id,
            owner_scope_key=owner_scope_key,
        )
    return WorkspaceOwnerScope(
        tenant_id=tenant_id,
        app_id=app_id,
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id=workflow_run_id or node_execution_id or "",
        owner_scope_key=owner_scope_key,
    )


@dataclass(frozen=True, slots=True)
class WorkflowAgentSessionScope:
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_run_id: str | None
    node_id: str
    node_execution_id: str
    workflow_agent_binding_id: str
    agent_id: str
    agent_config_snapshot_id: str
    conversation_id: str | None = None
    workflow_tool_invocation_id: str | None = None
    continue_agent_session: bool = True
    session_generation: str = ""
    session_branch: str = ""

    @property
    def workspace_owner(self) -> WorkspaceOwnerScope:
        return resolve_workflow_agent_workspace_owner_scope(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            conversation_id=self.conversation_id,
            workflow_run_id=self.workflow_run_id,
            node_id=self.node_id,
            workflow_agent_binding_id=self.workflow_agent_binding_id,
            node_execution_id=self.node_execution_id,
            workflow_tool_invocation_id=self.workflow_tool_invocation_id,
            continue_agent_session=self.continue_agent_session,
            session_generation=self.session_generation,
            session_branch=self.session_branch,
        )


@dataclass(frozen=True, slots=True)
class StoredWorkflowAgentSession:
    scope: WorkflowAgentSessionScope
    binding_id: str
    workspace_id: str
    backend_binding_ref: str
    session_snapshot: SessionSnapshot | None


class WorkflowAgentWorkspaceStore:
    """Load or create the participant named by a node execution caller row."""

    @staticmethod
    def load_active_participant(
        *,
        session: Session,
        scope: WorkspaceOwnerScope,
        agent_id: str,
    ) -> AgentWorkspaceBinding | None:
        """Look up the participant that pins a Chatflow node's generation."""

        return AgentWorkspaceService.resolve_active_binding_for_scope(
            session=session,
            scope=scope,
            agent_id=agent_id,
        )

    def load_existing_node_execution_scope(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_run_id: str | None,
        node_id: str,
        node_execution_id: str,
        conversation_id: str | None = None,
        workflow_tool_invocation_id: str | None = None,
    ) -> WorkflowAgentSessionScope | None:
        """Recover the participant and policy pinned by this exact caller.

        Pre: identifiers name the owning tenant/app/run/node execution.
        Post: an existing participant retains its original policy after pause,
        retry, or draft edits. Legacy rows use enabled/empty settings. Invalid
        stored identity or policy fails closed without modifying resources.
        """

        with session_factory.create_session() as session:
            execution = self._load_execution_by_identity(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                node_execution_id=node_execution_id,
            )
            binding_id = execution.agent_workspace_binding_id
            if binding_id is None:
                return None
            process_data = execution.process_data_dict
            if not isinstance(process_data, dict):
                raise AgentWorkspaceNotFoundError("Workflow node execution caller identity is invalid")
            workflow_agent_binding_id = process_data.get("workflow_agent_binding_id")
            if not isinstance(workflow_agent_binding_id, str):
                raise AgentWorkspaceNotFoundError("Workflow node execution caller identity is missing")
            if process_data.get(WORKFLOW_TOOL_INVOCATION_ID_KEY) != workflow_tool_invocation_id:
                raise AgentWorkspaceNotFoundError("Workflow node execution caller invocation does not match")
            try:
                continue_agent_session, session_generation = read_workflow_agent_session_policy(process_data)
                session_branch = read_workflow_agent_session_branch(process_data)
            except ValueError as error:
                raise AgentWorkspaceNotFoundError("Workflow node execution session policy is invalid") from error
            owner_scope = resolve_workflow_agent_workspace_owner_scope(
                tenant_id=tenant_id,
                app_id=app_id,
                conversation_id=conversation_id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                workflow_agent_binding_id=workflow_agent_binding_id,
                node_execution_id=node_execution_id,
                workflow_tool_invocation_id=workflow_tool_invocation_id,
                continue_agent_session=continue_agent_session,
                session_generation=session_generation,
                session_branch=session_branch,
            )
            binding = AgentWorkspaceService.get_active_binding(
                session=session,
                tenant_id=tenant_id,
                binding_id=binding_id,
                expected_owner_scope=owner_scope,
            )
            if binding is None or binding.agent_config_version_kind != AgentConfigVersionKind.SNAPSHOT:
                raise AgentWorkspaceNotFoundError("Workflow node participant Binding is unavailable")
            return WorkflowAgentSessionScope(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                node_execution_id=node_execution_id,
                workflow_agent_binding_id=workflow_agent_binding_id,
                agent_id=binding.agent_id,
                agent_config_snapshot_id=binding.agent_config_version_id,
                conversation_id=conversation_id,
                workflow_tool_invocation_id=workflow_tool_invocation_id,
                continue_agent_session=continue_agent_session,
                session_generation=session_generation,
                session_branch=session_branch,
            )

    def load_or_create_node_execution_session(
        self, scope: WorkflowAgentSessionScope, *, home_snapshot_id: str | None
    ) -> StoredWorkflowAgentSession:
        """Allocate or recover the participant for a validated frozen scope.

        Pre: the node-start caller row exists and scope belongs to this run.
        Post: the caller pins policy and participant atomically; repeated
        sequential Chatflow executions reuse only the permitted owner scope.
        Identity or policy conflicts fail without changing the caller row.
        """
        with session_factory.create_session() as session:
            execution = self._load_execution(session=session, scope=scope)
            process_data = execution.process_data_dict
            if process_data is None:
                process_data = {}
            if not isinstance(process_data, dict):
                raise AgentWorkspaceNotFoundError("Workflow node execution caller identity is invalid")
            stored_workflow_binding_id = process_data.get("workflow_agent_binding_id")
            if stored_workflow_binding_id is not None and stored_workflow_binding_id != scope.workflow_agent_binding_id:
                raise AgentWorkspaceNotFoundError("Workflow node execution caller identity does not match")
            stored_invocation_id = process_data.get(WORKFLOW_TOOL_INVOCATION_ID_KEY)
            if stored_invocation_id is not None and stored_invocation_id != scope.workflow_tool_invocation_id:
                raise AgentWorkspaceNotFoundError("Workflow node execution caller invocation does not match")
            if execution.agent_workspace_binding_id is not None:
                try:
                    persisted_policy = read_workflow_agent_session_policy(process_data)
                    persisted_branch = read_workflow_agent_session_branch(process_data)
                except ValueError as error:
                    raise AgentWorkspaceNotFoundError("Workflow node execution session policy is invalid") from error
                if persisted_policy != (scope.continue_agent_session, scope.session_generation):
                    raise AgentWorkspaceNotFoundError("Workflow node execution session policy does not match")
                if persisted_branch != scope.session_branch:
                    raise AgentWorkspaceNotFoundError("Workflow node execution session branch does not match")

            binding_id = execution.agent_workspace_binding_id
            if binding_id is None:
                binding = self._resolve_or_create_binding(
                    session=session,
                    scope=scope,
                    home_snapshot_id=home_snapshot_id,
                )
                execution.agent_workspace_binding_id = binding.id
                if scope.workflow_tool_invocation_id is not None:
                    process_data[WORKFLOW_TOOL_INVOCATION_ID_KEY] = scope.workflow_tool_invocation_id
                execution.process_data = json.dumps(
                    {
                        **process_data,
                        "workflow_agent_binding_id": scope.workflow_agent_binding_id,
                        CONTINUE_AGENT_SESSION_KEY: scope.continue_agent_session,
                        AGENT_SESSION_GENERATION_KEY: scope.session_generation,
                        AGENT_SESSION_BRANCH_KEY: scope.session_branch,
                    },
                    ensure_ascii=False,
                )
                session.commit()
            else:
                if stored_workflow_binding_id is None:
                    raise AgentWorkspaceNotFoundError("Workflow node execution caller identity is missing")
                resolved_binding = AgentWorkspaceService.get_active_binding(
                    session=session,
                    tenant_id=scope.tenant_id,
                    binding_id=binding_id,
                    expected_owner_scope=scope.workspace_owner,
                )
                if resolved_binding is None or resolved_binding.agent_id != scope.agent_id:
                    raise AgentWorkspaceNotFoundError("Workflow node participant Binding is unavailable")
                binding = resolved_binding
                AgentWorkspaceService.validate_binding_generation(
                    binding,
                    base_home_snapshot_id=home_snapshot_id,
                    agent_config_version_id=scope.agent_config_snapshot_id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                )
            return self._stored(session, scope, binding)

    def save_active_snapshot(
        self,
        *,
        scope: WorkflowAgentSessionScope,
        binding_id: str,
        snapshot: SessionSnapshot | None,
    ) -> None:
        if snapshot is None:
            return
        AgentWorkspaceService.save_binding_session_snapshot(
            tenant_id=scope.tenant_id,
            binding_id=binding_id,
            session_snapshot=snapshot.model_dump_json(),
        )

    def retire_workflow_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> list[str]:
        """Retire active Workspaces, commit, and return active or already-retired IDs for collection."""

        with session_factory.create_session() as session:
            retired = AgentWorkspaceService.retire_workflow_run(
                session=session, tenant_id=tenant_id, app_id=app_id, workflow_run_id=workflow_run_id
            )
            session.commit()
        return retired

    def retire_standalone_node_execution(self, *, tenant_id: str, app_id: str, node_execution_id: str) -> list[str]:
        """Retire a run-less node execution's Workspaces, commit, and return IDs for collection.

        Standalone single-step previews have no Workflow Run, so
        ``resolve_workflow_agent_workspace_owner_scope`` owns their Workspaces by
        ``node_execution_id`` under the ``WORKFLOW_RUN`` owner type.
        """
        return self.retire_workflow_run(tenant_id=tenant_id, app_id=app_id, workflow_run_id=node_execution_id)

    @staticmethod
    def _load_execution(*, session: Session, scope: WorkflowAgentSessionScope) -> WorkflowNodeExecutionModel:
        return WorkflowAgentWorkspaceStore._load_execution_by_identity(
            session=session,
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            workflow_id=scope.workflow_id,
            workflow_run_id=scope.workflow_run_id,
            node_id=scope.node_id,
            node_execution_id=scope.node_execution_id,
        )

    @staticmethod
    def _load_execution_by_identity(
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_run_id: str | None,
        node_id: str,
        node_execution_id: str,
    ) -> WorkflowNodeExecutionModel:
        """Return the caller row after the node-start event persists it.

        The caller must have emitted the node-start event before this lookup.
        Raise AgentWorkspaceNotFoundError if the row stays absent through the retry window.
        """

        stmt = select(WorkflowNodeExecutionModel).where(
            WorkflowNodeExecutionModel.id == node_execution_id,
            WorkflowNodeExecutionModel.tenant_id == tenant_id,
            WorkflowNodeExecutionModel.app_id == app_id,
            WorkflowNodeExecutionModel.workflow_id == workflow_id,
            WorkflowNodeExecutionModel.node_id == node_id,
            WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
        )
        for attempt in range(_CALLER_VISIBILITY_ATTEMPTS):
            execution = session.scalar(stmt)
            if execution is not None:
                return execution
            if attempt < _CALLER_VISIBILITY_ATTEMPTS - 1:
                sleep(_CALLER_VISIBILITY_INTERVAL_SECONDS)

        raise AgentWorkspaceNotFoundError("Workflow node execution caller is unavailable")

    @staticmethod
    def _resolve_or_create_binding(
        *,
        session: Session,
        scope: WorkflowAgentSessionScope,
        home_snapshot_id: str | None,
    ) -> AgentWorkspaceBinding:
        """Resolve the current Chatflow participant or allocate its initial state.

        Pre: scope contains the run-frozen policy. Post: sequential executions
        of a Chatflow node share its allowed conversation/run participant.
        Workflow and Workflow Tool participants retain their existing behavior.
        """

        is_chatflow_run_session = (
            scope.conversation_id is not None
            and scope.workflow_tool_invocation_id is None
            and not scope.continue_agent_session
        )
        if scope.workspace_owner.owner_type == AgentWorkspaceOwnerType.CONVERSATION or is_chatflow_run_session:
            existing_binding = WorkflowAgentWorkspaceStore.load_active_participant(
                session=session,
                scope=scope.workspace_owner,
                agent_id=scope.agent_id,
            )
            if existing_binding is not None:
                AgentWorkspaceService.validate_binding_generation(
                    existing_binding,
                    base_home_snapshot_id=home_snapshot_id,
                    agent_config_version_id=scope.agent_config_snapshot_id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                )
                return existing_binding

        return AgentWorkspaceService.create_binding(
            session=session,
            scope=scope.workspace_owner,
            agent_id=scope.agent_id,
            base_home_snapshot_id=home_snapshot_id,
            agent_config_version_id=scope.agent_config_snapshot_id,
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        )

    @staticmethod
    def _stored(
        session: Session,
        scope: WorkflowAgentSessionScope,
        binding: AgentWorkspaceBinding,
    ) -> StoredWorkflowAgentSession:
        snapshot = SessionSnapshot.model_validate_json(binding.session_snapshot) if binding.session_snapshot else None
        return StoredWorkflowAgentSession(
            scope=scope,
            binding_id=binding.id,
            workspace_id=binding.workspace_id,
            backend_binding_ref=binding.backend_binding_ref,
            session_snapshot=snapshot,
        )


__all__ = [
    "StoredWorkflowAgentSession",
    "WorkflowAgentSessionScope",
    "WorkflowAgentWorkspaceStore",
    "resolve_workflow_agent_workspace_owner_scope",
]
