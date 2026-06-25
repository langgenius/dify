import json
from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from .base import Base, DefaultFieldsMixin
from .types import EnumText, JSONModelColumn, LongText, StringUUID


class AgentKind(StrEnum):
    """Agent implementation family.

    This leaves room for future non-Dify agent implementations while keeping
    the current roster/workflow APIs scoped to Dify Agent.
    """

    # Native Agent backed by the Dify Agent runtime/protocol.
    DIFY_AGENT = "dify_agent"


class AgentScope(StrEnum):
    """Visibility and lifecycle scope of an Agent record."""

    # Workspace-visible Agent that can be reused from Agent Roster.
    ROSTER = "roster"
    # Temporary workflow-local Agent created inside one draft workflow node.
    WORKFLOW_ONLY = "workflow_only"


class AgentSource(StrEnum):
    """Origin that created or imported the Agent."""

    # Created directly as a reusable Agent Roster asset.
    ROSTER = "roster"
    # Created from an Agent App composer.
    AGENT_APP = "agent_app"
    # Created from a Workflow Agent Composer flow.
    WORKFLOW = "workflow"
    # Imported from an external artifact or future CLI/export flow.
    IMPORTED = "imported"
    # Created by system bootstrap or managed templates.
    SYSTEM = "system"


class AgentIconType(StrEnum):
    """Supported icon storage formats for Agent roster entries."""

    # ``icon`` stores an uploaded image reference.
    IMAGE = "image"
    # ``icon`` stores an emoji character.
    EMOJI = "emoji"
    # ``icon`` stores an external image URL.
    LINK = "link"


class AgentStatus(StrEnum):
    """Soft lifecycle state for Agent records."""

    # Available for roster lookup, composer use, and workflow binding.
    ACTIVE = "active"
    # Hidden from active roster queries while preserving historical bindings.
    ARCHIVED = "archived"


class AgentConfigRevisionOperation(StrEnum):
    """Audit operation recorded for Agent Soul version/revision changes."""

    # Initial version creation for a new Agent.
    CREATE_VERSION = "create_version"
    # Saves over the user-facing current version by creating a replacement snapshot.
    SAVE_CURRENT_VERSION = "save_current_version"
    # Creates a new semantic version for the same Agent.
    SAVE_NEW_VERSION = "save_new_version"
    # Saves composer content into a brand-new roster Agent.
    SAVE_NEW_AGENT = "save_new_agent"
    # Promotes a workflow-only Agent into the reusable Agent Roster.
    SAVE_TO_ROSTER = "save_to_roster"
    # Switches the Agent's current published config back to an existing version.
    RESTORE_VERSION = "restore_version"
    # Publishes the editable Agent Soul draft as a new immutable version.
    PUBLISH_DRAFT = "publish_draft"


class AgentConfigDraftType(StrEnum):
    """Editable Agent Soul draft workspace type."""

    # Shared Agent Console draft edited by users before publishing.
    DRAFT = "draft"
    # Per-editor build draft mutated during debug/build mode.
    DEBUG_BUILD = "debug_build"


class WorkflowAgentBindingType(StrEnum):
    """How a workflow node is bound to an Agent."""

    # Node uses a reusable Agent from the workspace roster.
    ROSTER_AGENT = "roster_agent"
    # Node owns a workflow-only Agent that is not visible in the roster.
    INLINE_AGENT = "inline_agent"


class AgentRuntimeSessionStatus(StrEnum):
    """Lifecycle state of an Agent backend session snapshot.

    Owner-agnostic: applies both to workflow Agent Node runs (owner =
    workflow_run) and to Agent App conversations (owner = conversation).
    """

    # Snapshot can be reused by a later Agent run in the same session.
    ACTIVE = "active"
    # Snapshot has been retired and must not be submitted to Agent backend again.
    CLEANED = "cleaned"


class AgentRuntimeSessionOwnerType(StrEnum):
    """Which product surface owns an Agent runtime session row."""

    # Owned by one workflow Agent Node execution scope.
    WORKFLOW_RUN = "workflow_run"
    # Owned by one Agent App conversation (multi-turn chat).
    CONVERSATION = "conversation"


# Back-compat alias: the workflow lifecycle code (shipped in PR #36724) imports
# the old name. Kept so unifying the table does not churn that path.
WorkflowAgentRuntimeSessionStatus = AgentRuntimeSessionStatus


