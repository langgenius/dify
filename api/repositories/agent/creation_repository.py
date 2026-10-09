"""Persist workflow-only Agent resources atomically in their caller's transaction."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from constants.model_template import default_app_templates
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentPackageMetadata, AgentSoulConfig, agent_soul_has_model
from models.model import App, AppMode, AppModelConfig, IconType
from services.workflow.contracts import WorkflowBindingScope


class WorkflowAgentCreationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create_hidden_backing_app(
        self,
        *,
        tenant_id: str,
        account_id: str | None,
        name: str,
        description: str = "",
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> App:
        """Create an internal Agent App used only to back a workflow-only Agent.

        This deliberately bypasses AppService.create_app because that public
        creation path also creates a roster Agent. Inline Agents need App runtime
        infrastructure for chat/logs/monitoring, but must stay hidden from the
        workspace Agent Roster until explicitly saved to roster.
        """

        app_template = dict(default_app_templates[AppMode.AGENT]["app"])
        app = App(**app_template)
        app.name = name
        app.description = description or ""
        app.mode = AppMode.AGENT
        app.icon_type = IconType(icon_type) if icon_type else IconType.EMOJI
        app.icon = icon
        app.icon_background = icon_background
        app.tenant_id = tenant_id
        app.enable_site = False
        app.enable_api = False
        app.api_rph = 0
        app.api_rpm = 0
        app.max_active_requests = None
        app.created_by = account_id
        app.maintainer = account_id
        app.updated_by = account_id
        self.session.add(app)
        self.session.flush()

        app_model_config = AppModelConfig(app_id=app.id, created_by=account_id, updated_by=account_id)
        self.session.add(app_model_config)
        self.session.flush()
        app.app_model_config_id = app_model_config.id
        self.session.flush()
        return app

    def create_workflow_agent(
        self,
        *,
        workflow: WorkflowBindingScope,
        node_id: str,
        account_id: str,
        metadata: AgentPackageMetadata,
        soul: AgentSoulConfig,
        source: AgentSource,
        operation: AgentConfigRevisionOperation,
    ) -> tuple[Agent, AgentConfigSnapshot]:
        backing_app = self.create_hidden_backing_app(
            tenant_id=workflow.tenant_id,
            account_id=account_id,
            name=metadata.name,
            description=metadata.description,
            icon_type=metadata.icon_type,
            icon=metadata.icon,
            icon_background=metadata.icon_background,
        )
        agent = Agent(
            tenant_id=workflow.tenant_id,
            name=metadata.name,
            description=metadata.description,
            role=metadata.role,
            icon_type=AgentIconType(metadata.icon_type) if metadata.icon_type else None,
            icon=metadata.icon,
            icon_background=metadata.icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=source,
            app_id=workflow.app_id,
            backing_app_id=backing_app.id,
            workflow_id=workflow.id,
            workflow_node_id=node_id,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        self.session.add(agent)
        self.session.flush()
        snapshot = self.create_snapshot(
            tenant_id=workflow.tenant_id,
            agent=agent,
            account_id=account_id,
            soul=soul,
            operation=operation,
        )
        agent.active_config_snapshot_id = snapshot.id
        agent.active_config_has_model = agent_soul_has_model(soul)
        agent.active_config_is_published = True
        self.session.flush()
        return agent, snapshot

    def create_snapshot(
        self,
        *,
        tenant_id: str,
        agent: Agent,
        account_id: str,
        soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
    ) -> AgentConfigSnapshot:
        next_version = (
            self.session.scalar(
                select(func.max(AgentConfigSnapshot.version)).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent.id,
                )
            )
            or 0
        ) + 1
        snapshot = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=next_version,
            config_snapshot=soul,
            home_snapshot_id=None,
            created_by=account_id,
        )
        self.session.add(snapshot)
        self.session.flush()
        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            revision=1,
            operation=operation,
            created_by=account_id,
        )
        self.session.add(revision)
        self.session.flush()
        return snapshot
