"""Agent V2 target preparation for dataset evaluation runs."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequest,
    AgentAppRuntimeRequestBuilder,
)
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.credit_usage import CreditUsageAppType
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentScope,
    AgentStatus,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.model import App, AppMode
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope


@dataclass(frozen=True, slots=True)
class ResolvedAgentEvaluationTarget:
    agent_id: str
    agent_name: str
    app_id: str
    config_snapshot_id: str
    home_snapshot_id: str | None
    agent_soul: AgentSoulConfig


class AgentEvaluationTargetService:
    """Resolve an immutable Agent snapshot and its isolated row workspace."""

    @staticmethod
    def resolve_active_snapshot(
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
        snapshot_id: str | None = None,
    ) -> ResolvedAgentEvaluationTarget:
        agent = session.scalar(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.tenant_id == tenant_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
                Agent.app_id.is_not(None),
            )
        )
        if agent is None or agent.app_id is None:
            raise ValueError("Agent evaluation target not found.")
        if snapshot_id is None and not agent_has_workflow_callable_active_snapshot(session=session, agent=agent):
            raise ValueError("The Agent evaluation target must have a published configuration.")

        # Admission pins the currently published snapshot. Worker retries pass
        # that explicit ID so later draft/publish changes cannot redirect a run.
        resolved_snapshot_id = snapshot_id or agent.active_config_snapshot_id
        if not resolved_snapshot_id:
            raise ValueError("The Agent evaluation target must have a published configuration.")
        snapshot = session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.id == resolved_snapshot_id,
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent.id,
            )
        )
        if snapshot is None:
            raise ValueError(f"Pinned Agent configuration {resolved_snapshot_id} no longer exists.")

        app_id = agent.backing_app_id or agent.app_id
        app = session.scalar(
            select(App).where(
                App.id == app_id,
                App.tenant_id == tenant_id,
                App.mode == AppMode.AGENT,
                App.status == AppStatus.NORMAL,
            )
        )
        if app is None:
            raise ValueError("The Agent runtime app is unavailable.")

        agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        if agent_soul.model is None:
            raise ValueError("The Agent evaluation target must configure a model.")
        return ResolvedAgentEvaluationTarget(
            agent_id=agent.id,
            agent_name=agent.name,
            app_id=app.id,
            config_snapshot_id=snapshot.id,
            home_snapshot_id=snapshot.home_snapshot_id,
            agent_soul=agent_soul,
        )

    @staticmethod
    def ensure_row_binding(
        *,
        session: Session,
        target: ResolvedAgentEvaluationTarget,
        tenant_id: str,
        run_item_id: str,
        binding_id: str | None,
    ) -> AgentWorkspaceBinding:
        scope = WorkspaceOwnerScope(
            tenant_id=tenant_id,
            app_id=target.app_id,
            owner_type=AgentWorkspaceOwnerType.EVALUATION_RUN_ITEM,
            owner_id=run_item_id,
        )
        if binding_id:
            binding = AgentWorkspaceService.get_active_binding(
                session=session,
                tenant_id=tenant_id,
                binding_id=binding_id,
                expected_owner_scope=scope,
            )
            if binding is not None and binding.agent_id == target.agent_id:
                AgentWorkspaceService.validate_binding_generation(
                    binding,
                    base_home_snapshot_id=target.home_snapshot_id,
                    agent_config_version_id=target.config_snapshot_id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                )
                return binding

        return AgentWorkspaceService.create_binding(
            session=session,
            scope=scope,
            agent_id=target.agent_id,
            base_home_snapshot_id=target.home_snapshot_id,
            agent_config_version_id=target.config_snapshot_id,
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        )

    @staticmethod
    def build_runtime_request(
        *,
        target: ResolvedAgentEvaluationTarget,
        tenant_id: str,
        account_id: str,
        run_item_id: str,
        binding_id: str,
        backend_binding_ref: str,
        query: str,
        idempotency_key: str,
    ) -> AgentAppRuntimeRequest:
        return AgentAppRuntimeRequestBuilder().build(
            AgentAppRuntimeBuildContext(
                dify_context=DifyRunContext(
                    tenant_id=tenant_id,
                    app_id=target.app_id,
                    user_id=account_id,
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    app_type=CreditUsageAppType.AGENT_V2,
                ),
                agent_id=target.agent_id,
                agent_config_snapshot_id=target.config_snapshot_id,
                agent_soul=target.agent_soul,
                conversation_id=run_item_id,
                user_query=query,
                idempotency_key=idempotency_key,
                binding_id=binding_id,
                backend_binding_ref=backend_binding_ref,
                capture_available_tools=True,
            )
        )


__all__ = ["AgentEvaluationTargetService", "ResolvedAgentEvaluationTarget"]