class Agent(DefaultFieldsMixin, Base):
    """Workspace-scoped Agent identity used by Agent Roster and workflow-only agents."""

    __tablename__ = "agents"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_pkey"),
        UniqueConstraint("tenant_id", "roster_unique_name"),
        Index("agent_tenant_updated_at_idx", "tenant_id", "updated_at"),
        Index("agent_tenant_scope_idx", "tenant_id", "scope"),
        Index("agent_tenant_workflow_id_idx", "tenant_id", "workflow_id"),
        Index("agent_tenant_app_id_idx", "tenant_id", "app_id"),
        Index("agent_tenant_backing_app_id_idx", "tenant_id", "backing_app_id"),
        Index("agent_active_config_snapshot_id_idx", "active_config_snapshot_id"),
        Index(
            "agent_tenant_invitable_idx",
            "tenant_id",
            "scope",
            "status",
            "active_config_has_model",
            "updated_at",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(LongText, nullable=False, default="")
    role: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    icon_type: Mapped[AgentIconType | None] = mapped_column(EnumText(AgentIconType, length=32), nullable=True)
    icon: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Icon payload interpreted by icon_type: emoji character, image file id, or external URL.",
    )
    icon_background: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agent_kind: Mapped[AgentKind] = mapped_column(
        EnumText(AgentKind, length=32), nullable=False, default=AgentKind.DIFY_AGENT
    )
    scope: Mapped[AgentScope] = mapped_column(EnumText(AgentScope, length=32), nullable=False)
    source: Mapped[AgentSource] = mapped_column(EnumText(AgentSource, length=32), nullable=False)
    app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    backing_app_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        comment=(
            "Runtime Agent App used for chat/log/monitoring. For workflow-only agents, "
            "app_id remains the parent workflow app id and this points to the hidden backing app."
        ),
    )
    workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    workflow_node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active_config_snapshot_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    active_config_has_model: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.text("false")
    )
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


