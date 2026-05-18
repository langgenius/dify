import json
from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .base import Base, DefaultFieldsMixin
from .types import EnumText, LongText, StringUUID


class AgentKind(StrEnum):
    DIFY_AGENT = "dify_agent"


class AgentScope(StrEnum):
    ROSTER = "roster"
    WORKFLOW_ONLY = "workflow_only"


class AgentSource(StrEnum):
    AGENT_APP = "agent_app"
    WORKFLOW = "workflow"
    IMPORTED = "imported"
    SYSTEM = "system"


class AgentStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class WorkflowAgentBindingType(StrEnum):
    ROSTER_AGENT = "roster_agent"
    INLINE_AGENT = "inline_agent"


class Agent(DefaultFieldsMixin, Base):
    """Workspace-scoped Agent identity used by Agent Roster and workflow-only agents."""

    __tablename__ = "agents"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_pkey"),
        UniqueConstraint("tenant_id", "roster_unique_name", name="agent_tenant_roster_name_unique"),
        Index("agent_tenant_status_updated_at_idx", "tenant_id", "status", "updated_at"),
        Index("agent_tenant_scope_status_idx", "tenant_id", "scope", "status"),
        Index("agent_tenant_workflow_id_idx", "tenant_id", "workflow_id"),
        Index("agent_tenant_app_id_idx", "tenant_id", "app_id"),
        Index("agent_active_config_version_id_idx", "active_config_version_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(LongText, nullable=False, default="")
    icon_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True)
    icon_background: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_kind: Mapped[AgentKind] = mapped_column(
        EnumText(AgentKind, length=32), nullable=False, default=AgentKind.DIFY_AGENT
    )
    scope: Mapped[AgentScope] = mapped_column(EnumText(AgentScope, length=32), nullable=False)
    source: Mapped[AgentSource] = mapped_column(EnumText(AgentSource, length=32), nullable=False)
    app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    workflow_node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active_config_version_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    status: Mapped[AgentStatus] = mapped_column(
        EnumText(AgentStatus, length=32), nullable=False, default=AgentStatus.ACTIVE
    )
    roster_unique_name: Mapped[str | None] = mapped_column(
        String(255),
        sa.Computed("CASE WHEN scope = 'roster' AND status = 'active' THEN name ELSE NULL END"),
        nullable=True,
    )
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    archived_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AgentConfigVersion(Base):
    """Immutable Agent Soul snapshot version.

    ``config_snapshot`` is a JSON string stored as ``LongText``. It may contain
    credential or secret references, but must never contain plaintext secrets.
    """

    __tablename__ = "agent_config_versions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_config_version_pkey"),
        UniqueConstraint("agent_id", "version", name="agent_config_version_agent_version_unique"),
        Index("agent_config_version_tenant_agent_created_at_idx", "tenant_id", "agent_id", "created_at"),
        Index("agent_config_version_tenant_created_at_idx", "tenant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    config_snapshot: Mapped[str] = mapped_column(LongText, nullable=False, default="{}")
    summary: Mapped[str | None] = mapped_column(LongText, nullable=True)
    version_note: Mapped[str | None] = mapped_column(LongText, nullable=True)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=naive_utc_now,
        server_default=func.current_timestamp(),
    )

    @property
    def config_snapshot_dict(self) -> dict[str, Any]:
        return json.loads(self.config_snapshot) if self.config_snapshot else {}


class WorkflowAgentNodeBinding(DefaultFieldsMixin, Base):
    """Binding between one workflow node and one Agent config version.

    ``node_job_config`` stores Workflow Node Job JSON only. Agent Soul belongs
    to ``AgentConfigVersion.config_snapshot`` and must not be duplicated here.
    """

    __tablename__ = "workflow_agent_node_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_agent_node_binding_pkey"),
        UniqueConstraint(
            "tenant_id",
            "workflow_id",
            "workflow_version",
            "node_id",
            name="workflow_agent_node_binding_node_unique",
        ),
        Index("workflow_agent_node_binding_workflow_idx", "tenant_id", "workflow_id", "workflow_version"),
        Index("workflow_agent_node_binding_agent_idx", "tenant_id", "agent_id"),
        Index("workflow_agent_node_binding_config_version_idx", "tenant_id", "agent_config_version_id"),
        Index("workflow_agent_node_binding_app_idx", "tenant_id", "app_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_version: Mapped[str] = mapped_column(String(255), nullable=False)
    node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    binding_type: Mapped[WorkflowAgentBindingType] = mapped_column(
        EnumText(WorkflowAgentBindingType, length=32), nullable=False
    )
    agent_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    agent_config_version_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    node_job_config: Mapped[str] = mapped_column(LongText, nullable=False, default="{}")
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    @property
    def node_job_config_dict(self) -> dict[str, Any]:
        return json.loads(self.node_job_config) if self.node_job_config else {}