class AgentDebugConversation(DefaultFieldsMixin, Base):
    """Per-account console debug conversation for an Agent App.

    Agent App preview state must be isolated by editor account. The Agent row is
    shared by everyone in the workspace, so this table owns the user-specific
    conversation pointer used by console debug chat.
    """

    __tablename__ = "agent_debug_conversations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_debug_conversation_pkey"),
        UniqueConstraint(
            "tenant_id",
            "agent_id",
            "account_id",
            name="agent_debug_conversation_agent_account_unique",
        ),
        Index("agent_debug_conversation_conversation_idx", "conversation_id"),
        Index("agent_debug_conversation_account_idx", "tenant_id", "account_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)


class AgentConfigDraft(DefaultFieldsMixin, Base):
    """Editable Agent Soul draft separated from immutable published snapshots."""

    __tablename__ = "agent_config_drafts"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_config_draft_pkey"),
        UniqueConstraint(
            "tenant_id",
            "agent_id",
            "draft_type",
            "draft_owner_key",
            name="agent_config_draft_agent_type_account_unique",
        ),
        Index("agent_config_draft_tenant_agent_idx", "tenant_id", "agent_id"),
        Index("agent_config_draft_base_snapshot_idx", "tenant_id", "base_snapshot_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    draft_type: Mapped[AgentConfigDraftType] = mapped_column(EnumText(AgentConfigDraftType, length=32), nullable=False)
    account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    draft_owner_key: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    base_snapshot_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    config_snapshot: Mapped[Any] = mapped_column(JSONModelColumn(AgentSoulConfig), nullable=False)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    @property
    def config_snapshot_dict(self) -> dict[str, Any]:
        if not self.config_snapshot:
            return {}
        if hasattr(self.config_snapshot, "model_dump"):
            return self.config_snapshot.model_dump(mode="json")
        if isinstance(self.config_snapshot, str):
            return json.loads(self.config_snapshot)
        return dict(self.config_snapshot)


class AgentConfigSnapshot(DefaultFieldsMixin, Base):
    """Immutable Agent Soul snapshot.

    ``config_snapshot`` stores ``AgentSoulConfig`` as JSON-backed ``LongText``.
    It may contain credential or secret references, but must never contain
    plaintext secrets.
    """

    __tablename__ = "agent_config_snapshots"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_config_snapshot_pkey"),
        UniqueConstraint("agent_id", "version", name="agent_config_snapshot_agent_version_unique"),
        Index("agent_config_snapshot_tenant_agent_created_at_idx", "tenant_id", "agent_id", "created_at"),
        Index("agent_config_snapshot_tenant_created_at_idx", "tenant_id", "created_at"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    config_snapshot: Mapped[Any] = mapped_column(JSONModelColumn(AgentSoulConfig), nullable=False)
    summary: Mapped[str | None] = mapped_column(LongText, nullable=True)
    version_note: Mapped[str | None] = mapped_column(LongText, nullable=True)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    @property
    def config_snapshot_dict(self) -> dict[str, Any]:
        if not self.config_snapshot:
            return {}
        if hasattr(self.config_snapshot, "model_dump"):
            return self.config_snapshot.model_dump(mode="json")
        if isinstance(self.config_snapshot, str):
            return json.loads(self.config_snapshot)
        return dict(self.config_snapshot)


class AgentConfigRevision(Base):
    """Audit edge for every Agent Soul save operation.

    Revisions link immutable Agent Soul snapshots instead of duplicating the
    serialized configuration JSON.
    """

    __tablename__ = "agent_config_revisions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_config_revision_pkey"),
        UniqueConstraint(
            "agent_id",
            "revision",
            name="agent_config_revision_agent_revision_unique",
        ),
        Index("agent_config_revision_tenant_agent_created_at_idx", "tenant_id", "agent_id", "created_at"),
        Index(
            "agent_config_revision_tenant_current_snapshot_created_at_idx",
            "tenant_id",
            "current_snapshot_id",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    previous_snapshot_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    current_snapshot_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    revision: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    operation: Mapped[AgentConfigRevisionOperation] = mapped_column(
        EnumText(AgentConfigRevisionOperation, length=64), nullable=False
    )
    summary: Mapped[str | None] = mapped_column(LongText, nullable=True)
    version_note: Mapped[str | None] = mapped_column(LongText, nullable=True)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=naive_utc_now,
        server_default=func.current_timestamp(),
    )


class WorkflowAgentNodeBinding(DefaultFieldsMixin, Base):
    """Binding between one workflow node and one Agent config snapshot.

    ``node_job_config`` stores Workflow Node Job JSON only. Agent Soul belongs
    to ``AgentConfigSnapshot.config_snapshot`` and must not be duplicated here.
    """

    __tablename__ = "workflow_agent_node_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_agent_node_binding_pkey"),
        UniqueConstraint(
            "tenant_id",
            "workflow_id",
            "workflow_version",
            "node_id",
            name="workflow_agent_node_binding_node_version_unique",
        ),
        Index("workflow_agent_node_binding_agent_idx", "tenant_id", "agent_id"),
        Index("workflow_agent_node_binding_current_snapshot_idx", "tenant_id", "current_snapshot_id"),
        Index("workflow_agent_node_binding_app_idx", "tenant_id", "app_id"),
        Index(
            "workflow_agent_node_binding_workflow_version_idx",
            "tenant_id",
            "workflow_id",
            "workflow_version",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # Tracks which workflow version (draft or a published version string) this
    # binding belongs to. Mirrors ``Workflow.version`` and lets us keep separate
    # rows for the draft workflow and each published copy under the same
    # workflow_id, restoring the stage 1 §5.3 unique key.
    workflow_version: Mapped[str] = mapped_column(String(255), nullable=False)
    node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    binding_type: Mapped[WorkflowAgentBindingType] = mapped_column(
        EnumText(WorkflowAgentBindingType, length=32), nullable=False
    )
    agent_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    current_snapshot_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    node_job_config: Mapped[Any] = mapped_column(JSONModelColumn(WorkflowNodeJobConfig), nullable=False)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    @property
    def node_job_config_dict(self) -> dict[str, Any]:
        if not self.node_job_config:
            return {}
        if hasattr(self.node_job_config, "model_dump"):
            return self.node_job_config.model_dump(mode="json")
        if isinstance(self.node_job_config, str):
            return json.loads(self.node_job_config)
        return dict(self.node_job_config)


class AgentRuntimeSession(DefaultFieldsMixin, Base):
    """Persisted Agent backend session snapshot, owner-agnostic.

    One unified table serves both owners (decision Q2):
    - workflow Agent Node runs: ``owner_type = workflow_run``; the
      ``workflow_id / workflow_run_id / node_id / binding_id /
      agent_config_snapshot_id / composition_layer_specs`` columns are set.
    - Agent App conversations: ``owner_type = conversation``; the
      ``conversation_id`` column is set and the workflow columns stay NULL.
      Runtime state is scoped by ``agent_config_snapshot_id``. For published
      web/API runs this points to an immutable AgentConfigSnapshot; for console
      debugger/build runs it points to the editable AgentConfigDraft row.

    The snapshot is runtime state returned by Agent backend, kept separate from
    Agent Soul snapshots and workflow node-job config.
    """

    __tablename__ = "agent_runtime_sessions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_runtime_session_pkey"),
        # Workflow owner uniqueness (partial: only rows with a workflow_run_id).
        Index(
            "agent_runtime_session_workflow_scope_unique",
            "tenant_id",
            "workflow_run_id",
            "node_id",
            "binding_id",
            "agent_id",
            unique=True,
            postgresql_where=sa.text("workflow_run_id IS NOT NULL"),
        ),
        # Conversation owner uniqueness (partial: only rows with a conversation_id).
        Index(
            "agent_runtime_session_conversation_scope_unique",
            "tenant_id",
            "conversation_id",
            "agent_id",
            "agent_config_snapshot_id",
            unique=True,
            postgresql_where=sa.text("conversation_id IS NOT NULL"),
        ),
        Index(
            "agent_runtime_session_workflow_lookup_idx",
            "tenant_id",
            "workflow_run_id",
            "node_id",
            "status",
        ),
        Index(
            "agent_runtime_session_conversation_lookup_idx",
            "tenant_id",
            "conversation_id",
            "status",
        ),
        Index("agent_runtime_session_backend_run_idx", "backend_run_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    owner_type: Mapped[AgentRuntimeSessionOwnerType] = mapped_column(
        EnumText(AgentRuntimeSessionOwnerType, length=32), nullable=False
    )
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    backend_run_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_snapshot: Mapped[str] = mapped_column(LongText, nullable=False)
    # Workflow-owner columns (NULL for conversation owner).
    workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    node_execution_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    binding_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    agent_config_snapshot_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    # JSON-encoded list of non-sensitive runtime layer specs ({name, type, deps,
    # config}). The persisted schema keeps its original name because the sandbox
    # refactor intentionally avoids a storage migration.
    composition_layer_specs: Mapped[str] = mapped_column(LongText, nullable=False, server_default="[]")
    # Conversation-owner column (NULL for workflow owner).
    conversation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    status: Mapped[AgentRuntimeSessionStatus] = mapped_column(
        EnumText(AgentRuntimeSessionStatus, length=32),
        nullable=False,
        default=AgentRuntimeSessionStatus.ACTIVE,
    )
    cleaned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # ENG-637: when a run pauses for a dify.ask_human deferred call, these link
    # the session to the awaiting HITL form and the deferred tool_call_id, so a
    # resumed node can map the submitted form back into deferred_tool_results.
    # Both NULL whenever the session is not paused on human input.
    pending_form_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    pending_tool_call_id: Mapped[str | None] = mapped_column(String(255), nullable=True)


# Back-compat alias for the shipped workflow lifecycle code (PR #36724).
WorkflowAgentRuntimeSession = AgentRuntimeSession


class AgentDriveFileKind(StrEnum):
    """Kind of existing file record an agent-drive KV entry points at."""

    UPLOAD_FILE = "upload_file"
    TOOL_FILE = "tool_file"


class AgentDriveFile(DefaultFieldsMixin, Base):
    """Per-agent path-like KV index into existing file records (agent 网盘 / agent drive).

    A row maps a path-like ``key`` to a *pointer* (``file_kind`` + ``file_id``) at an
    existing ``UploadFile`` / ``ToolFile`` — it never stores file bytes. Scope/ownership
    is ``tenant_id -> agent-<agent_id>`` (the drive ref; no standalone ``drive_id`` this
    phase). ``key`` is opaque/path-like and carries no directory, permission, or
    parent-child semantics on the API side; it maps 1:1 to a sandbox-relative path when
    synced. ``value_owned_by_drive`` gates physical cleanup: only drive-owned values
    (created by the agent runtime or Skill standardization, not shared with other
    business records) have their storage object + record deleted when the KV entry is
    overwritten or removed; otherwise only the KV row is dropped. Skills are represented
    by the canonical ``<path>/SKILL.md`` row with ``is_skill=True`` and a serialized
    ``skill_metadata`` string. Lifecycle never relies on ``UploadFile.used/used_by``
    (not a reliable refcount).
    """

    __tablename__ = "agent_drive_files"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_drive_file_pkey"),
        UniqueConstraint("tenant_id", "agent_id", "key", name="agent_drive_file_scope_key_unique"),
        Index("agent_drive_files_tenant_agent_is_skill_key_idx", "tenant_id", "agent_id", "is_skill", "key"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # drive ref = agent-<agent_id>; this phase has no standalone drive_id.
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # path-like opaque key; not a filesystem (no dir/permission/parent semantics).
    # Bounded at 512 so the (tenant_id, agent_id, key) unique index stays within
    # MySQL's 3072-byte index limit (CHAR(36)*2 + VARCHAR(512) utf8mb4 = 2336).
    key: Mapped[str] = mapped_column(String(512), nullable=False)
    file_kind: Mapped[AgentDriveFileKind] = mapped_column(EnumText(AgentDriveFileKind, length=32), nullable=False)
    # points at UploadFile.id / ToolFile.id (the value), never the bytes.
    file_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    value_owned_by_drive: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.text("false")
    )
    is_skill: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False, server_default=sa.text("false"))
    skill_metadata: Mapped[str | None] = mapped_column(LongText, nullable=True)
    size: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True)
    hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
